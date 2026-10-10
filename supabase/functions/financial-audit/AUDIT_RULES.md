# Financial Audit Rules v1.0.0

These rules are implemented by `auditRules.ts` and applied after transaction extraction for both AI and parser-fallback audits. AI output is not the source of truth for report totals, scoring, leakages, or recoveries.

Run the deterministic rule fixtures with `npm run test:audit-rules` (Node.js 24+).

## Transaction Handling

- Process the complete statement in bounded text chunks; preserve chunk order and concatenate extracted transactions before applying the period filter.
- Accept a transaction only when it has a positive finite amount, a non-empty description, and an explicit `credit` or `debit` direction.
- Accept only real calendar dates. Invalid supplied dates are excluded and counted; genuinely missing dates remain in totals but not monthly trends.
- The 1-, 3-, or 6-month window ends on the latest valid source transaction date that is not in the future. If there are no valid dates, use the audit run date as the period anchor.
- Deduplicate only repeated rows with the same exact source transaction ID. Equal date, description, and amount are not sufficient because separate purchases can be identical.
- Do not infer a missing date, direction, transaction, debt, or repayment record.

## Calculations

- Total inflows are the sum of included credits; total outflows are the sum of included debits.
- Cash flow is total inflows minus total outflows.
- Savings rate is cash flow divided by inflows, expressed as a percentage and clamped to 0-100; it is zero when there are no inflows.
- Monthly observations and scores are calculated only from dated transactions, grouped by calendar month.
- Income-source and spending-category summaries are grouped and summed from included transactions.
- Categories are assigned from transaction-description rules, not from model-provided category labels.
- The financial-health indicator starts at 55, adds 15 for positive cash flow, adds 10 for savings rate at least 20% (or 5 for at least 10%), subtracts 2 for each explicitly identified bank fee/charge up to 15 points, and clamps to 10-95. Status bands are Excellent (80+), Good (65+), Needs Attention (50+), and Critical (below 50). This is a product financial-health indicator, not a credit score or lending decision.
- Credit transactions are observed account inflows, not necessarily earned income. Internal transfers cannot be reliably excluded unless the source identifies them.

## Evidence and Limitations

- Bank fees and other outflows are not automatically recoverable. Recoverable amount remains zero unless a future rule can match a documented claim to its source transaction.
- Recommendations are rule-based prompts, not claims that a specific event occurred.
- Transaction extraction from statements can still be incomplete or misclassified. Normalization makes downstream calculations consistent; it cannot guarantee source extraction is perfect. Reports should retain their unverified source label and be reviewed against the original statement before consequential use.
