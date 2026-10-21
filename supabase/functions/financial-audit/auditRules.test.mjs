import assert from "node:assert/strict";
import test from "node:test";
import { applyFinancialAuditRules, assessParserConfidence, comparePrintedTotals, getAuditWindow, parseFinancialRecords, routeSheetAudit, rowsAreFinal, splitFinancialRecords } from "./auditRules.ts";

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

test("anchors the selected period on the first source transaction month", () => {
  const dates = ["2025-01-01", "2025-02-15", "2025-03-25", "2025-04-25"];
  assert.deepEqual(
    getAuditWindow(dates, 1, new Date("2026-10-10T12:00:00Z")),
    { periodStart: "2025-01-01", periodEnd: "2025-01-31", auditMonths: 1 },
  );
  assert.deepEqual(
    getAuditWindow(dates, 3, new Date("2026-10-10T12:00:00Z")),
    { periodStart: "2025-01-01", periodEnd: "2025-03-31", auditMonths: 3 },
  );
});

test("audits a January-to-December statement from January for a 1-month audit", () => {
  const dates = [
    "2025-01-05", "2025-02-10", "2025-03-10", "2025-04-10",
    "2025-05-10", "2025-06-10", "2025-07-10", "2025-08-10",
    "2025-09-10", "2025-10-10", "2025-11-10", "2025-12-10",
  ];
  assert.deepEqual(
    getAuditWindow(dates, 1, new Date("2026-02-01T12:00:00Z")),
    { periodStart: "2025-01-01", periodEnd: "2025-01-31", auditMonths: 1 },
  );
});

test("sums only the credits and debits inside the selected months", () => {
  // A 3-month audit is anchored on the statement's first month (January), so it
  // covers January-March. The June row is outside the window and must not count.
  const report = applyFinancialAuditRules([
    { transactionId: "salary-1", date: "2025-01-30", description: "Salary", amount: 1000, type: "credit" },
    { transactionId: "fee-1", date: "2025-02-25", description: "Bank fee", amount: 20, type: "debit" },
    { transactionId: "later-1", date: "2025-06-25", description: "Later purchase", amount: 900, type: "debit" },
  ], 3, new Date("2025-06-30T12:00:00Z"));

  assert.equal(report.totalIncome, 1000);
  assert.equal(report.totalExpenses, 20);
  assert.equal(report.cashFlow, 980);
  assert.equal(report.savingsRate, 98);
  assert.equal(report.score, report.healthScore);
  assert.equal(report.transactions.length, 2);
  assert.equal(report.auditMonths, 3);
  assert.equal(report.statementMonthsCovered, 6);
  assert.equal(report.periodStart, "2025-01-01");
  assert.equal(report.periodEnd, "2025-03-31");
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

test("keeps distinct transactions that reuse the same reference", () => {
  // Wallet exports repeat a channel/reference code across many rows. Those are
  // different transactions and must both count; only exact duplicate rows are
  // collapsed.
  const report = applyFinancialAuditRules([
    { transactionId: "NIP-001", date: "2025-02-10", description: "Auto-save", amount: 200, type: "debit" },
    { transactionId: "NIP-001", date: "2025-02-11", description: "Auto-save", amount: 300, type: "debit" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.transactions.length, 2);
  assert.equal(report.totalExpenses, 500);
  assert.equal(report.dataQuality.duplicateRowsIgnored, 0);
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
    { date: "2025-02-30", description: "Invalid date", amount: 40, type: "debit" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.totalIncome, 75);
  assert.equal(report.totalExpenses, 0);
  assert.equal(report.transactions[0].date, undefined);
  assert.equal(report.dataQuality.undatedTransactions, 1);
  assert.equal(report.dataQuality.excludedInvalidTransactions, 2);
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

test("keeps undated rows only when the window covers the whole statement", () => {
  const rows = [
    { date: "2025-02-10", description: "Salary", amount: 1000, type: "credit" },
    { date: "2025-06-10", description: "June salary", amount: 9000, type: "credit" },
    { description: "Undated transfer", amount: 5000, type: "credit" },
  ];

  // A 1-month window (February) trims June, so the undated row cannot be placed
  // in the audited period; it is excluded and reported rather than guessed in.
  const partial = applyFinancialAuditRules(rows, 1, new Date("2025-06-30T12:00:00Z"));
  assert.equal(partial.totalIncome, 1000);
  assert.equal(partial.dataQuality.excludedUndatedTransactions, 1);

  // A 6-month window covers February-June, so the undated row belongs and counts.
  const whole = applyFinancialAuditRules(rows, 6, new Date("2025-06-30T12:00:00Z"));
  assert.equal(whole.totalIncome, 15000);
  assert.equal(whole.dataQuality.excludedUndatedTransactions, 0);
  assert.equal(whole.dataQuality.undatedTransactions, 1);

  const allUndated = applyFinancialAuditRules([
    { description: "Undated credit", amount: 200, type: "credit" },
    { description: "Undated debit", amount: 50, type: "debit" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(allUndated.totalIncome, 200);
  assert.equal(allUndated.totalExpenses, 50);
  assert.equal(allUndated.dataQuality.excludedUndatedTransactions, 0);
  assert.equal(allUndated.dataQuality.undatedTransactions, 2);
});

test("counts a credit/debit row that has no description", () => {
  // The extractor can return a real row without a description (e.g. a
  // column-grouped statement whose description column did not pair up). The
  // money still moved, so it must stay in income/expenses.
  const report = applyFinancialAuditRules([
    { date: "2025-02-10", description: "", amount: 2500, type: "credit" },
    { date: "2025-02-11", amount: 400, type: "debit" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.totalIncome, 2500);
  assert.equal(report.totalExpenses, 400);
  assert.equal(report.dataQuality.excludedInvalidTransactions, 0);
});

test("counts signed amounts by their explicit direction, not their sign", () => {
  const report = applyFinancialAuditRules([
    { date: "2025-02-10", description: "Signed debit", amount: -10000, type: "debit" },
    { date: "2025-02-11", description: "Signed credit", amount: -5000, type: "credit" },
    { date: "2025-02-12", description: "String debit", amount: "-2,500.00", type: "DR" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.totalIncome, 5000);
  assert.equal(report.totalExpenses, 12500);
  assert.equal(report.cashFlow, -7500);
  assert.equal(report.savingsRate, 0);
});

test("recovers rows whose dates are not already ISO formatted", () => {
  const report = applyFinancialAuditRules([
    { date: "10/02/2025", description: "Day-first credit", amount: 3000, type: "credit" },
    { date: "2025-02-11T00:00:00Z", description: "ISO datetime debit", amount: 1000, type: "debit" },
    { date: "2025-02-12", description: "Plain credit", amount: 500, type: "credit" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.totalIncome, 3500);
  assert.equal(report.totalExpenses, 1000);
  assert.equal(report.dataQuality.excludedInvalidTransactions, 0);
  assert.deepEqual(report.monthlyObservations.map((month) => month.month), ["2025-02"]);
});

test("maps credits to income and debits to expenses with correct categories", () => {
  const report = applyFinancialAuditRules([
    { date: "2025-02-03", description: "SALARY PAYROLL", amount: 250000, type: "credit" },
    { date: "2025-02-04", description: "ATM WITHDRAWAL", amount: 20000, type: "debit" },
    { date: "2025-02-05", description: "Bank charge", amount: 100, type: "debit" },
  ], 1, new Date("2025-02-28T12:00:00Z"));

  assert.equal(report.totalIncome, 250000);
  assert.equal(report.totalExpenses, 20100);
  assert.equal(report.cashFlow, 229900);
  assert.deepEqual(report.topSpendingCategories.map((category) => category.name), ["withdrawals", "bank charges"]);
  assert.equal(report.leakages.length, 1);
  assert.equal(report.incomeSources[0].name, "SALARY PAYROLL");
  assert.equal(report.incomeSources[0].amount, 250000);
});

test("monthly breakdown reconciles with the period totals", () => {
  const report = applyFinancialAuditRules([
    { date: "2025-01-05", description: "Salary", amount: 1000, type: "credit" },
    { date: "2025-01-09", description: "Rent", amount: 400, type: "debit" },
    { date: "2025-02-05", description: "Salary", amount: 1200, type: "credit" },
    { date: "2025-02-09", description: "Groceries", amount: 300, type: "debit" },
  ], 3, new Date("2025-03-01T12:00:00Z"));

  const monthlyIncome = report.monthlyObservations.reduce((sum, month) => sum + month.income, 0);
  const monthlyOutflows = report.monthlyObservations.reduce((sum, month) => sum + month.outflows, 0);
  assert.equal(monthlyIncome, report.totalIncome);
  assert.equal(monthlyOutflows, report.totalExpenses);
  assert.equal(report.totalIncome, 2200);
  assert.equal(report.totalExpenses, 700);
  assert.equal(report.cashFlow, 1500);
});

test("ignores a running balance when a row has no CR/DR marker", () => {
  const transactions = parseFinancialRecords([
    "05/08/2026 POS SHOP 4500.00 300000.00",
    "06/08/2026 TRANSFER TO SAVINGS 5000.00 295000.00",
  ].join("\n"));

  assert.deepEqual(transactions.map(({ amount, type }) => ({ amount, type })), [
    { amount: 4500, type: "debit" },
    { amount: 5000, type: "debit" },
  ]);
});

test("keeps the transaction id when stripping a balance figure", () => {
  const transactions = parseFinancialRecords(
    "Alert: Withdrawal NGN25,000.00 on 12/07/26 by POS. Avail Bal: NGN612,000.00. Txn ID: 1001.",
  );

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, 25000);
  assert.equal(transactions[0].type, "debit");
  assert.equal(transactions[0].transactionId, "1001");
});

test("skips an empty debit/credit column and reads the real amount", () => {
  const transactions = parseFinancialRecords([
    "06/08/2026 CHEQUE DEPOSIT 0.00 250,000.00 940,000.00",
    "07/08/2026 POS PURCHASE 10,000.00 0.00 930,000.00",
  ].join("\n"));

  assert.deepEqual(transactions.map(({ amount, type }) => ({ amount, type })), [
    { amount: 250000, type: "credit" },
    { amount: 10000, type: "debit" },
  ]);
});

test("does not treat a labelled balance as a transaction amount", () => {
  const transactions = parseFinancialRecords(
    "06/08/2026 POS PURCHASE 10,000.00 Ledger Balance: NGN690,000.00",
  );

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, 10000);
  assert.equal(transactions[0].type, "debit");
});

test("is deterministic: identical text yields identical transactions and totals", () => {
  const text = [
    "Alert: Credit of NGN350,000.00 on 05/07/26. Desc: Salary. Avail Bal: NGN637,000.00",
    "Alert: Withdrawal NGN25,000.00 on 12/07/26 by POS. Avail Bal: NGN612,000.00",
    "Alert: Bank charge NGN52.00 on 08/06/26. Avail Bal: NGN301,250.00",
  ].join("\n");

  const first = applyFinancialAuditRules(parseFinancialRecords(text), 3, new Date("2026-08-01T12:00:00Z"));
  const second = applyFinancialAuditRules(parseFinancialRecords(text), 3, new Date("2026-08-01T12:00:00Z"));

  assert.deepEqual(first.transactions, second.transactions);
  assert.equal(first.totalIncome, second.totalIncome);
  assert.equal(first.totalExpenses, second.totalExpenses);
  assert.equal(first.totalIncome, 350000);
  assert.equal(first.totalExpenses, 25052);
});

test("infers direction from the running balance for neutral descriptions", () => {
  const transactions = parseFinancialRecords([
    "05/08/2026 OPENING BALANCE 100,000.00",
    "06/08/2026 ACME SUPERMARKET 20,000.00 80,000.00",
    "07/08/2026 SALARY MAY 250,000.00 330,000.00",
    "08/08/2026 JOHN DOE 5,000.00 325,000.00",
  ].join("\n"));

  assert.deepEqual(transactions.map(({ amount, type }) => ({ amount, type })), [
    { amount: 20000, type: "debit" },
    { amount: 250000, type: "credit" },
    { amount: 5000, type: "debit" },
  ]);
});

test("handles row numbers and empty debit/credit columns on statement rows", () => {
  const transactions = parseFinancialRecords([
    "05/08/2026 OPENING BALANCE 100,000.00",
    "1  06/08/2026 ACME SUPERMARKET  20,000.00  0.00  80,000.00",
    "2  07/08/2026 SALARY MAY  0.00  250,000.00  330,000.00",
  ].join("\n"));

  assert.deepEqual(transactions.map(({ amount, type }) => ({ amount, type })), [
    { amount: 20000, type: "debit" },
    { amount: 250000, type: "credit" },
  ]);
});

test("parses month-name and name-first date formats", () => {
  const transactions = parseFinancialRecords([
    "05-Aug-2026 OPENING BALANCE 100,000.00",
    "06-Aug-2026 ACME SUPERMARKET 20,000.00 80,000.00",
    "07 August 2026 SALARY MAY 250,000.00 330,000.00",
    "Aug 08, 2026 JOHN DOE 5,000.00 325,000.00",
  ].join("\n"));

  assert.deepEqual(transactions.map(({ date, amount, type }) => ({ date, amount, type })), [
    { date: "2026-08-06", amount: 20000, type: "debit" },
    { date: "2026-08-07", amount: 250000, type: "credit" },
    { date: "2026-08-08", amount: 5000, type: "debit" },
  ]);
});

test("never treats an opening or closing balance line as a transaction", () => {
  const transactions = parseFinancialRecords([
    "05/08/2026 Opening Balance 100,000.00",
    "06/08/2026 POS PURCHASE 10,000.00 90,000.00",
    "07/08/2026 Closing Balance 90,000.00",
  ].join("\n"));

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, 10000);
  assert.equal(transactions[0].type, "debit");
});

test("reads PDF rows whose columns are jammed together with no separators", () => {
  const transactions = parseFinancialRecords([
    "05/08/2026TRANSFER FROM EMPLOYER250,000.00700,000.00",
    "06/08/2026POS PURCHASE10,000.00690,000.00",
  ].join("\n"));

  assert.deepEqual(
    transactions.map(({ date, amount, type, description }) => ({ date, amount, type, description })),
    [
      { date: "2026-08-05", amount: 250000, type: "credit", description: "TRANSFER FROM EMPLOYER" },
      { date: "2026-08-06", amount: 10000, type: "debit", description: "POS PURCHASE" },
    ],
  );
});

test("keeps the date the direction keyword and the amount when the date is glued to the keyword", () => {
  const transactions = parseFinancialRecords("05/08/2026TRANSFER FROM EMPLOYER250,000.00700,000.00");

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].date, "2026-08-05");
  assert.equal(transactions[0].amount, 250000);
  assert.equal(transactions[0].type, "credit");
  assert.equal(transactions[0].description, "TRANSFER FROM EMPLOYER");
});

test("reads amounts written with spaces as thousands separators", () => {
  const transactions = parseFinancialRecords("05/08/2026 POS PURCHASE 10 000.00 690 000.00");

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, 10000);
  assert.equal(transactions[0].type, "debit");
  assert.equal(transactions[0].description, "POS PURCHASE");
});

test("never splits a normal two-decimal amount when normalising a line", () => {
  const transactions = parseFinancialRecords([
    "05-Aug-2026 OPENING BALANCE 100,000.00",
    "06-Aug-2026 ACME SUPERMARKET 20,000.00 80,000.00",
  ].join("\n"));

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, 20000);
  assert.equal(transactions[0].type, "debit");
});

test("reconciles a jammed PDF statement against the closing balance", () => {
  const transactions = parseFinancialRecords([
    "05/08/2026OPENING BALANCE100,000.00",
    "06/08/2026TRANSFER FROM EMPLOYER250,000.00350,000.00",
    "07/08/2026POS PURCHASE10,000.00340,000.00",
    "08/08/2026SALARY MAY250,000.00590,000.00",
  ].join("\n"));

  const credits = transactions.filter((t) => t.type === "credit").reduce((sum, t) => sum + t.amount, 0);
  const debits = transactions.filter((t) => t.type === "debit").reduce((sum, t) => sum + t.amount, 0);

  assert.equal(transactions.length, 3);
  assert.equal(credits, 500000);
  assert.equal(debits, 10000);
  assert.equal(100000 + credits - debits, 590000);
});



test("flags a column-grouped statement as unreliable to parse", () => {
  // A wallet export whose table columns were split by the PDF extractor: many
  // header cells, but the amounts/dates live in separate column blocks so the
  // row parser cannot build real transaction rows.
  const text = [
    "Trans. Time", "Value Date", "Description", "Debit(NGN)", "Credit(NGN)", "Balance After",
    "02 Aug 2026 22:26:07", "02 Aug 2026", "OWealth Withdrawal",
    "100.00", "0.00", "100.00",
    "Total Debit", "284,922.80", "Total Credit", "284,922.80",
  ].join("\n");
  const parsed = parseFinancialRecords(text);
  const confidence = assessParserConfidence(text, parsed);
  assert.equal(confidence.reliable, false);
});

test("flags a statement whose parsed totals disagree with the printed totals", () => {
  // Rows parse fine, but the statement's own printed totals do not match what
  // the parser summed -> the layout was misread.
  const text = [
    "05/08/2026 SALARY 250,000.00 CR 250,000.00",
    "Total Credit 999,999.99",
  ].join("\n");
  const parsed = parseFinancialRecords(text);
  const confidence = assessParserConfidence(text, parsed);
  assert.equal(confidence.reliable, false);
});

test("accepts a clean row-per-line statement that reconciles with printed totals", () => {
  const text = [
    "05/08/2026 SALARY 250,000.00 CR 250,000.00",
    "06/08/2026 POS PURCHASE 10,000.00 DR 240,000.00",
    "Total Credit 250,000.00",
    "Total Debit 10,000.00",
  ].join("\n");
  const parsed = parseFinancialRecords(text);
  const confidence = assessParserConfidence(text, parsed);
  assert.equal(confidence.reliable, true);
});

test("comparePrintedTotals reports matching printed totals", () => {
  const text = [
    "05/08/2026 SALARY 250,000.00 CR 250,000.00",
    "06/08/2026 POS PURCHASE 10,000.00 DR 240,000.00",
    "Total Credit 250,000.00",
    "Total Debit 10,000.00",
  ].join("\n");
  const parsed = parseFinancialRecords(text);
  const totals = comparePrintedTotals(text, parsed);
  assert.equal(totals.printedCredit, 250000);
  assert.equal(totals.printedDebit, 10000);
  assert.equal(totals.parsedCredits, 250000);
  assert.equal(totals.parsedDebits, 10000);
  assert.equal(totals.creditMatches, true);
  assert.equal(totals.debitMatches, true);
});

test("comparePrintedTotals reports a mismatch and leaves absent totals undefined", () => {
  const text = [
    "05/08/2026 SALARY 250,000.00 CR 250,000.00",
    "Total Credit 999,999.99",
  ].join("\n");
  const parsed = parseFinancialRecords(text);
  const totals = comparePrintedTotals(text, parsed);
  assert.equal(totals.creditMatches, false);
  // No "Total Debit" was printed, so that side cannot be judged.
  assert.equal(totals.debitMatches, undefined);
  assert.equal(totals.printedDebit, undefined);
});

// The Python port sums the same statement on the desktop side, so both ports are
// held to the figures in tools/expected-rules.txt. This half guards the file the
// app actually shows; tools/tests/test_rules_parity.py guards Python against the
// same file, so an arithmetic change on either side is caught straight away.
test("the shared parity fixture produces the documented figures", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");

  const here = dirname(fileURLToPath(import.meta.url));
  const raw = await readFile(resolve(here, "../../../tools/expected-rules.txt"), "utf8");
  const expected = Object.fromEntries(
    raw.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );

  const report = applyFinancialAuditRules([
    { date: "2025-01-05", description: "Salary", amount: 500000, type: "credit" },
    { date: "2025-01-10", description: "Rent payment", amount: 120000, type: "debit" },
    { date: "2025-01-11", description: "Bank fee", amount: 2000, type: "debit" },
    { date: "2025-01-12", description: "Transfer to John", amount: 58000, type: "debit" },
  ], 1);

  assert.equal(report.rulesVersion, expected.rulesVersion);
  assert.equal(report.totalIncome, Number(expected.totalIncome));
  assert.equal(report.totalExpenses, Number(expected.totalExpenses));
  assert.equal(report.cashFlow, Number(expected.cashFlow));
  assert.equal(report.savingsRate, Number(expected.savingsRate));
  assert.equal(report.score, Number(expected.score));
  assert.equal(report.healthStatus, expected.healthStatus);
});

// The figures must not depend on whether a model happened to be reachable, so
// when a real reader produced the rows the auditor keeps them. These are the
// readers that count as real: the OpenCV service, and the browser for a file
// that was already a spreadsheet.
test("rows from a real reader are final and never re-read by AI", () => {
  assert.equal(rowsAreFinal("opencv"), true);
  assert.equal(rowsAreFinal("browser-spreadsheet"), true);
});

test("a table reconstructed from text without a real reader is not final", () => {
  // No reader, an older client, or the pdf-parse text fallback: the caller may
  // still cross-check these rows against the statement text.
  assert.equal(rowsAreFinal(""), false);
  assert.equal(rowsAreFinal("pdf-parse"), false);
  assert.equal(rowsAreFinal("unknown-reader"), false);
});

// A scanned statement is the case that broke: OpenCV reads the page and returns
// a table, but for a scan with no ruling that table has one cell per line and no
// date/amount columns, so it yields no rows. The audit must not then re-read the
// OCR text with the AI — that produced figures unrelated to the reader's own
// columns on the audit page while the preview showed the real ones.
test("a reader's table is summed, and is never replaced by a text re-read", () => {
  // Rows came out: sum them.
  assert.equal(routeSheetAudit({ tableReader: "opencv", hasTable: true, transactionCount: 4 }), "sum-rows");

  // The reader's table could not be broken into rows: say so, do not re-read.
  assert.equal(routeSheetAudit({ tableReader: "opencv", hasTable: true, transactionCount: 0 }), "reader-unreadable");
  assert.equal(routeSheetAudit({ tableReader: "browser-spreadsheet", hasTable: true, transactionCount: 0 }), "reader-unreadable");
});

test("only a request with no page reading is read from its text", () => {
  // Pasted text or a text-only upload: nothing looked at a page.
  assert.equal(routeSheetAudit({ tableReader: "", hasTable: false, transactionCount: 0 }), "read-text");
  assert.equal(routeSheetAudit({ tableReader: "pdf-parse", hasTable: false, transactionCount: 0 }), "read-text");

  // A table without a named reader is still summed, as it was before.
  assert.equal(routeSheetAudit({ tableReader: "", hasTable: true, transactionCount: 3 }), "sum-rows");
  assert.equal(routeSheetAudit({ tableReader: "", hasTable: true, transactionCount: 0 }), "sum-rows");
});