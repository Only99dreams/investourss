"""Command line entry point: statement (PDF/CSV/XLSX) → Excel → audit.

    python tools/audit_statement.py statement.pdf
    python tools/audit_statement.py statement.pdf --months 6 --debug
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

from openpyxl import load_workbook

from . import audit_rules, spreadsheet, text_parser
from .audit_rules import (
    ExtractedTransaction,
    apply_financial_audit_rules,
    assess_parser_confidence,
    compare_printed_totals,
    months_covered_by_statement,
)
from .excel import write_workbook
from .pdf_table import DEFAULT_DPI, TableExtraction, pdf_to_table


# ---------------------------------------------------------------------------
# Source readers.
# ---------------------------------------------------------------------------

def read_xlsx_table(path: str) -> list[list[Any]]:
    """First sheet of a workbook as a table (dates to ISO, blanks dropped)."""
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = workbook.worksheets[0]
        rows: list[list[Any]] = []
        for raw_row in sheet.iter_rows(values_only=True):
            row: list[Any] = []
            for value in raw_row:
                if value is None:
                    row.append("")
                elif isinstance(value, (datetime, date)):
                    row.append(value.strftime("%Y-%m-%d"))
                elif isinstance(value, float) and value.is_integer():
                    row.append(int(value))
                else:
                    row.append(value)
            if all(str(cell).strip() == "" for cell in row):
                continue
            rows.append(row)
        return rows
    finally:
        workbook.close()


def read_csv_table(path: str) -> list[list[Any]]:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = Path(path).read_text(encoding=encoding)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover - latin-1 always decodes
        raise RuntimeError("Could not decode CSV file")
    return spreadsheet.parse_csv(text)


def _transactions_to_dicts(transactions: list[dict]) -> list[dict]:
    return [
        {
            "date": t.get("date"),
            "description": t.get("description", ""),
            "amount": t.get("amount"),
            "type": t.get("type"),
            "transactionId": t.get("transactionId"),
        }
        for t in transactions
    ]


# ---------------------------------------------------------------------------
# Audit run.
# ---------------------------------------------------------------------------

def audit_statement(
    source: str,
    out_dir: Optional[str] = None,
    months: Optional[float] = None,
    dpi: int = DEFAULT_DPI,
    ocr: str = "auto",
    password: Optional[str] = None,
    debug: bool = False,
    log=print,
) -> dict:
    """Run the whole pipeline and return the report dict."""
    path = Path(source).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Statement not found: {path}")
    suffix = path.suffix.lower()
    warnings: list[str] = []

    table: list[list[Any]] = []
    extraction = TableExtraction()
    text_for_totals = ""

    if suffix == ".pdf":
        extraction = pdf_to_table(
            str(path),
            dpi=dpi,
            ocr=ocr,
            password=password,
            debug_dir=str(Path(out_dir) / "debug") if (debug and out_dir) else (str(path.parent / "debug") if debug else None),
            log=log,
        )
        table = extraction.rows
        text_for_totals = extraction.lines_text
        warnings = list(extraction.warnings)
    elif suffix in (".csv", ".txt"):
        table = read_csv_table(str(path))
        extraction = TableExtraction(rows=[[str(c) for c in row] for row in table], pages=1, modes=["csv"])
        text_for_totals = "\n".join(" ".join(str(c) for c in row) for row in table)
    elif suffix in (".xlsx", ".xlsm"):
        table = read_xlsx_table(str(path))
        extraction = TableExtraction(rows=[[str(c) for c in row] for row in table], pages=1, modes=["xlsx"])
        text_for_totals = "\n".join(" ".join(str(c) for c in row) for row in table)
    else:
        raise ValueError(f"Unsupported statement format: {suffix or path.name}")

    # Spreadsheet path first: the table is the deterministic reading.
    sheet_result = spreadsheet.table_to_transactions(table)
    transactions = _transactions_to_dicts(sheet_result.transactions)
    parse_path = "spreadsheet"
    columns = sheet_result.columns
    reconciliation = asdict(sheet_result.reconciliation)

    usable = bool(transactions) and not any(
        "No header row" in warning for warning in sheet_result.warnings
    )
    if not usable:
        # Fall back to the statement's own text lines.
        fallback_text = text_for_totals
        text_transactions = text_parser.parse_financial_records(fallback_text) if fallback_text else []
        if text_transactions:
            parse_path = "text"
            transactions = text_transactions
            columns = {}
            reconciliation = {}
            warnings.extend(sheet_result.warnings)
            warnings.append(
                "Table reconstruction was not usable; the statement text was parsed line by line instead."
            )
        elif sheet_result.warnings:
            warnings.extend(sheet_result.warnings)

    if not transactions:
        raise RuntimeError(
            "No transactions could be read from this statement. "
            + (" ".join(warnings) if warnings else "")
        )

    parsed = [ExtractedTransaction(**t) for t in transactions]
    months_requested = float(months) if months else float(
        months_covered_by_statement([t["date"] for t in transactions])
    )
    audit = apply_financial_audit_rules(transactions, months_requested)
    printed_totals = compare_printed_totals(text_for_totals, parsed) if text_for_totals else {}
    confidence = assess_parser_confidence(text_for_totals, parsed) if text_for_totals else {"reliable": True, "reason": "not-applicable"}

    if confidence.get("reliable") is False:
        warnings.append(
            f"Parser confidence is low ({confidence.get('reason')}): check the extracted table against the statement."
        )
    if printed_totals and (printed_totals.get("creditMatches") is False or printed_totals.get("debitMatches") is False):
        warnings.append("The parsed totals do not match the totals printed on the statement.")

    report = {
        "source": str(path),
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "extraction": {
            "parsePath": parse_path,
            "method": extraction.method,
            "pages": extraction.pages,
            "rows": len(table),
            "columns": len(table[0]) if table else 0,
            "headerFound": extraction.header_found,
            "ocrPages": extraction.ocr_pages,
            "warnings": warnings,
        },
        "columns": columns,
        "reconciliation": reconciliation,
        "printedTotals": printed_totals,
        "parserConfidence": confidence,
        "audit": asdict(audit),
    }

    target_dir = Path(out_dir).resolve() if out_dir else path.with_suffix("").with_name(path.stem + "-audit")
    target_dir.mkdir(parents=True, exist_ok=True)
    excel_path = target_dir / f"{path.stem}.audit.xlsx"
    json_path = target_dir / f"{path.stem}.audit.json"

    write_workbook(
        str(excel_path),
        source=str(path),
        audit=audit,
        reconciliation=reconciliation,
        extraction=report["extraction"],
        printed_totals=printed_totals,
        raw_rows=[[str(cell) for cell in row] for row in table],
        months_requested=months_requested,
    )
    report["outputs"] = {"excel": str(excel_path), "report": str(json_path)}
    json_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    _print_summary(report, log)
    return report


def _money(value: Optional[float]) -> str:
    if value is None:
        return "-"
    return f"{value:,.2f}"


def _print_summary(report: dict, log) -> None:
    audit = report["audit"]
    extraction = report["extraction"]
    log("")
    log(f"Statement : {report['source']}")
    log(
        f"Read      : {extraction['parsePath']} path, method {extraction['method']}, "
        f"{extraction['pages']} page(s), {extraction['rows']} table row(s)"
    )
    recon = report.get("reconciliation") or {}
    if recon.get("opening") is not None:
        log(
            f"Balance   : {_money(recon.get('opening'))} + {_money(recon.get('credits'))} "
            f"- {_money(recon.get('debits'))} = {_money(recon.get('expectedClosing'))} vs closing "
            f"{_money(recon.get('closing'))} -> "
            f"{'reconciled' if recon.get('reconciled') else 'DOES NOT RECONCILE'}"
        )
    log(f"Period    : {audit['periodStart']} to {audit['periodEnd']} ({audit['auditMonths']} month(s))")
    log(
        f"Result    : income {_money(audit['totalIncome'])} | expenses {_money(audit['totalExpenses'])} | "
        f"cash flow {_money(audit['cashFlow'])} | savings {audit['savingsRate']:.2f}% | "
        f"score {audit['healthScore']} ({audit['healthStatus']})"
    )
    log(f"Rows      : {len(audit['transactions'])} counted, {audit['dataQuality']['excludedInvalidTransactions']} invalid, "
        f"{audit['dataQuality']['duplicateRowsIgnored']} duplicate, {audit['dataQuality']['undatedTransactions']} undated")
    for warning in extraction["warnings"]:
        log(f"Warning   : {warning}")
    log(f"Excel     : {report['outputs']['excel']}")
    log(f"Report    : {report['outputs']['report']}")
    log("")


# ---------------------------------------------------------------------------
# Argument parsing.
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="audit_statement",
        description="Read a bank statement PDF (OpenCV) into Excel and audit it deterministically.",
    )
    parser.add_argument("source", help="Statement file: .pdf, .csv or .xlsx")
    parser.add_argument("-o", "--out", help="Output directory (default: <statement>-audit)")
    parser.add_argument("--months", type=float, help="Months to audit (default: the whole statement)")
    parser.add_argument("--dpi", type=int, default=DEFAULT_DPI, help=f"Render DPI (default {DEFAULT_DPI})")
    parser.add_argument(
        "--ocr", choices=("auto", "force", "off"), default="auto",
        help="OCR scanned pages with Tesseract (default: auto when there is no text layer)",
    )
    parser.add_argument("--password", help="Password for an encrypted PDF")
    parser.add_argument("--debug", action="store_true", help="Write page images showing what OpenCV detected")
    parser.add_argument("--quiet", action="store_true", help="Only print the summary lines")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    log = (lambda *a, **k: None) if args.quiet else print
    try:
        audit_statement(
            args.source,
            out_dir=args.out,
            months=args.months,
            dpi=args.dpi,
            ocr=args.ocr,
            password=args.password,
            debug=args.debug,
            log=log,
        )
        return 0
    except Exception as error:  # noqa: BLE001 - CLI boundary
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
