import assert from "node:assert/strict";
import test from "node:test";
import { applyFinancialAuditRules } from "./auditRules.ts";
import { classifyHeader, detectHeader, parseCsv, tableToTransactions } from "./spreadsheet.ts";
import { itemsToTable } from "../parse-statement/pdfText.ts";

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

test("parses simple comma-separated rows", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("handles quoted fields with embedded delimiters and newlines", () => {
  const rows = parseCsv('date,description,amount\r\n05/08/2026,"POS, LAGOS",1000\r\n06/08/2026,"line one\nline two",2000');
  assert.deepEqual(rows, [
    ["date", "description", "amount"],
    ["05/08/2026", "POS, LAGOS", "1000"],
    ["06/08/2026", "line one\nline two", "2000"],
  ]);
});

test("honours doubled quotes, semicolons and a BOM", () => {
  const rows = parseCsv('\uFEFFdate;description;amount\n05/08/2026;"say ""hi""";1000');
  assert.deepEqual(rows, [
    ["date", "description", "amount"],
    ["05/08/2026", 'say "hi"', "1000"],
  ]);
});

// ---------------------------------------------------------------------------
// classifyHeader / detectHeader
// ---------------------------------------------------------------------------

test("classifies common statement column headers", () => {
  assert.equal(classifyHeader("Transaction Date"), "date");
  assert.equal(classifyHeader("Value Date"), "date");
  assert.equal(classifyHeader("Trans. Time"), "date");
  assert.equal(classifyHeader("Narration"), "description");
  assert.equal(classifyHeader("Debit(₦)"), "debit");
  assert.equal(classifyHeader("Credit"), "credit");
  assert.equal(classifyHeader("Withdrawal"), "debit");
  assert.equal(classifyHeader("Deposit"), "credit");
  assert.equal(classifyHeader("Amount(NGN)"), "amount");
  assert.equal(classifyHeader("Balance After"), "balance");
  assert.equal(classifyHeader("Transaction Reference"), "reference");
  assert.equal(classifyHeader("Channel"), "ignore");
});

test("finds a header below leading title rows", () => {
  const header = detectHeader([
    ["Moniepoint MFB Limited"],
    ["Statement of Account"],
    ["Date", "Narration", "Debit", "Credit", "Balance"],
  ]);
  assert.ok(header);
  assert.equal(header.index, 2);
  assert.equal(header.roles.description, 1);
  assert.equal(header.roles.debit, 2);
  assert.equal(header.roles.credit, 3);
  assert.equal(header.roles.balance, 4);
});

test("reports no header when the table has no transaction columns", () => {
  assert.equal(detectHeader([["foo", "bar"], ["1", "2"]]), null);
});

// ---------------------------------------------------------------------------
// tableToTransactions
// ---------------------------------------------------------------------------

const debitCreditTable = [
  ["Date", "Description", "Debit", "Credit", "Balance"],
  ["2026-08-01", "Opening Balance", "", "", "100,000.00"],
  ["2026-08-02", "SALARY PAYMENT", "", "50,000.00", "150,000.00"],
  ["2026-08-03", "POS PURCHASE", "20,000.00", "", "130,000.00"],
  ["2026-08-31", "Closing Balance", "", "", "130,000.00"],
];

test("reads debit and credit columns and skips summary rows", () => {
  const result = tableToTransactions(debitCreditTable);
  assert.equal(result.transactions.length, 2);
  assert.deepEqual(
    result.transactions.map(({ date, amount, type }) => ({ date, amount, type })),
    [
      { date: "2026-08-02", amount: 50000, type: "credit" },
      { date: "2026-08-03", amount: 20000, type: "debit" },
    ],
  );
});

test("reconciles opening + credits - debits against the closing balance", () => {
  const { reconciliation } = tableToTransactions(debitCreditTable);
  assert.equal(reconciliation.opening, 100000);
  assert.equal(reconciliation.closing, 130000);
  assert.equal(reconciliation.credits, 50000);
  assert.equal(reconciliation.debits, 20000);
  assert.equal(reconciliation.expectedClosing, 130000);
  assert.equal(reconciliation.difference, 0);
  assert.equal(reconciliation.reconciled, true);
});

test("flags a statement that does not reconcile", () => {
  const result = tableToTransactions([
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["2026-08-01", "Opening Balance", "", "", "100,000.00"],
    ["2026-08-02", "SALARY PAYMENT", "", "50,000.00", "150,000.00"],
    ["2026-08-03", "POS PURCHASE", "20,000.00", "", "999,999.00"],
  ]);
  assert.equal(result.reconciliation.reconciled, false);
  assert.ok(result.warnings.some((warning) => /does not reconcile/i.test(warning)));
});

test("resolves direction from an explicit type column", () => {
  const result = tableToTransactions([
    ["Date", "Description", "Amount", "Type", "Balance"],
    ["2026-08-02", "SALARY PAYMENT", "50,000.00", "CR", "150,000.00"],
    ["2026-08-03", "POS PURCHASE", "20,000.00", "DR", "130,000.00"],
  ]);
  assert.deepEqual(result.transactions.map(({ amount, type }) => ({ amount, type })), [
    { amount: 50000, type: "credit" },
    { amount: 20000, type: "debit" },
  ]);
});

test("resolves direction from the sign of a single amount column", () => {
  const result = tableToTransactions([
    ["Date", "Description", "Amount"],
    ["2026-08-02", "SALARY PAYMENT", "50,000.00"],
    ["2026-08-03", "POS PURCHASE", "-20,000.00"],
  ]);
  assert.deepEqual(result.transactions.map(({ amount, type }) => ({ amount, type })), [
    { amount: 50000, type: "credit" },
    { amount: 20000, type: "debit" },
  ]);
});

test("infers direction from running-balance movements when no amount column exists", () => {
  const result = tableToTransactions([
    ["Date", "Description", "Balance"],
    ["2026-08-01", "Opening Balance", "100,000.00"],
    ["2026-08-02", "SALARY PAYMENT", "150,000.00"],
    ["2026-08-03", "POS PURCHASE", "130,000.00"],
  ]);
  assert.deepEqual(result.transactions.map(({ amount, type }) => ({ amount, type })), [
    { amount: 50000, type: "credit" },
    { amount: 20000, type: "debit" },
  ]);
  assert.equal(result.reconciliation.reconciled, true);
});

test("never counts a printed total row as a transaction", () => {
  const result = tableToTransactions([
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["2026-08-02", "SALARY PAYMENT", "", "50,000.00", "150,000.00"],
    ["2026-08-03", "POS PURCHASE", "20,000.00", "", "130,000.00"],
    ["", "Total", "20,000.00", "50,000.00", "130,000.00"],
  ]);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.reconciliation.debits, 20000);
  assert.equal(result.reconciliation.credits, 50000);
});

test("ignores a repeated header row in the middle of the table", () => {
  const result = tableToTransactions([
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["2026-08-02", "SALARY PAYMENT", "", "50,000.00", "150,000.00"],
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["2026-08-03", "POS PURCHASE", "20,000.00", "", "130,000.00"],
  ]);
  assert.equal(result.transactions.length, 2);
});

test("returns a warning instead of guessing when there is no header", () => {
  const result = tableToTransactions([["alpha", "beta"], ["1", "2"]]);
  assert.equal(result.transactions.length, 0);
  assert.ok(result.warnings.some((warning) => /no header/i.test(warning)));
});

// ---------------------------------------------------------------------------
// Integration with the existing rules engine
// ---------------------------------------------------------------------------

test("feeds the rules engine consistent income and expenses", () => {
  const sheet = tableToTransactions([
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["2026-08-01", "Opening Balance", "", "", "100,000.00"],
    ["2026-08-02", "SALARY PAYMENT", "", "50,000.00", "150,000.00"],
    ["2026-08-03", "BONUS", "", "25,000.00", "175,000.00"],
    ["2026-08-04", "POS PURCHASE", "20,000.00", "", "155,000.00"],
    ["2026-08-05", "TRANSFER TO LANDLORD", "35,000.00", "", "120,000.00"],
  ]);
  const report = applyFinancialAuditRules(sheet.transactions, 1, new Date("2026-09-01T12:00:00Z"));
  assert.equal(report.totalIncome, 75000);
  assert.equal(report.totalExpenses, 55000);
  assert.equal(report.transactions.length, 4);
});

test("a CSV upload flows through parseCsv into consistent totals", () => {
  const csv = [
    "Date,Description,Debit,Credit,Balance",
    '2026-08-01,Opening Balance,,,"100,000.00"',
    '2026-08-02,SALARY PAYMENT,,"50,000.00","150,000.00"',
    '2026-08-03,POS PURCHASE,"20,000.00",,"130,000.00"',
  ].join("\n");

  const sheet = tableToTransactions(parseCsv(csv));
  assert.equal(sheet.reconciliation.reconciled, true);

  const report = applyFinancialAuditRules(sheet.transactions, 1, new Date("2026-09-01T12:00:00Z"));
  assert.equal(report.totalIncome, 50000);
  assert.equal(report.totalExpenses, 20000);
});

test("a PDF reconstructed into a table yields consistent totals", () => {
  // The same table as the pdfText tests, expressed as PDF text items.
  const items = [
    { str: "Date", transform: [1, 0, 0, 10, 40, 700], width: 22, height: 10 },
    { str: "Description", transform: [1, 0, 0, 10, 110, 700], width: 55, height: 10 },
    { str: "Debit", transform: [1, 0, 0, 10, 330, 700], width: 25, height: 10 },
    { str: "Credit", transform: [1, 0, 0, 10, 400, 700], width: 28, height: 10 },
    { str: "Balance", transform: [1, 0, 0, 10, 470, 700], width: 38, height: 10 },
    { str: "01/08/2026", transform: [1, 0, 0, 10, 40, 690], width: 52, height: 10 },
    { str: "OPENING BALANCE", transform: [1, 0, 0, 10, 110, 690], width: 80, height: 10 },
    { str: "100,000.00", transform: [1, 0, 0, 10, 470, 690], width: 56, height: 10 },
    { str: "02/08/2026", transform: [1, 0, 0, 10, 40, 680], width: 52, height: 10 },
    { str: "SALARY PAYMENT", transform: [1, 0, 0, 10, 110, 680], width: 78, height: 10 },
    { str: "50,000.00", transform: [1, 0, 0, 10, 404, 680], width: 52, height: 10 },
    { str: "150,000.00", transform: [1, 0, 0, 10, 470, 680], width: 56, height: 10 },
    { str: "03/08/2026", transform: [1, 0, 0, 10, 40, 670], width: 52, height: 10 },
    { str: "POS PURCHASE", transform: [1, 0, 0, 10, 110, 670], width: 70, height: 10 },
    { str: "20,000.00", transform: [1, 0, 0, 10, 330, 670], width: 50, height: 10 },
    { str: "130,000.00", transform: [1, 0, 0, 10, 470, 670], width: 56, height: 10 },
  ];

  const sheet = tableToTransactions(itemsToTable(items));
  const report = applyFinancialAuditRules(sheet.transactions, 1, new Date("2026-09-01T12:00:00Z"));
  assert.equal(report.totalIncome, 50000);
  assert.equal(report.totalExpenses, 20000);
});
