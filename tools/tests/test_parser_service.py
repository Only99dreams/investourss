"""End-to-end tests for the OpenCV parser service the app uploads through.

    tools\\pyenv\\python.exe -m unittest discover -s tools\\tests -v

The service is started on an ephemeral port in a background thread and driven
over real HTTP, so this covers the whole path the `parse-statement` Edge
Function takes: bytes in, the app's JSON contract out.
"""

from __future__ import annotations

import io
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import parser_service  # noqa: E402
from statement_audit import spreadsheet  # noqa: E402
from test_statement_audit import (  # noqa: E402
    EXPECTED_CREDITS,
    EXPECTED_DEBITS,
    build_statement_pdf,
)


def start_service(**kwargs):
    """Bind the service on port 0 and run it until the test class stops it."""
    server = parser_service.serve("127.0.0.1", 0, **kwargs)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


def post(port: int, data: bytes, headers: dict | None = None, path: str = "/parse"):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=data, method="POST", headers=headers or {}
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


def get(port: int, path: str = "/health"):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


class ParserServiceTest(unittest.TestCase):
    """The happy path: a real statement read through OpenCV over HTTP."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._stderr = sys.stderr
        sys.stderr = io.StringIO()  # the service logs a line per parse
        cls.tempdir = tempfile.TemporaryDirectory()
        cls.pdf = build_statement_pdf(str(Path(cls.tempdir.name) / "statement.pdf"), ruled=True)
        cls.data = Path(cls.pdf).read_bytes()
        cls.server, cls.port = start_service(dpi=150)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        sys.stderr = cls._stderr
        cls.tempdir.cleanup()

    def test_reads_a_statement_with_opencv(self) -> None:
        status, payload = post(self.port, self.data, {"Content-Type": "application/pdf"})
        self.assertEqual(status, 200)
        self.assertTrue(payload["success"], payload)
        self.assertEqual(payload["reader"], "opencv")
        self.assertEqual(payload["method"], "grid")
        self.assertEqual(payload["pages"], 1)
        self.assertTrue(payload["headerFound"])
        self.assertIn("Salary", payload["text"])
        self.assertGreaterEqual(len(payload["table"]), 12)
        self.assertNotIn("error", payload)

    def test_table_is_the_same_one_the_app_audits(self) -> None:
        _, payload = post(self.port, self.data)
        parsed = spreadsheet.table_to_transactions(payload["table"])
        self.assertEqual(len(parsed.transactions), 9)
        # The service answers in the contract the auditor already consumes, so
        # downloading it would produce the same figures as the CLI/edge path.
        credits = sum(t["amount"] for t in parsed.transactions if t["type"] == "credit")
        debits = sum(t["amount"] for t in parsed.transactions if t["type"] == "debit")
        self.assertAlmostEqual(credits, EXPECTED_CREDITS, places=2)
        self.assertAlmostEqual(debits, EXPECTED_DEBITS, places=2)

    def test_payload_matches_the_contract_the_edge_function_reads(self) -> None:
        _, payload = post(self.port, self.data)
        # These are exactly the fields supabase/functions/parse-statement/index.ts
        # maps out of a reader reply; renaming one would silently break the app.
        for key in ("success", "text", "pages", "table", "reader", "method", "warnings"):
            self.assertIn(key, payload)
        self.assertIsInstance(payload["text"], str)
        self.assertIsInstance(payload["pages"], int)
        self.assertIsInstance(payload["warnings"], list)
        self.assertEqual(payload["reader"], "opencv")
        self.assertTrue(all(isinstance(row, list) for row in payload["table"]))
        self.assertTrue(
            all(isinstance(cell, str) for row in payload["table"] for cell in row),
            "the app expects a string[][] table",
        )

    def test_health_reports_the_reader(self) -> None:
        status, payload = get(self.port)
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertIn("ocr", payload)

    def test_unknown_path_is_not_found(self) -> None:
        status, payload = get(self.port, "/nope")
        self.assertEqual(status, 404)
        self.assertIn("error", payload)

    def test_empty_body_is_rejected(self) -> None:
        status, payload = post(self.port, b"")
        self.assertEqual(status, 400)
        self.assertFalse(payload["success"])

    def test_a_file_that_is_not_a_pdf_reports_an_error(self) -> None:
        status, payload = post(self.port, b"this is definitely not a pdf")
        self.assertEqual(status, 200)
        self.assertFalse(payload["success"])
        self.assertIn("error", payload)


class ParserServicePasswordTest(unittest.TestCase):
    """A locked statement must drive the app's password prompt, not a 500."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._stderr = sys.stderr
        sys.stderr = io.StringIO()
        cls.tempdir = tempfile.TemporaryDirectory()
        # fpdf2 writes an encrypted PDF the reader must unlock.
        from fpdf import FPDF

        pdf = FPDF(unit="mm", format="A4")
        pdf.add_page()
        pdf.set_font("helvetica", size=9)
        for y, left, right in ((40, "Date", "Description"), (46, "02/01/2025", "Salary")):
            pdf.set_xy(12, y)
            pdf.cell(20, 6, left)
            pdf.set_xy(33, y)
            pdf.cell(60, 6, right)
        pdf.set_encryption("owner-secret", user_password="s3cret")
        cls.locked_path = Path(cls.tempdir.name) / "locked.pdf"
        pdf.output(str(cls.locked_path))
        cls.data = cls.locked_path.read_bytes()
        cls.server, cls.port = start_service(dpi=150)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        sys.stderr = cls._stderr
        cls.tempdir.cleanup()

    def test_without_a_password_it_asks_for_one(self) -> None:
        status, payload = post(self.port, self.data)
        self.assertEqual(status, 200)
        self.assertFalse(payload["success"])
        self.assertEqual(payload["code"], "PASSWORD_REQUIRED")

    def test_a_wrong_password_is_reported_as_such(self) -> None:
        status, payload = post(self.port, self.data, {"X-Pdf-Password": "nope"})
        self.assertEqual(status, 200)
        self.assertFalse(payload["success"])
        self.assertEqual(payload["code"], "INCORRECT_PASSWORD")

    def test_the_right_password_unlocks_it(self) -> None:
        status, payload = post(self.port, self.data, {"X-Pdf-Password": "s3cret"})
        self.assertEqual(status, 200)
        self.assertTrue(payload["success"], payload)
        self.assertGreaterEqual(len(payload["table"]), 1)


class ParserServiceAuthTest(unittest.TestCase):
    """An open port on the internet must not be free compute for anyone."""

    TOKEN = "shared-secret"

    @classmethod
    def setUpClass(cls) -> None:
        cls._stderr = sys.stderr
        sys.stderr = io.StringIO()
        cls.tempdir = tempfile.TemporaryDirectory()
        cls.pdf = build_statement_pdf(str(Path(cls.tempdir.name) / "statement.pdf"), ruled=True)
        cls.data = Path(cls.pdf).read_bytes()
        cls.server, cls.port = start_service(token=cls.TOKEN, dpi=150)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        sys.stderr = cls._stderr
        cls.tempdir.cleanup()

    def test_a_request_without_the_token_is_unauthorized(self) -> None:
        status, payload = post(self.port, self.data)
        self.assertEqual(status, 401)
        self.assertFalse(payload["success"])

    def test_a_request_with_the_wrong_token_is_unauthorized(self) -> None:
        status, _ = post(self.port, self.data, {"Authorization": "Bearer nope"})
        self.assertEqual(status, 401)

    def test_a_request_with_the_token_is_read(self) -> None:
        status, payload = post(self.port, self.data, {"Authorization": f"Bearer {self.TOKEN}"})
        self.assertEqual(status, 200)
        self.assertTrue(payload["success"], payload)
        self.assertEqual(payload["method"], "grid")


if __name__ == "__main__":
    unittest.main()
