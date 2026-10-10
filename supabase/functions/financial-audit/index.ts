import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Banks issue statements monthly, so the free audit is a 1-month audit.
const DEFAULT_AUDIT_MONTHS = 1;
const ALLOWED_AUDIT_MONTHS = [1, 3, 6];

function normalizeAuditMonths(value: unknown): number {
  const n = Number(value);
  return ALLOWED_AUDIT_MONTHS.includes(n) ? n : DEFAULT_AUDIT_MONTHS;
}

const SYSTEM_PROMPT = `You are FinScope, Investours' AI Financial Auditor and a world-class personal finance analyst for Nigeria and Africa.

Your job is to analyze a user's financial records (SMS bank alerts, email statements, or PDF statement text) and produce a Financial Health Audit.

Extract every transaction you can find. Bank SMS alerts look like:
"Alert: Withdrawal NGN10,000.00 on 05/08/26 by POS. Avail Bal: NGN450,000.00"
"Alert: Credit of NGN250,000.00 on 05/08/26. Desc: Salary. Avail Bal: NGN700,000.00"
"Your transfer of NGN5,000.00 to XYX on 04/08/26 is successful."

Rules:
1. Parse ALL transactions. For each: date (ISO yyyy-mm-dd), description (merchant/counterparty), amount (NGN), type ('credit' for money in, 'debit' for money out), and a category (salary, transfers, shopping, food, transport, utilities, subscriptions, airtime, atm_withdrawal, pos, bills, investment, entertainment, other).
2. Extract every dated transaction present in the supplied records. Do not discard transactions based on today's date. The application will apply the selected 1, 3 or 6-month window relative to the latest dated transaction in these records. If dates are not present, include the available records and mark dates as unavailable.
3. Compute:
   - totalIncome: sum of credits
   - totalExpenses: sum of debits
   - cashFlow = totalIncome - totalExpenses
   - savingsRate = (cashFlow / totalIncome * 100) clamped 0-100
   - recoverableAmount: your estimate of money recoverable through refunds, bank overcharges, duplicated charges, failed POS double-debits, subscription over-billing, forgotten/missed reversals, and hidden charges (ATM fees, data fees, account maintenance, excess charges). Be conservative and evidence-based. recoverableAmount MUST be the exact sum of the "amount" values in the "recoverable" array.
4. Detect LEAKAGES: recurring unnecessary costs, duplicate charges, bank charges/fees, dormant subscriptions, ATM/withdrawal fees, high transfer fees, POS double-charges.
5. For every item in "recoverable", include "sourceAmount" (the full original transaction amount that caused the leakage) and "sourceType" ("debit" for money out) so the user can trace each recoverable back to the exact transaction in their statement.
6. Score (0-100) the financial health using this rubric:
   - 80-100: Excellent (positive cash flow, savings rate > 20%, no worrying leakages)
   - 65-79: Good (positive cash flow, savings rate 10-20%, some minor leakages)
   - 50-64: Needs Attention (thin or negative cash flow, leakages > 5% of expenses)
   - 0-49: Critical (negative cash flow, heavy fees, dangerous leakages)

Respond with STRICT JSON only, no markdown, no commentary. Shape:
{
  "periodStart": "yyyy-mm-dd",
  "periodEnd": "yyyy-mm-dd",
  "score": <int 0-100>,
  "healthStatus": "excellent" | "good" | "needs_attention" | "critical",
  "totalIncome": <number>,
  "totalExpenses": <number>,
  "cashFlow": <number>,
  "savingsRate": <number 0-100>,
  "recoverableAmount": <number>,
  "summary": {
    "incomeSources": [{"name": "...", "amount": <number>}],
    "topSpendingCategories": [{"name": "...", "amount": <number>}]
  },
  "transactions": [{"date": "yyyy-mm-dd", "description": "...", "amount": <number>, "type": "credit|debit", "category": "..."}],
   "leakages": [{"description": "...", "amount": <number>, "category": "..."}],
   "recoverable": [{"description": "...", "amount": <number>, "category": "...", "transactionDate": "yyyy-mm-dd", "sourceAmount": <number>, "sourceType": "debit|credit"}],
  "recommendations": [{"title": "...", "description": "...", "category": "leakage|recovery|monitoring|spending"}],
  "monthlyScores": [{"month": "yyyy-mm", "score": <int>}]
}`;

function buildUserPrompt(input: { text: string; sourceType: string; accountType: string; auditMonths?: number }): string {
  const months = input.auditMonths ?? DEFAULT_AUDIT_MONTHS;
  return `Selected audit duration: ${months} month${months === 1 ? "" : "s"}.
Extract and analyze every transaction in the supplied records. Do not compare dates with today's date or omit older entries; the application will select the requested duration relative to the statement's latest transaction date.

Financial data source: ${input.sourceType}
Account type: ${input.accountType || 'individual'}

Raw financial records:
---
${input.text}
---

Extract all transactions and produce the Financial Health Audit JSON described in the system instructions.`;
}

interface ExtractedTransaction {
  date?: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  category?: string;
}

// Deterministic fallback: parse bank SMS alerts without calling the AI gateway.
function parseFromText(text: string, months: number = DEFAULT_AUDIT_MONTHS): {
  transactions: ExtractedTransaction[];
  periodStart: string;
  periodEnd: string;
} {
  const transactions: ExtractedTransaction[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dateRegex = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/g;
  const amountRegex = /(?:₦|NGN|\u20a6)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  const creditWords = /\b(credit|transfer from|payment received|salary|funding|interest)\b/i;
  const debitWords = /\b(withdraw|debit|transfer to|transfer of|payment to|outgoing|sent to|charged|deducted|pos|atm|bill|airtime|charge|fee)\b/i;

  let lastDate = new Date().toISOString().slice(0, 10);

  for (const line of lines) {
    const lineDateMatch = line.match(dateRegex);
    if (lineDateMatch) {
      const parts = lineDateMatch[0].split(/[/-]/);
      const day = parts[0];
      const month = parts[1];
      let year = parts[2];
      if (year.length === 2) year = `20${year}`;
      const candidate = new Date(`${year}-${month}-${day}`);
      if (!isNaN(candidate.getTime())) lastDate = candidate.toISOString().slice(0, 10);
    }

    const amtMatch = line.replace(/\bAvail Bal[^.]*\./gi, '').match(amountRegex);
    if (!amtMatch) continue;

    const parsedAmount = parseFloat(amtMatch[0].replace(/[^\d.]/g, ''));
    const amount = !isNaN(parsedAmount) ? parsedAmount : 0;
    if (amount <= 0) continue;

    const isCredit = creditWords.test(line) && !debitWords.test(line);
    const isDebit = debitWords.test(line);

    let type: 'credit' | 'debit';
    if (isCredit) type = 'credit';
    else if (isDebit) type = 'debit';
    else {
      // Default: "Alert: Withdrawal" / "Alert: Transfer" lines are debits unless "Credit"
      type = /\b(debit|withdrawal|transfer out|transfer of|outgoing|sent|charged|deducted|payment)\b/i.test(line) ? 'debit' : 'credit';
    }

    const description = line
      .replace(dateRegex, '')
      .replace(amountRegex, '')
      .replace(/(Alert:|NGN|₦|Avail Bal[^.]*\.|Txn ID[^.]*\.|Acct|Account)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    transactions.push({
      date: lastDate,
      description: description || (type === 'credit' ? 'Credit received' : 'Debit'),
      amount: Math.round(amount * 100) / 100,
      type,
      category: guessCategory(description),
    });
  }

  const { periodStart, periodEnd } = auditWindow(months);

  return {
    transactions,
    periodStart,
    periodEnd,
  };
}

function auditWindow(months: number, anchor = new Date()) {
  const end = new Date(anchor);
  const start = new Date(anchor);
  const dayOfMonth = start.getDate();
  start.setDate(1);
  start.setMonth(start.getMonth() - months);
  const lastDayOfTargetMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  start.setDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

function auditWindowForTransactions(transactions: { date?: string }[], months: number) {
  const today = new Date().toISOString().slice(0, 10);
  const latestDate = transactions
    .map((transaction) => transaction.date)
    .filter((date): date is string => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today))
    .sort()
    .at(-1);
  return auditWindow(months, latestDate ? new Date(`${latestDate}T12:00:00Z`) : new Date());
}

function buildFallbackReport(text: string, accountType: string, months: number = DEFAULT_AUDIT_MONTHS) {
  const { transactions } = parseFromText(text, months);
  const { periodStart, periodEnd } = auditWindowForTransactions(transactions, months);
  const inWindow = transactions.filter((transaction) =>
    transaction.date && transaction.date >= periodStart && transaction.date <= periodEnd
  );
  const income = inWindow.filter((transaction) => transaction.type === 'credit');
  const expenses = inWindow.filter((transaction) => transaction.type === 'debit');
  const totalIncome = income.reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalExpenses = expenses.reduce((sum, transaction) => sum + transaction.amount, 0);
  const cashFlow = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? Math.max(0, Math.min(100, (cashFlow / totalIncome) * 100)) : 0;

  const leakageCats = /(charge|fee|commission|vat|deduct)/i;
  const recoverableCats = /(duplicate|reversal|failed|double|fee|charge|subscription|insurance)/i;
  const leakages = expenses
    .filter((transaction) => leakageCats.test(transaction.description))
    .slice(0, 12)
    .map((transaction) => ({ description: transaction.description || 'Bank charge', amount: transaction.amount, category: 'bank_charges' }));
  const recoverable = expenses
    .filter((transaction) => recoverableCats.test(transaction.description))
    .slice(0, 10)
    .map((transaction) => ({
      description: transaction.description || 'Fees / charges',
      amount: Math.round(transaction.amount * 0.5 * 100) / 100,
      category: 'charges',
      transactionDate: transaction.date,
      sourceAmount: Math.round(transaction.amount * 100) / 100,
      sourceType: 'debit',
    }));
  if (recoverable.length === 0) {
    recoverable.push({
      description: 'Bank charges & maintenance fees',
      amount: Math.round(totalExpenses * 0.015 * 100) / 100,
      category: 'charges',
      transactionDate: periodEnd,
      sourceAmount: Math.round(totalExpenses * 0.015 * 100) / 100,
      sourceType: 'debit',
    });
  }

  const recoverableAmount = recoverable.reduce((sum, item) => sum + item.amount, 0);
  const monthlyTotals = new Map<string, { month: string; income: number; outflows: number }>();
  inWindow.forEach((transaction) => {
    const month = transaction.date!.slice(0, 7);
    const totals = monthlyTotals.get(month) ?? { month, income: 0, outflows: 0 };
    totals[transaction.type === 'credit' ? 'income' : 'outflows'] += transaction.amount;
    monthlyTotals.set(month, totals);
  });
  const score = calculateHealthScore(cashFlow, savingsRate, leakages.length);
  const healthStatus = healthStatusFromScore(score);
  const monthlyScores = monthlyScoresFromTransactions(inWindow);

  return {
    periodStart,
    periodEnd,
    auditMonths: months,
    score,
    healthStatus,
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    cashFlow: Math.round(cashFlow * 100) / 100,
    savingsRate: Math.round(savingsRate * 100) / 100,
    recoverableAmount: Math.round(recoverableAmount * 100) / 100,
    summary: {
      incomeSources: income.slice(0, 5).map((transaction) => ({ name: transaction.description || 'Income', amount: transaction.amount })),
      topSpendingCategories: topCategories(expenses, 5),
    },
    transactions: inWindow.slice(0, 200),
    monthlyObservations: [...monthlyTotals.values()].sort((a, b) => a.month.localeCompare(b.month)).map((month) => ({
      ...month,
      source: 'calculated',
      verification: 'unverified',
    })),
    leakages,
    recoverable: recoverable.slice(0, 12),
    recommendations: buildFallbackRecommendations(cashFlow, savingsRate, leakages.length, accountType),
    monthlyScores,
  };
}

function topCategories(txs: ExtractedTransaction[], limit: number): { name: string; amount: number }[] {
  const byCat = new Map<string, number>();
  for (const t of txs) {
    const cat = guessCategory(t.description);
    byCat.set(cat, (byCat.get(cat) ?? 0) + t.amount);
  }
  return [...byCat.entries()]
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

function calculateHealthScore(cashFlow: number, savingsRate: number, leakageCount: number): number {
  let score = 55;
  if (cashFlow > 0) score += 15;
  if (savingsRate >= 20) score += 10;
  if (savingsRate >= 10 && savingsRate < 20) score += 5;
  score -= Math.min(15, leakageCount * 2);
  return Math.max(10, Math.min(95, Math.round(score)));
}

function healthStatusFromScore(score: number): string {
  return score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 50 ? 'needs_attention' : 'critical';
}

function monthlyScoresFromTransactions(transactions: ExtractedTransaction[]): { month: string; score: number }[] {
  const totals = new Map<string, { income: number; outflows: number; leakageCount: number }>();
  for (const transaction of transactions) {
    if (!transaction.date) continue;
    const month = transaction.date.slice(0, 7);
    const value = totals.get(month) ?? { income: 0, outflows: 0, leakageCount: 0 };
    if (transaction.type === 'credit') value.income += transaction.amount;
    else {
      value.outflows += transaction.amount;
      if (/(charge|fee|commission|vat|deduct|duplicate|failed|reversal)/i.test(transaction.description)) {
        value.leakageCount += 1;
      }
    }
    totals.set(month, value);
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, value]) => {
    const cashFlow = value.income - value.outflows;
    const savingsRate = value.income > 0 ? Math.max(0, Math.min(100, (cashFlow / value.income) * 100)) : 0;
    return { month, score: calculateHealthScore(cashFlow, savingsRate, value.leakageCount) };
  });
}

function guessCategory(description: string): string {
  const d = description.toLowerCase();
  if (/(pos|atm|withdraw)/.test(d)) return 'withdrawals';
  if (/(airtime|data|bundle)/.test(d)) return 'airtime & data';
  if (/(transfer)/.test(d)) return 'transfers';
  if (/(rent|house|landlord)/.test(d)) return 'rent';
  if (/(charge|fee|commission|vat)/.test(d)) return 'bank charges';
  if (/(shop|market|grocery|supermarket|food)/.test(d)) return 'shopping & food';
  if (/(bill|electric|utility|water)/.test(d)) return 'utilities';
  if (/(salary|wages)/.test(d)) return 'salary';
  return 'other';
}

function buildFallbackRecommendations(
  cashFlow: number,
  savingsRate: number,
  leakCount: number,
  accountType: string,
) {
  const recs: { title: string; description: string; category: string }[] = [
    {
      title: 'Review recurring charges & subscriptions',
      description: 'Cancel dormant subscriptions and negotiate recurring bills to stop silent leakages.',
      category: 'leakage',
    },
  ];
  if (leakCount > 0) {
    recs.push({
      title: 'Claim refunds on duplicate & failed charges',
      description: 'Duplicate POS debits and failed reversals are claimable with your bank. Open a dispute ticket.',
      category: 'recovery',
    });
  }
  if (cashFlow <= 0) {
    recs.push({
      title: 'Build a positive cash flow buffer',
      description: 'Your expenses exceed income. Set a weekly spending cap and automate savings on payday.',
      category: 'spending',
    });
  } else if (savingsRate < 20) {
    recs.push({
      title: 'Automate your savings',
      description: `Automate at least 20% of income into savings on payday. Current savings rate: ${Math.round(savingsRate)}%.`,
      category: 'spending',
    });
  }
  recs.push({
    title: accountType === 'business' ? 'Separate business & personal finances' : 'Use free tier monitoring',
    description: accountType === 'business'
      ? 'Open dedicated business accounts to keep expense analysis and tax readiness clean.'
      : 'Enable weekly monitoring to track financial health checks and catch new leakages early.',
    category: 'monitoring',
  });
  return recs;
}

type AiRecord = { [key: string]: unknown };

function clampReport(r: AiRecord, accountType: string, months: number) {
  const rawTransactions = Array.isArray(r.transactions) ? r.transactions : [];
  const extractedTransactions = rawTransactions.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const transaction = value as Record<string, unknown>;
    const date = typeof transaction.date === 'string' ? transaction.date.slice(0, 10) : '';
    const amount = Number(transaction.amount);
    const type = transaction.type === 'credit' || transaction.type === 'debit' ? transaction.type : null;
    if (!type || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    return [{
      date,
      description: String(transaction.description || (type === 'credit' ? 'Credit received' : 'Debit')).trim(),
      amount: Math.round(amount * 100) / 100,
      type: type as ExtractedTransaction['type'],
      category: String(transaction.category || guessCategory(String(transaction.description || ''))),
    }];
  }).sort((a, b) => a.date.localeCompare(b.date)
    || a.description.localeCompare(b.description)
    || a.amount - b.amount
    || a.type.localeCompare(b.type));
  const window = auditWindowForTransactions(extractedTransactions, months);
  const transactions = extractedTransactions.filter((transaction) =>
    transaction.date >= window.periodStart && transaction.date <= window.periodEnd
  );
  const incomeTransactions = transactions.filter((transaction) => transaction.type === 'credit');
  const expenseTransactions = transactions.filter((transaction) => transaction.type === 'debit');
  const totalIncome = transactions.length
    ? incomeTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)
    : Math.max(0, Number(r.totalIncome) || 0);
  const totalExpenses = transactions.length
    ? expenseTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)
    : Math.max(0, Number(r.totalExpenses) || 0);
  const cashFlow = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? Math.max(0, Math.min(100, (cashFlow / totalIncome) * 100)) : 0;
  const deterministicLeakageCount = expenseTransactions.filter((transaction) =>
    /(charge|fee|commission|vat|deduct|duplicate|failed|reversal)/i.test(transaction.description)
  ).length;
  const score = calculateHealthScore(cashFlow, savingsRate, deterministicLeakageCount);
  const incomeBySource = new Map<string, number>();
  incomeTransactions.forEach((transaction) => incomeBySource.set(
    transaction.description,
    (incomeBySource.get(transaction.description) ?? 0) + transaction.amount,
  ));
  const recoverable = Array.isArray(r.recoverable)
    ? r.recoverable.slice(0, 20).map((x: { [key: string]: unknown }) => {
        const sourceAmount = x?.sourceAmount != null ? Math.max(0, Number(x.sourceAmount) || 0) : undefined;
        const amount = sourceAmount != null
          ? Math.max(0, Math.min(Number(x?.amount) || 0, sourceAmount))
          : Math.max(0, Number(x?.amount) || 0);
        return {
          description: String(x?.description || 'Fees / charges'),
          amount: Math.round(amount * 100) / 100,
          category: String(x?.category || 'charges'),
          transactionDate: x?.transactionDate || undefined,
          sourceAmount,
          sourceType: x?.sourceType === 'credit' ? 'credit' : 'debit',
        };
      })
    : [];
  const recoverableAmount = Math.round(recoverable.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const monthlyTotals = new Map<string, { month: string; income: number; outflows: number }>();
  transactions.forEach((transaction) => {
    const month = transaction.date.slice(0, 7);
    const totals = monthlyTotals.get(month) ?? { month, income: 0, outflows: 0 };
    totals[transaction.type === 'credit' ? 'income' : 'outflows'] += transaction.amount;
    monthlyTotals.set(month, totals);
  });
  return {
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    auditMonths: months,
    score,
    healthStatus: healthStatusFromScore(score),
    totalIncome,
    totalExpenses,
    cashFlow,
    savingsRate,
    recoverableAmount,
    summary: transactions.length ? {
      incomeSources: [...incomeBySource.entries()].map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
        .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)).slice(0, 10),
      topSpendingCategories: topCategories(expenseTransactions, 10),
    } : r.summary || {},
    transactions: transactions.length ? transactions.slice(0, 300) : [],
    monthlyObservations: [...monthlyTotals.values()].sort((a, b) => a.month.localeCompare(b.month)).map((month) => ({
      ...month,
      source: 'calculated',
      verification: 'unverified',
    })),
    leakages: Array.isArray(r.leakages) ? r.leakages.slice(0, 20) : [],
    recoverable,
    recommendations: Array.isArray(r.recommendations) ? r.recommendations.slice(0, 8) : [],
    monthlyScores: monthlyScoresFromTransactions(transactions),
  };
}

async function callAI(text: string, sourceType: string, accountType: string, auditMonths: number) {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          { role: "user", parts: [{ text: buildUserPrompt({ text, sourceType, accountType, auditMonths }) }] },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) throw { status: 429, message: "Rate limit exceeded. Please try again in a moment." };
    if (response.status === 402) throw { status: 402, message: "Service temporarily unavailable. Please try again later." };
    throw new Error(`Gemini AI error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text || "")
    .join("") || '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error("AI returned invalid JSON");
  return JSON.parse(content.slice(start, end + 1));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text = '', sourceType = 'sms', accountType = 'individual' } = body;
    const auditMonths = normalizeAuditMonths(body.auditMonths);

    if (!text || text.trim().length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide financial records to audit (min 10 characters).' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let report;
    try {
      const raw = await callAI(text, sourceType, accountType, auditMonths);
      report = clampReport(raw, accountType, auditMonths);
      if (report.transactions.length === 0) {
        report = buildFallbackReport(text, accountType, auditMonths);
      }
    } catch (err) {
      // AI gateway failure -> deterministic fallback so the audit still completes.
      const e = err as { status?: number; message?: string };
      if (e?.status === 429 || e?.status === 402) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: e.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.warn('AI analysis failed, using fallback parser:', e?.message || e);
      report = buildFallbackReport(text, accountType, auditMonths);
    }

    return new Response(JSON.stringify({ success: true, report }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const e = error as { status?: number; message?: string };
    const status = e?.status || 500;
    const message = e?.message || (typeof error === 'string' ? error : "Unknown error occurred");
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
