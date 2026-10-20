"""Statement audit pipeline: PDF (OpenCV) → Excel → deterministic audit.

Modules
-------
pdf_table    : rasterise + "see" the statement with OpenCV, emit a cell table
spreadsheet  : table → transactions (port of financial-audit/spreadsheet.ts)
text_parser  : line-based fallback (port of parseFinancialRecords)
audit_rules  : the audit arithmetic (port of financial-audit/auditRules.ts)
excel        : write the .xlsx workbook
cli          : the command line pipeline
"""

from .audit_rules import (
    FINANCIAL_AUDIT_RULES_VERSION,
    apply_financial_audit_rules,
    months_covered_by_statement,
    round_money,
)
from .spreadsheet import table_to_transactions
from .pdf_table import DEFAULT_DPI, TableExtraction, pdf_to_table

__all__ = [
    "FINANCIAL_AUDIT_RULES_VERSION",
    "apply_financial_audit_rules",
    "months_covered_by_statement",
    "round_money",
    "table_to_transactions",
    "pdf_to_table",
    "TableExtraction",
    "DEFAULT_DPI",
]
