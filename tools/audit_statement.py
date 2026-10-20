"""Entry point: run the audit pipeline with the portable interpreter.

    tools\\pyenv\\python.exe tools\\audit_statement.py statement.pdf
    tools\\audit-statement.cmd statement.pdf --months 6 --debug
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from statement_audit.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
