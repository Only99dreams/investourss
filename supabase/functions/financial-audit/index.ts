import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { applyFinancialAuditRules, splitFinancialRecords } from "./auditRules.ts";

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
3. Do not invent transactions, amounts, dates, fees, refunds, debt, or repayment history. Copy a transaction reference only if it is present in the source.
4. Do not calculate totals, savings rate, recoverable amounts, recommendations, or scores. The application calculates these from normalized transactions.
5. Return every transaction found in the provided records. Do not compare dates with today's date or omit older transactions; the application selects the requested period relative to the latest valid transaction date.
6. Do not carry a prior date forward or substitute today's date when a transaction date is absent. Leave the transaction date unavailable.
7. Include a transaction ID only when the exact source ID/reference is present. Repeated transactions must remain separate unless the exact same source ID occurs more than once.
8. The application uses the following rules: amounts must be positive finite values; direction must be explicitly credit/debit; dated transactions outside the selected statement-relative period are excluded; undated transactions remain in period totals but not monthly trends; totals, summaries, score, and status are computed from the resulting ledger; fees alone are not recoverable without explicit claim evidence.

6. Return the required JSON shape. Derived numeric fields may be zero and derived arrays may be empty; the application replaces them using the versioned audit rules.

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
  "transactions": [{"date": "yyyy-mm-dd or empty", "description": "...", "amount": <number>, "type": "credit|debit", "category": "...", "transactionId": "exact source ID or empty"}],
   "leakages": [{"description": "...", "amount": <number>, "category": "..."}],
   "recoverable": [{"description": "...", "amount": <number>, "category": "...", "transactionDate": "yyyy-mm-dd", "sourceAmount": <number>, "sourceType": "debit|credit"}],
  "recommendations": [{"title": "...", "description": "...", "category": "leakage|recovery|monitoring|spending"}],
  "monthlyScores": [{"month": "yyyy-mm", "score": <int>}]
}`;

function buildUserPrompt(input: { text: string; sourceType: string; accountType: string; auditMonths?: number }): string {
  const months = input.auditMonths ?? DEFAULT_AUDIT_MONTHS;
  return `Selected audit duration: ${months} month${months === 1 ? "" : "s"}.
Extract every transaction present in this complete record chunk. Do not compare dates with today's date or omit older entries; the application selects the requested duration relative to the latest valid transaction date across all chunks. Copy source IDs exactly when present.

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
  transactionId?: string;
}

function parseSourceDate(value: string): string | undefined {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  const year = Number(iso?.[1] ?? local?.[3]);
  const month = Number(iso?.[2] ?? local?.[2]);
  const day = Number(iso?.[3] ?? local?.[1]);
  if (!iso && !local) return undefined;
  const fullYear = year < 100 ? 2000 + year : year;
  const parsed = new Date(Date.UTC(fullYear, month - 1, day));
  if (
    parsed.getUTCFullYear() !== fullYear
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return undefined;
  return parsed.toISOString().slice(0, 10);
}

// Deterministic fallback: parse bank SMS alerts without calling the AI gateway.
function parseFromText(text: string): { transactions: ExtractedTransaction[] } {
  const transactions: ExtractedTransaction[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dateRegex = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g;
  const amountRegex = /(?:₦|NGN|\u20a6)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  const creditWords = /\b(credit|deposit|transfer from|payment received|salary|funding|interest)\b/i;
  const debitWords = /\b(withdraw|debit|transfer to|transfer of|payment to|outgoing|sent to|charged|deducted|pos|atm|bill|airtime|charge|fee)\b/i;

  for (const line of lines) {
    const dateToken = line.match(dateRegex)?.[0];
    const transactionDate = dateToken ? parseSourceDate(dateToken) : undefined;

    const amtMatch = line.replace(/\bAvail Bal[^.]*\./gi, '').match(amountRegex);
    if (!amtMatch) continue;

    const parsedAmount = parseFloat(amtMatch[0].replace(/[^\d.]/g, ''));
    const amount = !isNaN(parsedAmount) ? parsedAmount : 0;
    if (amount <= 0) continue;

    const isCredit = creditWords.test(line);
    const isDebit = debitWords.test(line);
    if (isCredit === isDebit) continue;
    const type: 'credit' | 'debit' = isCredit ? 'credit' : 'debit';

    const description = line
      .replace(dateRegex, '')
      .replace(amountRegex, '')
      .replace(/(Alert:|NGN|₦|Avail Bal[^.]*\.|Txn ID[^.]*\.|Acct|Account)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const transactionId = /\b(?:txn(?:\s*id)?|transaction(?:\s*id)?|reference|ref)\s*[:#-]?\s*([A-Z0-9-]+)/i.exec(line)?.[1];

    transactions.push({
      date: transactionDate,
      description: description || (type === 'credit' ? 'Credit received' : 'Debit'),
      amount: Math.round(amount * 100) / 100,
      type,
      transactionId,
    });
  }

  return { transactions };
}

function buildFallbackReport(text: string, accountType: string, months: number = DEFAULT_AUDIT_MONTHS) {
  const { transactions } = parseFromText(text);
  return buildReportFromRules(applyFinancialAuditRules(transactions, months), accountType);
}

function buildReportFromRules(rules: ReturnType<typeof applyFinancialAuditRules>, accountType: string) {
  return {
    ...rules,
    summary: {
      incomeSources: rules.incomeSources,
      topSpendingCategories: rules.topSpendingCategories,
    },
    recommendations: buildFallbackRecommendations(rules.cashFlow, rules.savingsRate, rules.leakages.length, accountType),
  };
}

function buildFallbackRecommendations(
  cashFlow: number,
  savingsRate: number,
  leakCount: number,
  accountType: string,
) {
  const recs: { title: string; description: string; category: string }[] = [
    {
      title: 'Review recurring spending',
      description: 'Check recurring charges against your records and confirm they are expected.',
      category: 'leakage',
    },
  ];
  if (leakCount > 0) {
    recs.push({
      title: 'Review listed fees and charges',
      description: 'Confirm these entries with your bank; a fee alone does not establish that a refund is owed.',
      category: 'leakage',
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

function clampReport(r: AiRecord, accountType: string, months: number, sourceText: string) {
  const rawTransactions = Array.isArray(r.transactions) ? r.transactions : [];
  const sourceIds = new Set(
    [...sourceText.matchAll(/\b(?:txn(?:\s*id)?|transaction(?:\s*id)?|reference|ref)\s*[:#-]?\s*([A-Z0-9-]+)/gi)]
      .map((match) => match[1]),
  );
  const verifiedTransactions = rawTransactions.map((value) => {
    if (!value || typeof value !== "object") return value;
    const transaction = value as Record<string, unknown>;
    if (typeof transaction.transactionId !== "string" || sourceIds.has(transaction.transactionId)) return value;
    const { transactionId: _unverifiedId, ...withoutUnverifiedId } = transaction;
    return withoutUnverifiedId;
  });
  return buildReportFromRules(applyFinancialAuditRules(verifiedTransactions, months), accountType);
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
      const extractedTransactions: unknown[] = [];
      for (const chunk of splitFinancialRecords(text)) {
        const raw = await callAI(chunk, sourceType, accountType, auditMonths);
        if (Array.isArray(raw.transactions)) extractedTransactions.push(...raw.transactions);
      }
      report = clampReport({ transactions: extractedTransactions }, accountType, auditMonths, text);
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
