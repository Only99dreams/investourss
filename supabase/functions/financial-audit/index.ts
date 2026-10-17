import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { applyFinancialAuditRules, parseFinancialRecords } from "./auditRules.ts";

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

function buildReportFromRules(rules: ReturnType<typeof applyFinancialAuditRules>, accountType: string) {
  return {
    ...rules,
    summary: {
      incomeSources: rules.incomeSources,
      topSpendingCategories: rules.topSpendingCategories,
    },
    recommendations: buildRecommendations(rules.cashFlow, rules.savingsRate, rules.leakages.length, accountType),
  };
}

function buildRecommendations(
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text = '', accountType = 'individual' } = body;
    const auditMonths = normalizeAuditMonths(body.auditMonths);

    if (!text || text.trim().length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide financial records to audit (min 10 characters).' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Everything is calculated deterministically from the extracted statement
    // text: the parser reads each row verbatim and the rules engine derives
    // income, expenses, cash flow and savings rate from those rows. No AI is
    // involved, so the same upload always produces the same figures.
    const transactions = parseFinancialRecords(text);
    const report = buildReportFromRules(applyFinancialAuditRules(transactions, auditMonths), accountType);
    const extractedCount = transactions.length;
    const excludedCount = report.dataQuality.excludedInvalidTransactions;

    if (report.transactions.length === 0) {
      const detail = extractedCount === 0
        ? 'No transaction rows could be extracted. Check that the statement text includes readable amounts and credit/debit directions, then try again.'
        : excludedCount > 0
          ? `${excludedCount} of ${extractedCount} extracted row(s) had invalid amounts, dates, descriptions, or directions.`
          : `${extractedCount} candidate row(s) were found, but none fell within the selected ${auditMonths}-month period (${report.periodStart} to ${report.periodEnd}). Try a wider audit period.`;
      return new Response(JSON.stringify({
        success: false,
        error: `No transactions could be included in the audit. ${detail}`,
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      report,
      meta: { extractionMethod: "deterministic-parser", extractedCount, excludedCount },
    }), {
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
