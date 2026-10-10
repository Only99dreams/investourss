import assert from "node:assert/strict";
import test from "node:test";
import { applyFinancialAuditRules, getAuditWindow, splitFinancialRecords } from "./auditRules.ts";

test("chunks long statements without dropping or reordering source text", () => {
  const source = `first record\r\n${"x".repeat(50001)}\r\nlast record`;
  const chunks = splitFinancialRecords(source, 10000);
  assert.equal(chunks.join(""), source);
  assert.ok(chunks.every((chunk) => chunk.length <= 10000));
});

test("uses the latest source transaction as the selected-period anchor", () => {
  const dates = ["2025-01-01", "2025-02-15", "2025-03-25", "2025-04-25"];
  assert.deepEqual(
    getAuditWindow(dates, 1, new Date("2026-10-10T12:00:00Z")),
    { periodStart: "2025-03-25", periodEnd: "2025-04-25", auditMonths: 1 },
  );
  assert.deepEqual(
    getAuditWindow(dates, 3, new Date("2026-10-10T12:00:00Z")),
    { periodStart: "2025-01-25", periodEnd: "2025-04-25", auditMonths: 3 },
  );
});

test("derives totals and score inputs from only normalized in-window transactions", () => {
  const report = applyFinancialAuditRules([
    { transactionId: "salary-1", date: "2025-01-30", description: "Salary", amount: 1000, type: "credit" },
    { transactionId: "fee-1", date: "2025-02-25", description: "Bank fee", amount: 20, type: "debit" },
    { transactionId: "old-1", date: "2024-12-25", description: "Old purchase", amount: 900, type: "debit" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.totalIncome, 1000);
  assert.equal(report.totalExpenses, 20);
  assert.equal(report.cashFlow, 980);
  assert.equal(report.savingsRate, 98);
  assert.equal(report.transactions.length, 2);
  assert.deepEqual(report.monthlyObservations, [
    { month: "2025-01", income: 1000, outflows: 0, source: "calculated", verification: "unverified" },
    { month: "2025-02", income: 0, outflows: 20, source: "calculated", verification: "unverified" },
  ]);
  assert.equal(report.recoverableAmount, 0);
  assert.deepEqual(report.recoverable, []);
});

test("deduplicates only repeated source IDs and retains repeated real transactions", () => {
  const report = applyFinancialAuditRules([
    { transactionId: "same-id", date: "2025-02-10", description: "Transfer", amount: 100, type: "debit" },
    { transactionId: "same-id", date: "2025-02-10", description: "Transfer", amount: 100, type: "debit" },
    { date: "2025-02-10", description: "Shop purchase", amount: 25, type: "debit" },
    { date: "2025-02-10", description: "Shop purchase", amount: 25, type: "debit" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.transactions.length, 3);
  assert.equal(report.totalExpenses, 150);
  assert.equal(report.dataQuality.duplicateRowsIgnored, 1);
});

test("derives categories from source descriptions, not model category labels", () => {
  const report = applyFinancialAuditRules([
    { date: "2025-02-10", description: "Monthly bank fee", amount: 10, type: "debit", category: "shopping" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.transactions[0].category, "bank charges");
  assert.equal(report.topSpendingCategories[0].name, "bank charges");
});

test("does not invent transaction dates or treat unknown directions as income", () => {
  const report = applyFinancialAuditRules([
    { description: "Undated credit", amount: 75, type: "credit" },
    { date: "2025-02-10", description: "Unknown direction", amount: 80, type: "unknown" },
    { date: "2025-02-10", description: "Negative amount", amount: -1, type: "debit" },
    { date: "2025-02-30", description: "Invalid date", amount: 40, type: "debit" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.totalIncome, 75);
  assert.equal(report.totalExpenses, 0);
  assert.equal(report.transactions[0].date, undefined);
  assert.equal(report.dataQuality.undatedTransactions, 1);
  assert.equal(report.dataQuality.excludedInvalidTransactions, 3);
  assert.equal(report.monthlyObservations.length, 0);
});
