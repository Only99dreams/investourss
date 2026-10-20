"""HTTP service: let OpenCV read every statement the app uploads.

Supabase Edge Functions run in Deno, and Deno cannot load OpenCV. So the
`parse-statement` Edge Function forwards each uploaded PDF *here* (see
`OPENCV_PARSER_URL` in its source); this service rasterises the page, finds the
ruling with OpenCV and answers in exactly the JSON shape the app already
expects, so the auditor, the preview and the audit all keep working unchanged.

Run it (no installs beyond tools/requirements.txt):

    tools\\pyenv\\python.exe tools\\parser_service.py --port 8787

Then point the app at it:

    supabase secrets set OPENCV_PARSER_URL=https://your-host OPENCV_PARSER_TOKEN=...
    supabase functions deploy parse-statement

If the service is ever unreachable or slow, the Edge Function silently falls
back to its built-in parser — an upload never fails because of this service.

Endpoints
    GET  /health   {ok, ocr, dpi}
    POST /parse    body = the raw PDF bytes
                   headers: X-Pdf-Password (optional, locked PDFs)
                            Authorization: Bearer <token>  (when --token set)
                   -> {success, text, pages, table, reader, method, warnings}
                   -> {success:false, code, error}  (PASSWORD_REQUIRED /
                      INCORRECT_PASSWORD / NO_TEXT / BAD_REQUEST)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from statement_audit.pdf_table import DEFAULT_DPI, pdf_to_table, tesseract_available  # noqa: E402

# Same ceilings the Edge Function applies to its own parsers, so a huge
# statement cannot blow up the browser either.
MAX_BODY_BYTES = 40 * 1024 * 1024
MAX_TEXT_CHARS = 100_000
MAX_TABLE_ROWS = 5_000
MAX_WARNINGS = 20
# Below this the PDF has no usable text layer (a scan) and nothing to show.
MIN_TEXT_LENGTH = 20
PASSWORD_HINT = "password"


def _password_error(password_supplied: bool) -> dict:
    """Drive the app's password flow the same way the Deno parser does."""
    if password_supplied:
        return {
            "success": False,
            "code": "INCORRECT_PASSWORD",
            "error": "That password did not unlock the PDF. Please check it and try again.",
        }
    return {
        "success": False,
        "code": "PASSWORD_REQUIRED",
        "error": "This statement is password-protected. Enter the PDF password to continue.",
    }


def parse_pdf(data: bytes, password: str = "", dpi: int = DEFAULT_DPI) -> dict:
    """Read one PDF with OpenCV and answer in the parse-statement contract."""
    handle = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    try:
        with handle:
            handle.write(data)
        extraction = pdf_to_table(handle.name, dpi=dpi, password=password or None)
    except Exception as error:  # noqa: BLE001 - reported to the caller, never raised
        if PASSWORD_HINT in str(error).lower():
            return _password_error(bool(password))
        return {"success": False, "error": f"Could not read this PDF: {error}"}
    finally:
        try:
            os.unlink(handle.name)
        except OSError:
            pass

    text = (extraction.lines_text or "").strip()
    if len(text) < MIN_TEXT_LENGTH:
        return {
            "success": False,
            "code": "NO_TEXT",
            "error": (
                "No readable text found in this PDF. It may be a scanned image — try a "
                "text/PDF export from your banking app, or paste the statement text manually."
            ),
        }

    return {
        "success": True,
        "text": text[:MAX_TEXT_CHARS],
        "pages": extraction.pages,
        "table": extraction.rows[:MAX_TABLE_ROWS],
        "reader": "opencv",
        "method": extraction.modes[0] if extraction.modes else "text",
        "methods": extraction.modes,
        "headerFound": extraction.header_found,
        "warnings": extraction.warnings[:MAX_WARNINGS],
    }


class ParserHandler(BaseHTTPRequestHandler):
    """One thread per connection; each parse is independent."""

    server_version = "statement-parser/1.0"
    # Bound per server instance in main() via a subclass.
    token: str = ""
    dpi: int = DEFAULT_DPI

    def _send(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _path(self) -> str:
        return self.path.split("?")[0].rstrip("/") or "/"

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        if self._path() == "/health":
            self._send({"ok": True, "ocr": tesseract_available(), "dpi": self.dpi})
            return
        self._send({"error": "Not found."}, 404)

    def do_POST(self) -> None:  # noqa: N802 - http.server naming
        if self._path() != "/parse":
            self._send({"error": "Not found."}, 404)
            return
        if self.token and self.headers.get("Authorization", "") != f"Bearer {self.token}":
            self._send({"success": False, "error": "Unauthorized."}, 401)
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._send({"success": False, "code": "BAD_REQUEST", "error": "Send the PDF as the request body."}, 400)
            return
        if length > MAX_BODY_BYTES:
            self._send({"success": False, "code": "BAD_REQUEST", "error": "That file is too large."}, 413)
            return

        data = self.rfile.read(length)
        password = self.headers.get("X-Pdf-Password", "") or ""
        started = time.time()
        try:
            result = parse_pdf(data, password=password, dpi=self.dpi)
        except Exception as error:  # noqa: BLE001 - a request must never kill the thread
            result = {"success": False, "error": f"Failed to parse the PDF: {error}"}
        elapsed_ms = int((time.time() - started) * 1000)

        outcome = "ok" if result.get("success") else str(result.get("code") or "error")
        print(
            f"[parse] {len(data)} bytes  password={'yes' if password else 'no'}  "
            f"{outcome}  pages={result.get('pages', 0)} rows={len(result.get('table') or [])}  "
            f"{elapsed_ms}ms",
            file=sys.stderr,
            flush=True,
        )
        self._send(result)


def serve(host: str, port: int, token: str = "", dpi: int = DEFAULT_DPI) -> ThreadingHTTPServer:
    """Build (but do not start) the server. Split out so tests can bind port 0."""
    bound = type("BoundParserHandler", (ParserHandler,), {"token": token, "dpi": dpi})
    return ThreadingHTTPServer((host, port), bound)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OpenCV bank-statement reader for the financial auditor.")
    parser.add_argument("--host", default=os.environ.get("PARSER_HOST", "0.0.0.0"))
    parser.add_argument(
        "--port",
        type=int,
        # PARSER_PORT wins, then the PORT most PaaS platforms inject, then 8787.
        default=int(os.environ.get("PARSER_PORT") or os.environ.get("PORT") or "8787"),
    )
    parser.add_argument("--token", default=os.environ.get("PARSER_TOKEN", ""), help="require Authorization: Bearer <token>")
    parser.add_argument("--dpi", type=int, default=int(os.environ.get("PARSER_DPI", str(DEFAULT_DPI))))
    args = parser.parse_args(argv)

    server = serve(args.host, args.port, token=args.token, dpi=args.dpi)
    print(
        f"statement parser listening on http://{args.host}:{server.server_address[1]}  "
        f"(ocr={'yes' if tesseract_available() else 'no'}, dpi={args.dpi}, "
        f"token={'set' if args.token else 'open'})",
        file=sys.stderr,
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("stopping.", file=sys.stderr, flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
