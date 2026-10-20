"""End-to-end and unit tests for the statement audit pipeline.

    tools\\pyenv\\python.exe -m unittest discover -s tools\\tests -v

The PDF fixtures are generated here with fpdf2, so the suite needs no real bank
statement: a ruled statement (OpenCV grid path), a borderless statement
(header-anchor path) and a CSV of the same data, all of which must produce the
same hand-computable totals.
"""

from __future__ import annotations

import csv
import math
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from fpdf import FPDF  # noqa: E402
from openpyxl import load_workbook  # noqa: E402

from statement_audit import audit_rules, spreadsheet, text_parser  # noqa: E402
from statement_audit.cli import audit_statement  # noqa: E402
from statement_audit.pdf_table import (  # noqa: E402
    detect_grid,
    pdf_to_table,
    render_page,
)

OPENING = 100_000.00
TRANSACTIONS = [
    ("02/01/2025", "Salary", "credit", 500_000.00),
    ("03/01/2025", "Rent", "debit", 120_000.00),
    ("05/01/2025", "POS SHOPRITE", "debit", 25_000.00),
    ("10/01/2025", "Bank charge", "debit", 1_000.00),
    ("15/01/2025", "POS FUEL", "debit", 30_000.00),
    ("20/01/2025", "Transfer JOHN", "credit", 50_000.00),
    ("22/01/2025", "ATM", "debit", 20_000.00),
    ("25/01/2025", "Salary", "credit", 500_000.00),
    ("28/01/2025", "POS MARKET", "debit", 40_000.00),
]
EXPECTED_CREDITS = 1_050_000.00
EXPECTED_DEBITS = 236_000.00
EXPECTED_CLOSING = 914_000.00
EXPECTED_CASH_FLOW = 814_000.00


def _statement_rows(signed_amount: bool) -> list[dict]:
    rows = [
        {
            "date": "",
            "desc": "Opening Balance",
            "debit": "",
            "credit": "",
            "amount": "",
            "balance": f"{OPENING:,.2f}",
        }
    ]
    balance = OPENING
    for date_s, description, kind, amount in TRANSACTIONS:
        balance = balance + amount if kind == "credit" else balance - amount
        rows.append(
            {
                "date": date_s,
                "desc": description,
                "debit": f"{amount:,.2f}" if kind == "debit" else "",
                "credit": f"{amount:,.2f}" if kind == "credit" else "",
                "amount": (
                    f"{-amount:,.2f}" if kind == "debit" else f"{amount:,.2f}"
                )
                if signed_amount
                else "",
                "balance": f"{balance:,.2f}",
            }
        )
    return rows


def build_statement_pdf(path: str, ruled: bool = True) -> str:
    """Write a one-page statement; ruled=grid, borderless=signed amount column."""
    pdf = FPDF(unit="mm", format="A4")
    pdf.set_auto_page_break(False)
    pdf.add_page()
    pdf.set_font("helvetica", size=9)
    pdf.set_xy(12, 18)
    pdf.cell(150, 6, "ACME BANK PLC - STATEMENT OF ACCOUNT")
    pdf.set_xy(12, 25)
    pdf.cell(150, 6, "Account 0123456789   Period January 2025")

    top, row_h = 40.0, 6.0
    if ruled:
        columns = [
            (12, 20, "Date", "L"),
            (33, 70, "Description", "L"),
            (105, 30, "Debit", "R"),
            (135, 30, "Credit", "R"),
            (165, 35, "Balance", "R"),
        ]
    else:
        columns = [
            (12, 20, "Date", "L"),
            (33, 70, "Description", "L"),
            (105, 30, "Amount", "R"),
            (165, 35, "Balance", "R"),
        ]

    def put(x: float, y: float, width: float, text: str, align: str = "L") -> None:
        pdf.set_xy(x, y)
        pdf.cell(width, row_h, text, align=align)

    for x, width, label, align in columns:
        put(x, top, width, label, align)

    rows = _statement_rows(signed_amount=not ruled)
    for index, row in enumerate(rows):
        y = top + row_h * (index + 1)
        put(12, y, 20, row["date"])
        put(33, y, 70, row["desc"])
        if ruled:
            put(105, y, 30, row["debit"], "R")
            put(135, y, 30, row["credit"], "R")
        else:
            put(105, y, 30, row["amount"], "R")
        put(165, y, 35, row["balance"], "R")

    bottom = top + row_h * (len(rows) + 1)
    if ruled:
        for index in range(len(rows) + 1):
            y = top + row_h * index
            pdf.line(10, y, 200, y)
        for x in (10, 33, 105, 135, 165, 200):
            pdf.line(x, top, x, bottom)

    totals_y = bottom + 3
    put(33, totals_y, 120, f"Total Credit: {EXPECTED_CREDITS:,.2f}")
    put(33, totals_y + 6, 120, f"Total Debit: {EXPECTED_DEBITS:,.2f}")
    put(33, totals_y + 12, 150, f"Closing Balance: {EXPECTED_CLOSING:,.2f}")

    pdf.output(path)
    return path


def build_statement_csv(path: str) -> str:
    rows = _statement_rows(signed_amount=False)
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Date", "Description", "Debit", "Credit", "Balance"])
        for row in rows:
            writer.writerow(
                [row["date"], row["desc"], row["debit"], row["credit"], row["balance"]]
            )
        writer.writerow([])
        writer.writerow(["", f"Total Credit: {EXPECTED_CREDITS:,.2f}", "", "", ""])
        writer.writerow(["", f"Total Debit: {EXPECTED_DEBITS:,.2f}", "", "", ""])
        writer.writerow(["", f"Closing Balance: {EXPECTED_CLOSING:,.2f}", "", "", ""])
    return path


class PipelineTestCase(unittest.TestCase):
    """Shared assertions for every input format."""

    report: dict
    audit: dict

    def assert_expected_totals(self) -> None:
        audit = self.report["audit"]
        self.assertEqual(len(audit["transactions"]), len(TRANSACTIONS))
        self.assertAlmostEqual(audit["totalIncome"], EXPECTED_CREDITS, places=2)
        self.assertAlmostEqual(audit["totalExpenses"], EXPECTED_DEBITS, places=2)
        self.assertAlmostEqual(audit["cashFlow"], EXPECTED_CASH_FLOW, places=2)
        self.assertAlmostEqual(audit["savingsRate"], 77.52, places=2)
        # cash flow positive (+15) and savings >= 20% (+10) on a base of 55,
        # less 2 points for the one bank charge: 78 -> "good".
        self.assertEqual(audit["healthScore"], 78)
        self.assertEqual(audit["healthStatus"], "good")
        self.assertEqual(audit["periodStart"], "2025-01-01")
        self.assertEqual(audit["periodEnd"], "2025-01-31")
        self.assertEqual(audit["auditMonths"], 1)
        self.assertEqual(audit["statementMonthsCovered"], 1)

    def assert_expected_reconciliation(self) -> None:
        reconciliation = self.report["reconciliation"]
        self.assertAlmostEqual(reconciliation["opening"], OPENING, places=2)
        self.assertAlmostEqual(reconciliation["closing"], EXPECTED_CLOSING, places=2)
        self.assertAlmostEqual(reconciliation["credits"], EXPECTED_CREDITS, places=2)
        self.assertAlmostEqual(reconciliation["debits"], EXPECTED_DEBITS, places=2)
        self.assertTrue(reconciliation["reconciled"], reconciliation)

    def assert_excel_written(self) -> None:
        excel_path = Path(self.report["outputs"]["excel"])
        self.assertTrue(excel_path.is_file())
        workbook = load_workbook(excel_path)
        try:
            self.assertEqual(
                workbook.sheetnames, ["Summary", "Debit-Credit", "As extracted"]
            )
            sheet = workbook["Debit-Credit"]
            total_row = next(
                row for row in sheet.iter_rows(min_row=1) if row[0].value == "TOTAL"
            )
            self.assertAlmostEqual(total_row[3].value, EXPECTED_DEBITS, places=2)
            self.assertAlmostEqual(total_row[4].value, EXPECTED_CREDITS, places=2)
            summary = workbook["Summary"]
            values = {
                row[0].value: row[1].value
                for row in summary.iter_rows(min_row=1)
                if row[0].value
            }
            self.assertAlmostEqual(values["Total income"], EXPECTED_CREDITS, places=2)
            self.assertAlmostEqual(values["Total expenses"], EXPECTED_DEBITS, places=2)
        finally:
            workbook.close()


class RuledPdfTest(PipelineTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tempdir = tempfile.TemporaryDirectory()
        cls.pdf_path = build_statement_pdf(str(Path(cls.tempdir.name) / "ruled.pdf"), ruled=True)
        cls.report = audit_statement(cls.pdf_path, out_dir=cls.tempdir.name, log=lambda *a: None)
        cls.audit = cls.report["audit"]

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tempdir.cleanup()

    def test_read_by_opencv_grid(self) -> None:
        self.assertEqual(self.report["extraction"]["method"], "grid")
        self.assertEqual(self.report["extraction"]["parsePath"], "spreadsheet")
        self.assertTrue(self.report["extraction"]["headerFound"])
        self.assertGreaterEqual(self.report["extraction"]["rows"], 12)

    def test_opencv_finds_the_ruling(self) -> None:
        import pypdfium2 as pdfium

        document = pdfium.PdfDocument(self.pdf_path)
        try:
            page = document[0]
            _, gray, scale = render_page(page, 200)
            grid = detect_grid(gray, scale)
            self.assertIsNotNone(grid)
            self.assertGreaterEqual(len(grid["row_edges"]), 6)
            self.assertGreaterEqual(len(grid["col_edges"]), 5)
        finally:
            document.close()

    def test_totals(self) -> None:
        self.assert_expected_totals()

    def test_reconciliation(self) -> None:
        self.assert_expected_reconciliation()

    def test_excel(self) -> None:
        self.assert_excel_written()

    def test_printed_totals_match(self) -> None:
        printed = self.report["printedTotals"]
        self.assertAlmostEqual(printed["printedCredit"], EXPECTED_CREDITS, places=2)
        self.assertAlmostEqual(printed["printedDebit"], EXPECTED_DEBITS, places=2)
        self.assertTrue(printed["creditMatches"])
        self.assertTrue(printed["debitMatches"])


class GridEdgeCaseTest(unittest.TestCase):
    """Two layouts the grid reader must not get wrong.

    1. A short table (a few rows on a tall page) is still a table. An earlier
       rule required the frame to cover a fraction of the page, which threw
       away perfectly good pages — the first page of a two-page statement, or
       any statement with a short table.
    2. A description that wraps inside one ruled cell must stay with its own
       date, amount and balance, and read in the right order.
    """

    COLUMNS = [
        (12, 20, "Date", "L"),
        (33, 70, "Description", "L"),
        (105, 30, "Debit", "R"),
        (135, 30, "Credit", "R"),
        (165, 35, "Balance", "R"),
    ]

    def build_pdf(self, path: str, rows: list[tuple], wrapped: bool) -> str:
        pdf = FPDF(unit="mm", format="A4")
        pdf.set_auto_page_break(False)
        pdf.add_page()
        pdf.set_font("helvetica", size=9)
        top, header_h = 40.0, 6.0
        row_h = 8.0 if wrapped else 6.0
        for x, width, label, align in self.COLUMNS:
            pdf.set_xy(x, top)
            pdf.cell(width, header_h, label, align=align)
        y = top + header_h
        for date_s, description, debit, credit, balance in rows:
            if wrapped:
                pdf.set_xy(33, y)
                pdf.multi_cell(70, row_h / 2, description)  # two lines
            for (x, width, _label, align), value in zip(
                self.COLUMNS, (date_s, description, debit, credit, balance)
            ):
                if wrapped and x == 33:
                    continue
                pdf.set_xy(x, y)
                pdf.cell(width, row_h, value, align=align)
            y += row_h
        for y_line in [top] + [top + header_h + row_h * i for i in range(len(rows) + 1)]:
            pdf.line(10, y_line, 200, y_line)
        for x in (10, 33, 105, 135, 165, 200):
            pdf.line(x, top, x, y)
        pdf.output(path)
        return path

    def test_short_table_is_still_a_grid(self) -> None:
        rows = [
            ("02/01/2025", "Salary", "", "500,000.00", "150,000.00"),
            ("03/01/2025", "Rent", "120,000.00", "", "30,000.00"),
        ]
        with tempfile.TemporaryDirectory() as folder:
            path = self.build_pdf(str(Path(folder) / "short.pdf"), rows, wrapped=False)
            table = pdf_to_table(path)
        self.assertEqual(table.method, "grid", table.warnings)
        self.assertTrue(table.header_found)
        result = spreadsheet.table_to_transactions(table.rows)
        self.assertEqual(len(result.transactions), 2)
        self.assertEqual(
            [transaction["amount"] for transaction in result.transactions],
            [500_000.00, 120_000.00],
        )
        self.assertEqual(
            [transaction["type"] for transaction in result.transactions],
            ["credit", "debit"],
        )

    def test_wrapped_description_stays_with_its_row(self) -> None:
        description = "Transfer to savings account for the month of January"
        rows = [
            ("02/01/2025", description, "120,000.00", "", "480,000.00"),
            ("05/01/2025", "POS SHOPRITE", "", "25,000.00", "455,000.00"),
        ]
        with tempfile.TemporaryDirectory() as folder:
            path = self.build_pdf(str(Path(folder) / "wrapped.pdf"), rows, wrapped=True)
            table = pdf_to_table(path)
        self.assertEqual(table.method, "grid", table.warnings)
        body = table.rows[1:]  # rows[0] is the header
        self.assertEqual(len(body), 2, table.rows)
        self.assertEqual(body[0][0], "02/01/2025")
        self.assertEqual(body[0][1], description)  # both wrapped lines, in order
        self.assertEqual(body[0][2], "120,000.00")
        self.assertEqual(body[0][4], "480,000.00")
        result = spreadsheet.table_to_transactions(table.rows)
        self.assertEqual(len(result.transactions), 2)
        self.assertEqual(result.transactions[0]["amount"], 120_000.00)


class BorderlessPdfTest(PipelineTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tempdir = tempfile.TemporaryDirectory()
        cls.pdf_path = build_statement_pdf(str(Path(cls.tempdir.name) / "plain.pdf"), ruled=False)
        cls.report = audit_statement(cls.pdf_path, out_dir=cls.tempdir.name, log=lambda *a: None)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tempdir.cleanup()

    def test_read_by_header_anchors(self) -> None:
        self.assertEqual(self.report["extraction"]["method"], "columns")
        self.assertEqual(self.report["extraction"]["parsePath"], "spreadsheet")

    def test_totals(self) -> None:
        self.assert_expected_totals()

    def test_reconciliation(self) -> None:
        self.assert_expected_reconciliation()

    def test_excel(self) -> None:
        self.assert_excel_written()


class CsvTest(PipelineTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tempdir = tempfile.TemporaryDirectory()
        cls.csv_path = build_statement_csv(str(Path(cls.tempdir.name) / "statement.csv"))
        cls.report = audit_statement(cls.csv_path, out_dir=cls.tempdir.name, log=lambda *a: None)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tempdir.cleanup()

    def test_totals(self) -> None:
        self.assert_expected_totals()

    def test_reconciliation(self) -> None:
        self.assert_expected_reconciliation()

    def test_excel(self) -> None:
        self.assert_excel_written()


class WindowTest(unittest.TestCase):
    def test_window_anchors_on_first_month(self) -> None:
        transactions = [
            {"date": "2025-03-15", "description": "Salary", "amount": 1000, "type": "credit"},
            {"date": "2025-05-02", "description": "Rent", "amount": 400, "type": "debit"},
        ]
        result = audit_rules.apply_financial_audit_rules(transactions, 2)
        self.assertEqual(result.periodStart, "2025-03-01")
        self.assertEqual(result.periodEnd, "2025-04-30")
        self.assertEqual(result.statementMonthsCovered, 3)
        # The May rent falls outside the 2-month window.
        self.assertAlmostEqual(result.totalExpenses, 0.0)

    def test_undated_row_excluded_when_statement_outlasts_window(self) -> None:
        transactions = [
            {"date": "2025-01-05", "description": "Salary", "amount": 1000, "type": "credit"},
            {"date": "2025-11-05", "description": "Salary", "amount": 1000, "type": "credit"},
            {"description": "Undated fee", "amount": 50, "type": "debit"},
        ]
        result = audit_rules.apply_financial_audit_rules(transactions, 1)
        self.assertEqual(result.auditMonths, 1)
        self.assertAlmostEqual(result.totalExpenses, 0.0)
        self.assertEqual(result.dataQuality.excludedUndatedTransactions, 1)

    def test_undated_row_kept_when_window_covers_statement(self) -> None:
        transactions = [
            {"date": "2025-01-05", "description": "Salary", "amount": 1000, "type": "credit"},
            {"description": "Undated fee", "amount": 50, "type": "debit"},
        ]
        result = audit_rules.apply_financial_audit_rules(transactions, 12)
        self.assertAlmostEqual(result.totalExpenses, 50.0)
        self.assertEqual(result.dataQuality.excludedUndatedTransactions, 0)


class RulesUnitTest(unittest.TestCase):
    def test_round_money_matches_javascript(self) -> None:
        self.assertEqual(audit_rules.round_money(0.005), 0.01)
        self.assertEqual(audit_rules.round_money(1.005), 1.01)
        self.assertEqual(audit_rules.round_money(1234.565), 1234.57)
        self.assertEqual(audit_rules.round_money(2.675), 2.68)

    def test_normalize_amount(self) -> None:
        self.assertEqual(audit_rules.normalize_amount("NGN 1,250.50"), 1250.50)
        self.assertEqual(audit_rules.normalize_amount("₦2,000"), 2000.0)
        self.assertTrue(math.isnan(audit_rules.normalize_amount("")))
        self.assertTrue(math.isnan(audit_rules.normalize_amount("abc")))

    def test_coerce_iso_date(self) -> None:
        self.assertEqual(audit_rules.coerce_iso_date("2025-01-02"), "2025-01-02")
        self.assertEqual(audit_rules.coerce_iso_date("02/01/2025"), "2025-01-02")
        self.assertEqual(audit_rules.coerce_iso_date("2-Jan-25"), "2025-01-02")
        self.assertEqual(audit_rules.coerce_iso_date("Jan 2, 2025"), "2025-01-02")
        self.assertIsNone(audit_rules.coerce_iso_date("Total"))

    def test_category_and_leakage(self) -> None:
        self.assertEqual(audit_rules.category_from_description("Bank charge"), "bank charges")
        self.assertEqual(audit_rules.category_from_description("POS SHOPRITE"), "withdrawals")
        self.assertEqual(audit_rules.category_from_description("Transfer JOHN"), "transfers")
        self.assertEqual(audit_rules.category_from_description("Salary"), "salary")
        self.assertEqual(audit_rules.category_from_description("Something else"), "other")


class SpreadsheetUnitTest(unittest.TestCase):
    def test_debit_credit_columns(self) -> None:
        table = [
            ["Date", "Description", "Debit", "Credit", "Balance"],
            ["", "Opening Balance", "", "", "0.00"],
            ["01/02/2025", "Salary", "", "1,000.00", "1,000.00"],
            ["02/02/2025", "Rent", "400.00", "", "600.00"],
        ]
        result = spreadsheet.table_to_transactions(table)
        self.assertEqual([t["type"] for t in result.transactions], ["credit", "debit"])
        self.assertEqual([t["amount"] for t in result.transactions], [1000.0, 400.0])
        self.assertEqual(result.transactions[0]["date"], "2025-02-01")
        self.assertTrue(result.reconciliation.reconciled)
        self.assertAlmostEqual(result.reconciliation.expectedClosing, 600.0)

    def test_amount_plus_type_column(self) -> None:
        table = [
            ["Date", "Narration", "Amount", "Type"],
            ["01/02/2025", "Salary", "1,000.00", "CR"],
            ["02/02/2025", "Rent", "400.00", "DR"],
        ]
        result = spreadsheet.table_to_transactions(table)
        self.assertEqual([t["type"] for t in result.transactions], ["credit", "debit"])

    def test_signed_amount_column(self) -> None:
        table = [
            ["Date", "Description", "Amount"],
            ["01/02/2025", "Salary", "1,000.00"],
            ["02/02/2025", "Rent", "-400.00"],
        ]
        result = spreadsheet.table_to_transactions(table)
        self.assertEqual([t["type"] for t in result.transactions], ["credit", "debit"])

    def test_balance_delta_direction(self) -> None:
        table = [
            ["Date", "Description", "Balance"],
            ["01/02/2025", "Opening", "1,000.00"],
            ["02/02/2025", "Something", "1,500.00"],
            ["03/02/2025", "Elsewhere", "1,100.00"],
        ]
        result = spreadsheet.table_to_transactions(table)
        self.assertEqual([t["type"] for t in result.transactions], ["credit", "debit"])
        self.assertEqual([t["amount"] for t in result.transactions], [500.0, 400.0])

    def test_summary_rows_are_not_transactions(self) -> None:
        table = [
            ["Date", "Description", "Debit", "Credit", "Balance"],
            ["", "Opening Balance", "", "", "1,000.00"],
            ["01/02/2025", "Rent", "400.00", "", "600.00"],
            ["", "Total Debit", "400.00", "", ""],
            ["", "Total Credit", "", "1,000.00", ""],
            ["", "Closing Balance", "", "", "600.00"],
        ]
        result = spreadsheet.table_to_transactions(table)
        self.assertEqual(len(result.transactions), 1)
        self.assertAlmostEqual(result.reconciliation.closing, 600.0)
        self.assertAlmostEqual(result.reconciliation.debits, 400.0)
        # The "Total Credit" row is a summary, not a transaction: the parsed
        # credits must be 0 even though the statement prints a credit total.
        self.assertAlmostEqual(result.reconciliation.credits, 0.0)
        self.assertTrue(result.reconciliation.reconciled)

    def test_parse_csv_quotes_and_semicolons(self) -> None:
        text = 'Date;Description;Amount\r\n"01/02/2025";"Transfer, JOHN";"1,000.00"\r\n'
        rows = spreadsheet.parse_csv(text)
        self.assertEqual(rows[0], ["Date", "Description", "Amount"])
        self.assertEqual(rows[1], ["01/02/2025", "Transfer, JOHN", "1,000.00"])


class TextParserUnitTest(unittest.TestCase):
    def test_jammed_pdf_line(self) -> None:
        transactions = text_parser.parse_financial_records("12/07/26POS PURCHASE5,000.00612,000.00")
        self.assertEqual(len(transactions), 1)
        self.assertEqual(transactions[0]["type"], "debit")
        self.assertEqual(transactions[0]["amount"], 5000.0)
        self.assertEqual(transactions[0]["date"], "2026-07-12")

    def test_balance_marker_direction(self) -> None:
        text = (
            "Description Debit Credit Balance\n"
            "01/02/2025 SALARY 1,000.00 1,000.00\n"
            "02/02/2025 RENT 400.00 600.00\n"
        )
        transactions = text_parser.parse_financial_records(text)
        self.assertEqual(len(transactions), 2)
        self.assertEqual(transactions[0]["type"], "credit")
        self.assertEqual(transactions[1]["type"], "debit")


if __name__ == "__main__":
    unittest.main()
