// Cross-check battery: run a set of cases through the TypeScript sources and dump
// inputs + outputs as JSON, so tools/tests/test_typescript_parity.py can
// recompute them with the Python port and compare.
//
//   node --experimental-strip-types tools/tests/ts_battery.mjs <repoRoot> <outJson>
//
// Keeping the Python port byte-for-byte identical to the TypeScript app is the
// whole point of the port: the same statement audited in the web app and in this
// pipeline must produce the same totals.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.argv[2];
const outPath = process.argv[3];
const load = (rel) => import(pathToFileURL(path.join(repo, rel)).href);

const rules = await load("supabase/functions/financial-audit/auditRules.ts");
const sheet = await load("supabase/functions/financial-audit/spreadsheet.ts");

const txn = (date, description, amount, type, transactionId) => ({
  ...(date ? { date } : {}),
  description,
  amount,
  type,
  ...(transactionId ? { transactionId } : {}),
});

const inputs = {
  normalizeAmount: [
    "NGN 1,250.50", "₦2,000", "", "abc", "1,000", "-1,500.75", "(1,200.00)",
    "12,345.67DR", "0", null, "1.234,56", "  500.00  ",
  ],
  roundMoney: [0.005, 1.005, 2.675, 1234.565, -3.5, 0.4999999, 1000000.005, -0.005],
  coerceIsoDate: [
    "2025-01-02", "02/01/2025", "2-Jan-25", "Jan 2, 2025", "02-01-2025",
    "31/12/2025", "Total", "2025/01/02", "01/02/26", "13/13/2025", "2025-2-3",
    "Feb 30, 2025", "2 February 2025", "05-Jul-2026",
  ],
  monthsCovered: [
    ["2025-01-05", "2025-03-31"],
    ["2025-01-01"],
    ["2025-12-31", "2026-02-01"],
    [],
    ["2025-01-05", "bad-date"],
  ],
  auditWindow: [
    { months: 1, dates: ["2025-03-15", "2025-05-02"] },
    { months: 2, dates: ["2025-01-05", "2025-11-05"] },
    { months: 3, dates: [] },
    { months: 0, dates: ["2025-04-01"] },
    { months: 12, dates: ["2025-02-28", "2025-03-01"] },
  ],
  tables: {
    debitCredit: [
      ["Date", "Description", "Debit", "Credit", "Balance"],
      ["", "Opening Balance", "", "", "0.00"],
      ["02/01/2025", "Salary", "", "1,000.00", "1,000.00"],
      ["03/01/2025", "Rent", "400.00", "", "600.00"],
    ],
    amountType: [
      ["Date", "Narration", "Amount", "Type"],
      ["02/01/2025", "Salary", "1,000.00", "CR"],
      ["03/01/2025", "Rent", "400.00", "DR"],
    ],
    signedAmount: [
      ["Date", "Description", "Amount"],
      ["02/01/2025", "Salary", "1,000.00"],
      ["03/01/2025", "Rent", "-400.00"],
    ],
    balanceDelta: [
      ["Date", "Description", "Balance"],
      ["01/02/2025", "Opening", "1,000.00"],
      ["02/02/2025", "Something", "1,500.00"],
      ["03/02/2025", "Elsewhere", "1,100.00"],
    ],
    summaryRows: [
      ["Date", "Description", "Debit", "Credit", "Balance"],
      ["", "Opening Balance", "", "", "1,000.00"],
      ["01/02/2025", "Rent", "400.00", "", "600.00"],
      ["", "Total Debit", "400.00", "", ""],
      ["", "Total Credit", "", "1,000.00", ""],
      ["", "Closing Balance", "", "", "600.00"],
    ],
    repeatedHeader: [
      ["Date", "Description", "Debit", "Credit", "Balance"],
      ["02/01/2025", "Salary", "", "1,000.00", "1,000.00"],
      ["Date", "Description", "Debit", "Credit", "Balance"],
      ["03/01/2025", "Rent", "400.00", "", "600.00"],
    ],
    withdrawalDeposit: [
      ["Date", "Narration", "Withdrawal", "Deposit", "Balance"],
      ["02/01/2025", "Salary", "", "1,000.00", "1,000.00"],
      ["03/01/2025", "Rent", "400.00", "", "600.00"],
    ],
    noHeader: [
      ["02/01/2025", "Salary", "1,000.00"],
      ["03/01/2025", "Rent", "400.00"],
    ],
    wideTitle: [
      ["Bank statement January 2025 covering the account activity for the period", "", "", ""],
      ["Date", "Description", "Amount", "Balance"],
      ["02/01/2025", "Salary", "1,000.00", "1,000.00"],
    ],
    drCrGlued: [
      ["Date", "Description", "Amount", "Balance"],
      ["02/01/2025", "Salary 1,000.00CR", "1,000.00CR", "1,000.00"],
      ["03/01/2025", "Rent 400.00DR", "400.00DR", "600.00"],
    ],
  },
  csvTexts: {
    comma: 'Date,Description,Debit,Credit\r\n"02/01/2025","Transfer, JOHN","1,000.00",""\r\n',
    semicolon: 'Date;Description;Amount\r\n"02/01/2025";"Salary";"1,000.00"\r\n',
    tabbed: 'Date\tDescription\tAmount\r\n02/01/2025\tSalary\t1,000.00\r\n',
    quotes: 'Date,Description\r\n"a ""quoted"" value",b\r\n',
  },
  textStatements: {
    jammed:
      "12/07/26POS PURCHASE5,000.00612,000.00\r\n13/07/26SALARY10,000.00622,000.00\r\n",
    headed:
      "Date Description Debit Credit Balance\r\n01/02/2025 SALARY 1,000.00 1,000.00\r\n02/02/2025 RENT 400.00 600.00\r\nTotal Debit 400.00\r\n",
    balanceMarker:
      "Description Debit Credit Balance\r\n01/02/2025 POS PURCHASE DR 5,000.00 Balance 612,000.00\r\n",
    currency:
      "01/02/2025 Transfer from JOHN NGN 1,500.00\r\n02/02/2025 Bank charge NGN 50.00\r\n",
    reference:
      "01/02/2025 Salary TXN ID: ABC-123 1,000.00\r\n",
  },
  auditSets: {
    fixture: [
      txn("2025-01-02", "Salary", 500000, "credit"),
      txn("2025-01-03", "Rent", 120000, "debit"),
      txn("2025-01-05", "POS SHOPRITE", 25000, "debit"),
      txn("2025-01-10", "Bank charge", 1000, "debit"),
      txn("2025-01-15", "POS FUEL", 30000, "debit"),
      txn("2025-01-20", "Transfer JOHN", 50000, "credit"),
      txn("2025-01-22", "ATM", 20000, "debit"),
      txn("2025-01-25", "Salary", 500000, "credit"),
      txn("2025-01-28", "POS MARKET", 40000, "debit"),
    ],
    messy: [
      txn("2025-01-02", "Salary", 100000, "credit", "TX1"),
      txn("2025-01-02", "Salary", 100000, "credit", "TX1"),
      txn("", "Undated fee", 50, "debit"),
      txn("2025-03-15", "Rent", 40000, "debit", "TX2"),
      txn("2025-11-05", "Salary", 200000, "credit", "TX3"),
      { description: "No type", amount: 500 },
      { description: "Bad date", amount: 500, type: "debit", date: "nonsense" },
      { description: "Zero", amount: 0, type: "debit", date: "2025-01-05" },
      { description: "Transfer to savings", amount: 5000, type: "debit", date: "2025-01-06" },
      { description: "Interest", amount: 10, type: "credit", date: "2025-01-07" },
      { description: "Service charge", amount: 500, type: "debit", date: "2025-01-08" },
      { description: "VAT", amount: 25, type: "debit", date: "2025-01-09" },
      { description: "Salary", amount: "1,000.00", type: "CREDIT", date: "2025-01-10" },
    ],
    spanning: [
      txn("2025-03-15", "Salary", 1000, "credit"),
      txn("2025-05-02", "Rent", 400, "debit"),
    ],
    singleYear: [
      txn("2025-01-05", "Salary", 1000, "credit"),
      txn("2025-01-06", "Rent", 400, "debit"),
    ],
  },
  printedTotals: [
    {
      text: "Total Credit: 1,050,000.00\r\nTotal Debit: 236,000.00\r\n",
      transactions: [txn("2025-01-02", "Salary", 1050000, "credit"), txn("2025-01-03", "Rent", 236000, "debit")],
    },
    {
      text: "Total Credit: 1,000.00\r\n",
      transactions: [txn("2025-01-02", "Salary", 900, "credit")],
    },
    {
      text: "No totals here\r\n",
      transactions: [txn("2025-01-02", "Salary", 900, "credit")],
    },
  ],
  confidence: [
    {
      text: "Date Description Debit Credit Balance\r\n01/02/2025 SALARY 1,000.00 1,000.00\r\n",
      transactions: [txn("2025-02-01", "SALARY", 1000, "credit")],
    },
    {
      text: "Debit Credit Balance\r\nDate Description\r\nAmount\r\n01/02/2025\r\n",
      transactions: [txn("2025-02-01", "SALARY", 1000, "credit")],
    },
    {
      text: "Total Credit: 5,000.00\r\n01/02/2025 SALARY 1,000.00\r\n",
      transactions: [txn("2025-02-01", "SALARY", 1000, "credit")],
    },
  ],
};

const ts = {};

ts.normalizeAmount = inputs.normalizeAmount.map((v) => rules.normalizeAmount(v));
ts.roundMoney = inputs.roundMoney.map((v) => rules.roundMoney(v));
ts.coerceIsoDate = inputs.coerceIsoDate.map((v) => rules.coerceIsoDate(v) ?? null);
ts.monthsCovered = inputs.monthsCovered.map((dates) =>
  rules.monthsCoveredByStatement(dates, new Date("2026-09-01T12:00:00.000Z")),
);
ts.auditWindow = inputs.auditWindow.map((c) =>
  rules.getAuditWindow(c.dates, c.months, new Date("2026-09-01T12:00:00.000Z")),
);

ts.tables = {};
for (const [name, table] of Object.entries(inputs.tables)) {
  ts.tables[name] = sheet.tableToTransactions(table);
}
ts.csvTexts = {};
for (const [name, text] of Object.entries(inputs.csvTexts)) {
  ts.csvTexts[name] = sheet.parseCsv(text);
}
ts.textStatements = {};
for (const [name, text] of Object.entries(inputs.textStatements)) {
  ts.textStatements[name] = rules.parseFinancialRecords(text);
}
ts.auditSets = {};
for (const [name, set] of Object.entries(inputs.auditSets)) {
  ts.auditSets[name] = rules.applyFinancialAuditRules(set, 1);
}
ts.printedTotals = inputs.printedTotals.map((c) => rules.comparePrintedTotals(c.text, c.transactions));
ts.confidence = inputs.confidence.map((c) => rules.assessParserConfidence(c.text, c.transactions));

fs.writeFileSync(outPath, JSON.stringify({ inputs, ts }, null, 1));
console.log("wrote", outPath);
