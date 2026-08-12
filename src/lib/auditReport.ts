import { supabase } from "@/integrations/supabase/client";
import { HEALTH_STATUS_META, formatNaira } from "@/lib/auditor";

interface AuditForReport {
  health_score: number;
  health_status: string;
  total_income: number;
  total_expenses: number;
  cash_flow: number;
  savings_rate: number;
  recoverable_amount: number;
  audit_period_start: string | null;
  audit_period_end: string | null;
  source_id: string | null;
  report_json: Record<string, unknown> | null;
  created_at: string;
}

interface ReportJson {
  leakages?: { description: string; amount: number }[];
  recommendations?: { title: string; description: string }[];
  recoverable?: { description: string; amount: number; category?: string; transactionDate?: string; sourceAmount?: number; sourceType?: string }[];
  summary?: {
    incomeSources?: { name: string; amount: number }[];
    topSpendingCategories?: { name: string; amount: number }[];
  };
}

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function buildReportHTML(userName: string, audit: AuditForReport, dataSource: string): string {
  const report = (audit.report_json ?? {}) as ReportJson;
  const statusMeta = HEALTH_STATUS_META[audit.health_status as keyof typeof HEALTH_STATUS_META];
  const statusLabel = statusMeta?.label ?? audit.health_status ?? "—";

  const period = `${formatDate(audit.audit_period_start)} – ${formatDate(audit.audit_period_end)}`;

  // Estimated balance sheet (audit data does not include a full balance sheet)
  const assets = Math.max(0, audit.total_income);
  const liabilities = Math.max(0, audit.total_expenses);
  const equity = audit.cash_flow;

  // Leakage findings
  const leakages = (report.leakages ?? []).slice(0, 12);
  const leakageRows = leakages.length
    ? leakages.map((l) => `<li>${esc(l.description)} — ${formatNaira(l.amount)}</li>`).join("\n")
    : "<li>No major recurring leakages identified beyond routine bank charges.</li>";

  // Traceable recoverables
  const recoverables = (report.recoverable ?? []).slice(0, 20);
  const recoverableRows = recoverables.length
    ? recoverables
        .map(
          (r) => `<tr>
      <td>${esc(formatDate(r.transactionDate))}</td>
      <td>${esc(r.description)}</td>
      <td class="capitalize">${esc(r.category ?? "—")}</td>
      <td class="num">${r.sourceAmount != null ? formatNaira(r.sourceAmount) : "—"}</td>
      <td class="num">${formatNaira(r.amount)}</td>
    </tr>`,
        )
        .join("\n")
    : "";

  // Recommendations
  const recommendations = (report.recommendations ?? []).slice(0, 8);
  const recommendationRows = recommendations.length
    ? recommendations.map((r, i) => `<li><strong>${i + 1}. ${esc(r.title)}</strong> — ${esc(r.description)}</li>`).join("\n")
    : "<li>Maintain your current positive momentum and re-audit in a few months.</li>";

  // Personalized health insights
  const topSpend = (report.summary?.topSpendingCategories ?? []).slice(0, 3).map((c) => c.name).join(", ");
  const insights = [
    `Your Financial Health Score is ${audit.health_score}/100, placing your finances in the "${statusLabel}" category.`,
    audit.cash_flow >= 0
      ? `You recorded a positive net cash flow of ${formatNaira(audit.cash_flow)} over the reporting period, which supports savings and resilience.`
      : `Your net cash flow of ${formatNaira(audit.cash_flow)} is negative — expenses outpaced income during the period.`,
    `Your savings rate is ${Math.round(audit.savings_rate)}% of income.`,
    topSpend ? `Your largest spending areas were ${topSpend}.` : "Spending-pattern data was limited for this period.",
    `The audit identified an estimated ${formatNaira(audit.recoverable_amount)} in potential recoverable leakage — duplicate charges, excessive bank fees, dormant subscriptions and similar drains.`,
  ].join(" ");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>AI Financial Auditor Report</title>
  <style>
    @page { margin: 2cm; }
    body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 11pt; color: #1e293b; line-height: 1.6; max-width: 210mm; margin: 0 auto; padding: 20px; }
    .title-block { text-align: center; margin-bottom: 28px; }
    .title-block h1 { font-size: 15pt; color: #1a1a2e; letter-spacing: 0.06em; margin: 0 0 4px; }
    .title-block h2 { font-size: 22pt; color: #1a1a2e; margin: 0 0 6px; }
    .title-block p { color: #64748b; margin: 2px 0; }
    .meta { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; font-size: 10.5pt; }
    .meta p { margin: 4px 0; }
    h3 { font-size: 13pt; color: #1a1a2e; border-bottom: 2px solid #2563eb; padding-bottom: 6px; margin-top: 28px; }
    ul { padding-left: 22px; }
    li { margin: 5px 0; }
    .line { margin: 10px 0; }
    .line .label { display: inline-block; width: 70%; color: #475569; }
    .line .value { font-weight: 600; }
    .statement-block { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin: 10px 0; }
    .statement-block .row { display: flex; justify-content: space-between; padding: 4px 0; }
    .statement-block .row.total { border-top: 2px solid #cbd5e1; margin-top: 6px; padding-top: 8px; font-weight: 700; }
    .note { font-size: 9pt; color: #94a3b8; font-style: italic; margin-top: 6px; }
    .recoverable-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 9.5pt; }
    .recoverable-table th, .recoverable-table td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
    .recoverable-table th { background: #f1f5f9; font-size: 9pt; }
    .recoverable-table .num { text-align: right; white-space: nowrap; }
    .recoverable-table .capitalize { text-transform: capitalize; }
    .disclaimer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 9pt; color: #64748b; }
    .powered { text-align: center; margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 10pt; color: #1a1a2e; }
    .powered p { margin: 2px 0; }
    .powered .tagline { font-size: 9pt; color: #94a3b8; font-style: italic; }
  </style>
</head>
<body>

  <div class="title-block">
    <p>${esc(userName)}</p>
    <h2>AI FINANCIAL AUDITOR</h2>
    <h1>Financial Health &amp; Financial Report</h1>
    <p>Reporting Period: ${period}</p>
    <p>Data Source: ${esc(dataSource)}</p>
  </div>

  <h3>1. EXECUTIVE FINANCIAL SUMMARY</h3>
  <div class="meta">
    <p><span class="label">Total Income</span> <span class="value">${formatNaira(audit.total_income)}</span></p>
    <p><span class="label">Total Expenses</span> <span class="value">${formatNaira(audit.total_expenses)}</span></p>
    <p><span class="label">Net Cash Flow</span> <span class="value">${formatNaira(audit.cash_flow)}</span></p>
    <p><span class="label">Financial Health Status</span> <span class="value">${statusLabel}</span></p>
    <p><span class="label">Potential Financial Leakages Identified</span> <span class="value">${formatNaira(audit.recoverable_amount)}</span></p>
  </div>

  <h3>2. INCOME STATEMENT</h3>
  <div class="statement-block">
    <div class="row"><span>Income / Revenue</span><span>${formatNaira(audit.total_income)}</span></div>
    <div class="row"><span>Total Expenses</span><span>${formatNaira(audit.total_expenses)}</span></div>
    <div class="row total"><span>Net Income</span><span>${formatNaira(audit.cash_flow)}</span></div>
  </div>

  <h3>3. CASH FLOW STATEMENT</h3>
  <div class="statement-block">
    <div class="row"><span>Total Cash Inflows</span><span>${formatNaira(audit.total_income)}</span></div>
    <div class="row"><span>Total Cash Outflows</span><span>${formatNaira(audit.total_expenses)}</span></div>
    <div class="row total"><span>Net Cash Flow</span><span>${formatNaira(audit.cash_flow)}</span></div>
  </div>

  <h3>4. BALANCE SHEET</h3>
  <div class="statement-block">
    <div class="row"><span>Assets</span><span>${formatNaira(assets)}</span></div>
    <div class="row"><span>Liabilities</span><span>${formatNaira(liabilities)}</span></div>
    <div class="row total"><span>Owner's Equity / Net Worth</span><span>${formatNaira(equity)}</span></div>
  </div>
  <p class="note">*Where sufficient data is available, the Auditor will generate an estimated balance sheet based on the financial information provided.</p>

  <h3>5. FINANCIAL LEAKAGE FINDINGS</h3>
  <p>The AI Financial Auditor identified the following potential issues:</p>
  <ul>
    ${leakageRows}
  </ul>
  <p><strong>Estimated Potential Leakage: ${formatNaira(audit.recoverable_amount)}</strong></p>

  ${recoverableRows ? `
  <h3>5A. TRACEABLE RECOVERABLE TRANSACTIONS</h3>
  <p>Each recoverable amount below is traced back to the exact transaction that caused it, so you can verify it in your statement and claim it from your bank.</p>
  <table class="recoverable-table">
    <thead>
      <tr>
        <th>Date</th>
        <th>Transaction</th>
        <th>Category</th>
        <th>Source Amount</th>
        <th>Recoverable</th>
      </tr>
    </thead>
    <tbody>
      ${recoverableRows}
    </tbody>
  </table>
  ` : ""}

  <h3>6. AI FINANCIAL HEALTH INSIGHTS</h3>
  <p>${esc(insights)}</p>

  <h3>7. AI RECOMMENDATIONS</h3>
  <ul>
    ${recommendationRows}
  </ul>

  <div class="disclaimer">
    <h3 style="margin-top: 0;">DISCLAIMER</h3>
    <p>This Financial Report is AI-generated based on the financial data provided or authorized by the user. It is intended for informational, financial-health monitoring and planning purposes only and does not constitute professional accounting, auditing, tax, investment or financial advice.</p>
    <p>Financial statements, balances and identified leakages may be estimates where the available data is incomplete or insufficient. Users should verify important findings and consult a qualified professional accountant, auditor, tax adviser or financial professional where appropriate.</p>
    <p>Investours does not represent this report as an audited financial statement or a substitute for professional accounting services.</p>
  </div>

  <div class="powered">
    <p><strong>POWERED BY</strong></p>
    <p>Investours Livelihood Kit</p>
    <p class="tagline">*AI for Financial Intelligence &amp; Income Mobility*</p>
  </div>

</body>
</html>`;
}

export async function downloadAuditReport(userName: string, audit: AuditForReport) {
  let dataSource = "Pasted statement text";
  if (audit.source_id) {
    const { data } = await supabase
      .from("financial_data_sources")
      .select("display_name, source_type")
      .eq("id", audit.source_id)
      .maybeSingle();
    if (data?.display_name) {
      dataSource = String(data.display_name);
    } else if (data?.source_type) {
      const sourceLabel: Record<string, string> = {
        sms: "Connected SMS Alerts",
        email: "Connected Email",
        pdf: "Uploaded Bank Statement",
        open_banking: "Connected Bank Account",
      };
      dataSource = sourceLabel[String(data.source_type)] ?? String(data.source_type);
    }
  }

  const html = buildReportHTML(userName, audit, dataSource);

  const win = window.open("", "_blank");
  if (!win) {
    alert("Please allow popups to download the PDF");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();

  setTimeout(() => {
    win.print();
  }, 500);
}
