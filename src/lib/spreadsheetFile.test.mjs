import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { parseSpreadsheetFile, parseDelimitedTable, buildCleanedStatement, rowsToTable, toSpreadsheetCell } from "./spreadsheetFile.ts";
import { tableToTransactions } from "../../supabase/functions/financial-audit/spreadsheet.ts";
import { applyFinancialAuditRules } from "../../supabase/functions/financial-audit/auditRules.ts";

test("toSpreadsheetCell keeps numbers numeric, dates ISO and blanks empty", () => {
  assert.equal(toSpreadsheetCell(1234.5), 1234.5);
  assert.equal(toSpreadsheetCell(new Date("2026-08-02T00:00:00Z")), "2026-08-02");
  assert.equal(toSpreadsheetCell(null), "");
  assert.equal(toSpreadsheetCell(undefined), "");
  assert.equal(toSpreadsheetCell(true), "true");
  assert.equal(toSpreadsheetCell(" SAVINGS "), " SAVINGS ");
});

test("rowsToTable drops fully blank rows", () => {
  const table = rowsToTable([["a", "b"], ["", ""], [null, undefined]]);
  assert.deepEqual(table, [["a", "b"]]);
});

// Build an xlsx file in memory, exactly as an upload would arrive, then run the
// real parse function over it.
function workbookFile(rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Statement");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([new Uint8Array(buffer)], "statement.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

test("an uploaded xlsx workbook becomes the shared transaction table", async () => {
  const file = workbookFile([
    ["Date", "Description", "Debit", "Credit", "Balance"],
    [new Date("2026-08-01T00:00:00Z"), "Opening Balance", "", "", 100000],
    [new Date("2026-08-02T00:00:00Z"), "SALARY PAYMENT", "", 50000, 150000],
    [new Date("2026-08-03T00:00:00Z"), "POS PURCHASE", 20000, "", 130000],
    ["", "", "", "", ""],
  ]);

  const { table, preview } = await parseSpreadsheetFile(file);

  // Header preserved, dates as ISO, amounts numeric, blank row dropped.
  assert.equal(table.length, 4);
  assert.deepEqual(table[0], ["Date", "Description", "Debit", "Credit", "Balance"]);
  assert.deepEqual(table[1], ["2026-08-01", "Opening Balance", "", "", 100000]);
  assert.equal(table[2][3], 50000);
  assert.equal(table[3][2], 20000);
  assert.ok(preview.includes("SALARY PAYMENT"));

  // And it flows through the same deterministic rules as a CSV/PDF upload.
  const result = tableToTransactions(table);
  assert.equal(result.reconciliation.reconciled, true);
  const report = applyFinancialAuditRules(result.transactions, 1, new Date("2026-09-01T12:00:00Z"));
  assert.equal(report.totalIncome, 50000);
  assert.equal(report.totalExpenses, 20000);
});

test("CSV text becomes a preview table that totals the same way", async () => {
  const csv = [
    "Date,Description,Debit,Credit,Balance",
    "2026-08-01,Opening Balance,,,100000",
    '2026-08-02,"SALARY, PAYMENT",,50000,150000',
    "2026-08-03,POS PURCHASE,20000,,130000",
  ].join("\n");

  const table = await parseDelimitedTable(csv);

  assert.equal(table.length, 4);
  assert.deepEqual(table[0], ["Date", "Description", "Debit", "Credit", "Balance"]);
  // A quoted field keeps its embedded comma instead of splitting the row.
  assert.equal(table[2][1], "SALARY, PAYMENT");

  const result = tableToTransactions(table);
  const report = applyFinancialAuditRules(result.transactions, 1, new Date("2026-09-01T12:00:00Z"));
  assert.equal(report.totalIncome, 50000);
  assert.equal(report.totalExpenses, 20000);
});

test("empty delimited text produces no preview rows", async () => {
  assert.deepEqual(await parseDelimitedTable(""), []);
  assert.deepEqual(await parseDelimitedTable("   \n  "), []);
});

test("buildCleanedStatement turns a converted table into explicit Debit/Credit columns", async () => {
  const table = [
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["2026-08-01", "Opening Balance", "", "", 100000],
    ["2026-08-02", "SALARY PAYMENT", "", 50000, 150000],
    ["2026-08-03", "POS PURCHASE", 20000, "", 130000],
    ["2026-08-31", "Closing Balance", "", "", 130000],
  ];

  const cleaned = await buildCleanedStatement(table, 1, new Date("2026-09-01T12:00:00Z"));

  assert.deepEqual(cleaned.rows[0], ["Date", "Description", "Debit", "Credit"]);
  // Opening/closing rows are not transactions, so they never appear.
  assert.equal(cleaned.transactionCount, 2);
  assert.deepEqual(cleaned.rows.slice(1, -1), [
    ["2026-08-02", "SALARY PAYMENT", "", 50000],
    ["2026-08-03", "POS PURCHASE", 20000, ""],
  ]);
  assert.deepEqual(cleaned.rows[cleaned.rows.length - 1], ["TOTAL", "", 20000, 50000]);
  assert.equal(cleaned.totalDebit, 20000);
  assert.equal(cleaned.totalCredit, 50000);
  assert.equal(cleaned.coversWholeStatement, true);
});

test("buildCleanedStatement splits a single amount column using the type column", async () => {
  const table = [
    ["Date", "Description", "Amount", "Type"],
    ["2026-08-02", "Salary", "50,000.00", "CR"],
    ["2026-08-03", "POS purchase", "20,000.00", "DR"],
  ];

  const cleaned = await buildCleanedStatement(table, 1, new Date("2026-09-01T12:00:00Z"));

  assert.deepEqual(cleaned.rows.slice(1, -1), [
    ["2026-08-02", "Salary", "", 50000],
    ["2026-08-03", "POS purchase", 20000, ""],
  ]);
});

test("buildCleanedStatement treats negative amounts as debits", async () => {
  const table = [
    ["Date", "Description", "Amount"],
    ["2026-08-02", "Salary", 50000],
    ["2026-08-03", "POS purchase", -20000],
  ];

  const cleaned = await buildCleanedStatement(table, 1, new Date("2026-09-01T12:00:00Z"));

  assert.deepEqual(cleaned.rows.slice(1, -1), [
    ["2026-08-02", "Salary", "", 50000],
    ["2026-08-03", "POS purchase", 20000, ""],
  ]);
});

test("buildCleanedStatement reports when no transaction header can be found", async () => {
  const cleaned = await buildCleanedStatement(
    [["hello", "world"]],
    1,
    new Date("2026-09-01T12:00:00Z"),
  );

  assert.equal(cleaned.transactionCount, 0);
  assert.equal(cleaned.totalDebit, 0);
  assert.equal(cleaned.totalCredit, 0);
  assert.ok(cleaned.warnings.length > 0);
});
