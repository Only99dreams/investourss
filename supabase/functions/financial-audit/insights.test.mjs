import assert from "node:assert/strict";
import test from "node:test";
import { applyFinancialAuditRules } from "./auditRules.ts";
import {
  buildExplainPrompt,
  buildInsightFacts,
  extractNumberTokens,
  sanitizeInsights,
  textMatchesFacts,
} from "./insights.ts";

// A small, fully deterministic statement: income 150,000, expenses 40,000.
const REPORT = applyFinancialAuditRules(
  [
    { date: "2026-01-05", description: "Salary", amount: 100000, type: "credit" },
    { date: "2026-01-06", description: "Transfer from savings", amount: 50000, type: "credit" },
    { date: "2026-01-07", description: "POS purchase", amount: 20000, type: "debit" },
    { date: "2026-01-08", description: "Bank fee", amount: 15000, type: "debit" },
    { date: "2026-01-09", description: "Airtime", amount: 5000, type: "debit" },
  ],
  1,
  new Date("2026-10-17T12:00:00.000Z"),
);
const FACTS = buildInsightFacts(REPORT, [
  "The statement's running balance did not tally with the summed credits and debits.",
]);

test("buildInsightFacts exposes the verified totals with display strings", () => {
  const income = FACTS.figures.find((f) => f.label === "Total income");
  const expenses = FACTS.figures.find((f) => f.label === "Total expenses");
  const cashFlow = FACTS.figures.find((f) => f.label === "Net cash flow");
  assert.equal(income?.value, 150000);
  assert.equal(income?.display, "₦150,000.00");
  assert.equal(expenses?.value, 40000);
  assert.equal(cashFlow?.value, 110000);
  assert.equal(FACTS.figures.find((f) => f.label === "Transactions reviewed")?.value, 5);
});

test("buildInsightFacts computes category and income shares deterministically", () => {
  const charges = FACTS.topSpendingCategories.find((c) => c.name === "bank charges");
  assert.equal(charges?.amount, 15000);
  assert.equal(charges?.share, 37.5); // 15,000 / 40,000
  const salary = FACTS.incomeSources.find((s) => s.name === "Salary");
  assert.equal(salary?.share, 66.7); // 100,000 / 150,000 rounded to 1dp
});

test("buildExplainPrompt lists the figures and forbids new numbers", () => {
  const prompt = buildExplainPrompt(FACTS);
  assert.match(prompt, /FACTS/);
  assert.match(prompt, /Total income: ₦150,000\.00/);
  assert.match(prompt, /do not add any number that is not in FACTS/);
});

test("textMatchesFacts accepts a real figure and rejects an invented one", () => {
  assert.equal(textMatchesFacts("Your total income was ₦150,000.00.", FACTS), true);
  assert.equal(textMatchesFacts("You lost ₦999,999.00 to fees.", FACTS), false);
});

test("textMatchesFacts allows percentages within rounding but not fabricated ones", () => {
  assert.equal(textMatchesFacts("a savings rate of 73%.", FACTS), true);
  assert.equal(textMatchesFacts("a savings rate of 25%.", FACTS), false);
});

test("textMatchesFacts ignores ISO dates and allows structural small integers", () => {
  assert.equal(textMatchesFacts("across 3 months in 2026.", FACTS), true);
  assert.deepEqual(extractNumberTokens("across 3 months in 2026").map((t) => t.value), [3, 2026]);
  assert.equal(textMatchesFacts("the period 2026-01-01 to 2026-01-31", FACTS), true);
});

test("sanitizeInsights keeps valid prose and drops untraceable figures", () => {
  const raw = {
    summary:
      "Your total income was ₦150,000.00 and total expenses ₦40,000.00. You spent ₦777,777.00 on mystery fees.",
    highlights: ["You kept a positive net cash flow of ₦110,000.00."],
    risks: ["You lost ₦999,999.00 in fees."],
    actions: ["Automate savings."],
    limitations: [],
  };
  const { insights, droppedFigures } = sanitizeInsights(raw, FACTS);
  assert.equal(insights?.summary, "Your total income was ₦150,000.00 and total expenses ₦40,000.00.");
  assert.deepEqual(insights?.highlights, ["You kept a positive net cash flow of ₦110,000.00."]);
  assert.deepEqual(insights?.risks, []);
  assert.deepEqual(insights?.actions, ["Automate savings."]);
  assert.equal(droppedFigures, 2);
});

test("sanitizeInsights returns null when every figure is untraceable", () => {
  const { insights } = sanitizeInsights(
    { summary: "You made ₦5,000,000.00.", highlights: [], risks: [], actions: [], limitations: [] },
    FACTS,
  );
  assert.equal(insights, null);
});

test("sanitizeInsights strips markdown before validating", () => {
  const { insights } = sanitizeInsights(
    { summary: "**Total income** was ₦150,000.00.", highlights: [], risks: [], actions: [], limitations: [] },
    FACTS,
  );
  assert.equal(insights?.summary, "Total income was ₦150,000.00.");
});

test("sanitizeInsights tolerates a non-object response", () => {
  assert.deepEqual(sanitizeInsights("not json", FACTS), { insights: null, droppedFigures: 0 });
});
