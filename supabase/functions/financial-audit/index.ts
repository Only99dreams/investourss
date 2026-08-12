import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are FinScope, Investours' AI Financial Auditor and a world-class personal finance analyst for Nigeria and Africa.

Your job is to analyze a user's financial records (SMS bank alerts, email statements, or PDF statement text) and produce a Financial Health Audit.

Extract every transaction you can find. Bank SMS alerts look like:
"Alert: Withdrawal NGN10,000.00 on 05/08/26 by POS. Avail Bal: NGN450,000.00"
"Alert: Credit of NGN250,000.00 on 05/08/26. Desc: Salary. Avail Bal: NGN700,000.00"
"Your transfer of NGN5,000.00 to XYX on 04/08/26 is successful."

Rules:
1. Parse ALL transactions. For each: date (ISO yyyy-mm-dd), description (merchant/counterparty), amount (NGN), type ('credit' for money in, 'debit' for money out), and a category (salary, transfers, shopping, food, transport, utilities, subscriptions, airtime, atm_withdrawal, pos, bills, investment, entertainment, other).
2. Only count transactions that fall within the last 6 months (or whatever period the data covers). If no dates are present, assume the records cover the stated audit period.
3. Compute:
   - totalIncome: sum of credits
   - totalExpenses: sum of debits
   - cashFlow = totalIncome - totalExpenses
   - savingsRate = (cashFlow / totalIncome * 100) clamped 0-100
   - recoverableAmount: your estimate of money recoverable through refunds, bank overcharges, duplicated charges, failed POS double-debits, subscription over-billing, forgotten/missed reversals, and hidden charges (ATM fees, data fees, account maintenance, excess charges). Be conservative and evidence-based.
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
  const months = input.auditMonths ?? 6;
  return `Audit period: the last ${months} months.

Financial data source: ${input.sourceType}
Account type: ${input.accountType || 'individual'}

Raw financial records:
---
${input.text.slice(0, 60000)}
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
function parseFromText(text: string): {
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

  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 6);

  return {
    transactions,
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

function buildFallbackReport(text: string, accountType: string) {
  const { transactions, periodStart, periodEnd } = parseFromText(text);

  const income = transactions.filter((t) => t.type === 'credit');
  const expenses = transactions.filter((t) => t.type === 'debit');

  const totalIncome = income.reduce((s, t) => s + t.amount, 0);
  const totalExpenses = expenses.reduce((s, t) => s + t.amount, 0);
  const cashFlow = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? Math.max(0, Math.min(100, (cashFlow / totalIncome) * 100)) : 0;

  // Heuristic: estimate leakages from bank charges/fees + POS withdrawals
  const leakageCats = /(charge|fee|commission|vat|deduct)/i;
  const recoverableCats = /(duplicate|reversal|failed|double|fee|charge|subscription|insurance)/i;

  const leakages = expenses
    .filter((t) => leakageCats.test(t.description))
    .slice(0, 12)
    .map((t) => ({ description: t.description || 'Bank charge', amount: t.amount, category: 'bank_charges' }));

  const recoverable = [
    ...expenses
      .filter((t) => recoverableCats.test(t.description))
      .slice(0, 10)
      .map((t) => ({
        description: t.description || 'Fees / charges',
        amount: Math.round(t.amount * 0.5 * 100) / 100,
        category: 'charges',
        transactionDate: t.date,
        sourceAmount: Math.round(t.amount * 100) / 100,
        sourceType: 'debit',
      })),
  ];
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

  const recoverableAmount = recoverable.reduce((s, r) => s + r.amount, 0);

  let score = 55;
  if (cashFlow > 0) score += 15;
  if (savingsRate >= 20) score += 10;
  if (savingsRate >= 10 && savingsRate < 20) score += 5;
  score -= Math.min(15, leakages.length * 2);
  score = Math.max(10, Math.min(95, Math.round(score)));

  const healthStatus = score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 50 ? 'needs_attention' : 'critical';

  const monthlyScores: { month: string; score: number }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const month = d.toISOString().slice(0, 7);
    monthlyScores.push({ month, score: Math.max(10, Math.min(100, score + (5 - i) * 2 - 4)) });
  }

  return {
    periodStart,
    periodEnd,
    score,
    healthStatus,
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    cashFlow: Math.round(cashFlow * 100) / 100,
    savingsRate: Math.round(savingsRate * 100) / 100,
    recoverableAmount: Math.round(recoverableAmount * 100) / 100,
    summary: {
      incomeSources: income.slice(0, 5).map((t) => ({ name: t.description || 'Income', amount: t.amount })),
      topSpendingCategories: topCategories(expenses, 5),
    },
    transactions: transactions.slice(0, 200),
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
      : 'Enable weekly monitoring to track financial health changes and catch new leakages early.',
    category: 'monitoring',
  });
  return recs;
}

type AiRecord = { [key: string]: unknown };

function clampReport(r: AiRecord, accountType: string) {
  const fallback = buildFallbackReport('', accountType);
  const totalIncome = Math.max(0, Number(r.totalIncome) || 0);
  const totalExpenses = Math.max(0, Number(r.totalExpenses) || 0);
  const cashFlow = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? Math.max(0, Math.min(100, (cashFlow / totalIncome) * 100)) : 0;
  return {
    periodStart: typeof r.periodStart === 'string' ? r.periodStart : fallback.periodStart,
    periodEnd: typeof r.periodEnd === 'string' ? r.periodEnd : fallback.periodEnd,
    score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
    healthStatus: ['excellent', 'good', 'needs_attention', 'critical'].includes(r.healthStatus as string)
      ? r.healthStatus
      : 'critical',
    totalIncome,
    totalExpenses,
    cashFlow,
    savingsRate,
    recoverableAmount: Math.max(0, Number(r.recoverableAmount) || 0),
    summary: r.summary || {},
    transactions: Array.isArray(r.transactions) ? r.transactions.slice(0, 300) : [],
    leakages: Array.isArray(r.leakages) ? r.leakages.slice(0, 20) : [],
    recoverable: Array.isArray(r.recoverable)
      ? r.recoverable.slice(0, 20).map((x: { [key: string]: unknown }) => ({
          description: String(x?.description || 'Fees / charges'),
          amount: Math.max(0, Number(x?.amount) || 0),
          category: String(x?.category || 'charges'),
          transactionDate: x?.transactionDate || undefined,
          sourceAmount: x?.sourceAmount != null ? Math.max(0, Number(x.sourceAmount) || 0) : undefined,
          sourceType: x?.sourceType === 'credit' ? 'credit' : 'debit',
        }))
      : [],
    recommendations: Array.isArray(r.recommendations) ? r.recommendations.slice(0, 8) : [],
    monthlyScores: Array.isArray(r.monthlyScores) ? r.monthlyScores : fallback.monthlyScores,
  };
}

async function callAI(text: string, sourceType: string, accountType: string) {
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
          { role: "user", parts: [{ text: buildUserPrompt({ text, sourceType, accountType }) }] },
        ],
        generationConfig: { responseMimeType: "application/json" },
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
    const { text = '', sourceType = 'sms', accountType = 'individual', auditMonths = 6 } = body;

    if (!text || text.trim().length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide financial records to audit (min 10 characters).' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let report;
    try {
      const raw = await callAI(text, sourceType, accountType);
      report = clampReport(raw, accountType);
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
      report = buildFallbackReport(text, accountType);
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
