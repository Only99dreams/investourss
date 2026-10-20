"""Version stamp for the Python port of the audit rules.

The port is a line-for-line translation of `auditRules.ts`, so the price of the
two drifting apart is that the app and the desktop tool report different
figures for the same statement. `tests/test_rules_parity.py` pins both sides to
the strings in `tools/expected-rules.txt`, and fails the moment either moves.
"""

from __future__ import annotations

RULES_VERSION = "1.0.0"
