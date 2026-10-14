import assert from "node:assert/strict";
import test from "node:test";
import { applyFinancialAuditRules, getAuditWindow, parseFinancialRecords, splitFinancialRecords } from "./auditRules.ts";

test("chunks long statements without dropping or reordering source text", () => {
  const source = `first record\r\n${"x".repeat(50001)}\r\nlast record`;
  const chunks = splitFinancialRecords(source, 10000);
  assert.equal(chunks.join(""), source);
  assert.ok(chunks.every((chunk) => chunk.length <= 10000));
});

test("uses a conservative default chunk size for low token limits", () => {
  const source = "x".repeat(30001);
  const chunks = splitFinancialRecords(source);

  assert.equal(chunks.join(""), source);
  assert.ok(chunks.every((chunk) => chunk.length <= 12000));
});

test("parses common PDF rows with plain amounts and CR/DR markers", () => {
  const transactions = parseFinancialRecords([
    "05/08/2026 TRANSFER FROM EMPLOYER 250,000.00 CR 700,000.00",
    "06/08/2026 POS PURCHASE 10,000.00 DR 690,000.00",
  ].join("\n"));

  assert.deepEqual(transactions.map(({ date, amount, type }) => ({ date, amount, type })), [
    { date: "2026-08-05", amount: 250000, type: "credit" },
    { date: "2026-08-06", amount: 10000, type: "debit" },
  ]);
});

test("parses currency-prefixed SMS and signed statement amounts", () => {
  const transactions = parseFinancialRecords([
    "Alert: Credit of NGN250,000.00 on 05/08/26. Desc: Salary. Avail Bal: NGN700,000.00",
    "06/08/2026 CARD PURCHASE -10,000.00",
  ].join("\n"));

  assert.deepEqual(transactions.map(({ amount, type }) => ({ amount, type })), [
    { amount: 250000, type: "credit" },
    { amount: 10000, type: "debit" },
  ]);
});

test("parses plain whole-number amounts when transaction direction is explicit", () => {
  const transactions = parseFinancialRecords([
    "2026-05-08 SALARY CREDIT 250000",
    "2026-05-09 POS PURCHASE DEBIT 10000",
  ].join("\n"));

  assert.deepEqual(transactions.map(({ amount, type }) => ({ amount, type })), [
    { amount: 250000, type: "credit" },
    { amount: 10000, type: "debit" },
  ]);
});

test("normalizes string amounts and CR/DR direction aliases", () => {
  const report = applyFinancialAuditRules([
    { description: "Salary", amount: "NGN 1,000.00", type: "CR" },
    { description: "Purchase", amount: "₦250.00", type: "DR" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.totalIncome, 1000);
  assert.equal(report.totalExpenses, 250);
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
  assert.equal(report.score, report.healthScore);
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

test("excludes amounts and selected-period totals beyond NUMERIC(15,2) capacity", () => {
  const report = applyFinancialAuditRules([
    { date: "2025-02-10", description: "Oversized transfer", amount: 10_000_000_000_000, type: "credit" },
    { date: "2025-02-11", description: "Large deposit A", amount: 6_000_000_000_000, type: "credit" },
    { date: "2025-02-12", description: "Large deposit B", amount: 5_000_000_000_000, type: "credit" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.transactions.length, 1);
  assert.equal(report.totalIncome, 6_000_000_000_000);
  assert.equal(report.dataQuality.excludedInvalidTransactions, 2);
});
