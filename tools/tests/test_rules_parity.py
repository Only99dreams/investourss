"""A parity guard: the Python port and the TypeScript rules must agree.

The web auditor sums a statement twice — once in TypeScript (no OpenCV needed,
the figures the app shows) and once in Python (the OpenCV reader's desktop
twin). Both are translations of the same table, and a drift between them would
show up as two different totals for one uploaded statement, which is exactly
what this project set out to stop.

`expected-rules.txt` is the shared fixture: it is compared against the Python
implementation here, and `npm run test:audit-rules` compares the same text
against the TypeScript one in `supabase/functions/financial-audit/`. If either
port changes its arithmetic, its own suite fails.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from statement_audit import audit_rules  # noqa: E402
from statement_audit.version import RULES_VERSION  # noqa: E402

EXPECTED_PATH = TOOLS_DIR / "expected-rules.txt"
EXPECTED_KEYS = ("totalIncome", "totalExpenses", "cashFlow", "savingsRate", "score", "healthStatus")


def expected_lines() -> dict[str, str]:
    text = EXPECTED_PATH.read_text(encoding="utf-8")
    values: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


class RulesParityTest(unittest.TestCase):
    def test_the_shared_fixture_is_present_and_versioned(self) -> None:
        self.assertTrue(EXPECTED_PATH.exists(), f"missing {EXPECTED_PATH}")
        values = expected_lines()
        self.assertEqual(values["rulesVersion"], RULES_VERSION)
        for key in EXPECTED_KEYS:
            self.assertIn(key, values)

    def test_the_port_reproduces_the_shared_figures(self) -> None:
        values = expected_lines()
        report = audit_rules.apply_financial_audit_rules(FIXTURE, 1)
        self.assertAlmostEqual(report.totalIncome, float(values["totalIncome"]), places=2)
        self.assertAlmostEqual(report.totalExpenses, float(values["totalExpenses"]), places=2)
        self.assertAlmostEqual(report.cashFlow, float(values["cashFlow"]), places=2)
        self.assertAlmostEqual(report.savingsRate, float(values["savingsRate"]), places=2)
        self.assertEqual(report.score, int(values["score"]))
        self.assertEqual(report.healthStatus, values["healthStatus"])


# Deliberately plain four rows: a salary credit, a rent debit, a bank charge
# (the leakage category) and a transfer debit. Nothing here depends on layout,
# reading or AI, so any disagreement between the two ports is arithmetic.
FIXTURE = [
    {"date": "2025-01-05", "description": "Salary", "amount": 500000, "type": "credit"},
    {"date": "2025-01-10", "description": "Rent payment", "amount": 120000, "type": "debit"},
    {"date": "2025-01-11", "description": "Bank fee", "amount": 2000, "type": "debit"},
    {"date": "2025-01-12", "description": "Transfer to John", "amount": 58000, "type": "debit"},
]


if __name__ == "__main__":
    unittest.main()
