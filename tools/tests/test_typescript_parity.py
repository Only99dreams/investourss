"""Parity test: the Python port must equal the TypeScript app, case by case.

    tools\\pyenv\\python.exe -m unittest discover -s tools\\tests -v

`ts_battery.mjs` runs one battery of inputs through the real
supabase/functions sources (with Node's TypeScript stripping) and dumps the
inputs plus the TypeScript outputs as JSON. This module recomputes the same
inputs with tools/statement_audit and fails on any difference in numbers,
strings, key presence or ordering.

It skips itself when Node.js or the TypeScript sources are not available, so it
never blocks the rest of the suite.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOLS_DIR.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from statement_audit import audit_rules, spreadsheet, text_parser  # noqa: E402

REFERENCE = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def normalize(value):
    """Make Python results JSON-comparable: dataclass to dict, NaN/Inf to None."""
    if is_dataclass(value):
        return {key: normalize(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize(item) for item in value]
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    return value


class TypeScriptParityTest(unittest.TestCase):
    payload: dict
    differences: list[str]

    @classmethod
    def setUpClass(cls) -> None:
        node = shutil.which("node")
        battery = Path(__file__).resolve().parent / "ts_battery.mjs"
        sources = [
            REPO_ROOT / "supabase/functions/financial-audit/auditRules.ts",
            REPO_ROOT / "supabase/functions/financial-audit/spreadsheet.ts",
        ]
        if not node or not battery.is_file() or not all(source.is_file() for source in sources):
            raise unittest.SkipTest("Node.js or the TypeScript sources are not available")

        cls.tempdir = tempfile.TemporaryDirectory()
        out_path = Path(cls.tempdir.name) / "battery.json"
        completed = subprocess.run(
            [node, "--experimental-strip-types", str(battery), str(REPO_ROOT), str(out_path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
        )
        if completed.returncode != 0 or not out_path.is_file():
            raise unittest.SkipTest(f"Node could not run the battery: {completed.stderr.strip()[:400]}")

        cls.payload = json.loads(out_path.read_text(encoding="utf-8"))
        cls.differences = []
        cls._run_checks()

    @classmethod
    def tearDownClass(cls) -> None:
        if getattr(cls, "tempdir", None):
            cls.tempdir.cleanup()

    # -- diffing -----------------------------------------------------------

    @classmethod
    def _diff(cls, expected, actual, path: str) -> None:
        if isinstance(expected, dict):
            if not isinstance(actual, dict):
                cls.differences.append(f"{path}: expected object, got {actual!r}")
                return
            missing = object()
            for key in sorted(set(expected) | set(actual)):
                left = expected.get(key, missing)
                right = actual.get(key, missing)
                # JSON.stringify drops `undefined`, so a key missing on one side
                # is the same as an explicit None on the other.
                if (left is missing and right is None) or (right is missing and left is None):
                    continue
                if left is missing:
                    cls.differences.append(f"{path}.{key}: extra in python = {right!r}")
                elif right is missing:
                    cls.differences.append(f"{path}.{key}: missing in python (ts={left!r})")
                else:
                    cls._diff(left, right, f"{path}.{key}")
        elif isinstance(expected, list):
            if not isinstance(actual, list):
                cls.differences.append(f"{path}: expected list, got {actual!r}")
                return
            if len(expected) != len(actual):
                cls.differences.append(f"{path}: length ts={len(expected)} py={len(actual)}")
                return
            for index, (left, right) in enumerate(zip(expected, actual)):
                cls._diff(left, right, f"{path}[{index}]")
        elif isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
            if expected != actual and abs(expected - actual) > 1e-6:
                cls.differences.append(f"{path}: ts={expected!r} py={actual!r}")
        elif expected != actual:
            cls.differences.append(f"{path}: ts={expected!r} py={actual!r}")

    @classmethod
    def _check(cls, name: str, expected, actual) -> None:
        cls._diff(expected, normalize(actual), name)

    @classmethod
    def _run_checks(cls) -> None:
        inputs = cls.payload["inputs"]
        ts = cls.payload["ts"]

        cls._check(
            "normalizeAmount",
            ts["normalizeAmount"],
            [audit_rules.normalize_amount(v) for v in inputs["normalizeAmount"]],
        )
        cls._check("roundMoney", ts["roundMoney"], [audit_rules.round_money(v) for v in inputs["roundMoney"]])
        cls._check(
            "coerceIsoDate",
            ts["coerceIsoDate"],
            [audit_rules.coerce_iso_date(v) for v in inputs["coerceIsoDate"]],
        )
        cls._check(
            "monthsCovered",
            ts["monthsCovered"],
            [audit_rules.months_covered_by_statement(d, REFERENCE) for d in inputs["monthsCovered"]],
        )
        cls._check(
            "auditWindow",
            ts["auditWindow"],
            [audit_rules.get_audit_window(c["dates"], c["months"], REFERENCE) for c in inputs["auditWindow"]],
        )

        for name, table in inputs["tables"].items():
            cls._check(f"table.{name}", ts["tables"][name], spreadsheet.table_to_transactions(table))
        for name, text in inputs["csvTexts"].items():
            cls._check(f"csv.{name}", ts["csvTexts"][name], spreadsheet.parse_csv(text))
        for name, text in inputs["textStatements"].items():
            cls._check(f"text.{name}", ts["textStatements"][name], text_parser.parse_financial_records(text))
        for name, transactions in inputs["auditSets"].items():
            cls._check(
                f"audit.{name}",
                ts["auditSets"][name],
                audit_rules.apply_financial_audit_rules(transactions, 1),
            )
        for index, case in enumerate(inputs["printedTotals"]):
            cls._check(
                f"printedTotals[{index}]",
                ts["printedTotals"][index],
                audit_rules.compare_printed_totals(case["text"], case["transactions"]),
            )
        for index, case in enumerate(inputs["confidence"]):
            cls._check(
                f"confidence[{index}]",
                ts["confidence"][index],
                audit_rules.assess_parser_confidence(case["text"], case["transactions"]),
            )

    # -- tests -------------------------------------------------------------

    def test_matches_typescript(self) -> None:
        self.assertTrue(
            self.payload["ts"],
            "the TypeScript battery produced no output",
        )
        if self.differences:
            self.fail(
                f"{len(self.differences)} difference(s) between the Python port and the TypeScript app:\n  "
                + "\n  ".join(self.differences[:60])
            )


if __name__ == "__main__":
    unittest.main()
