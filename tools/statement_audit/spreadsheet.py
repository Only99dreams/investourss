"""Deterministic Python port of supabase/functions/financial-audit/spreadsheet.ts.

Turns a table of cells (from a PDF, CSV or XLSX) into transaction rows:
header detection, column mapping, direction resolution, summary-row removal and
balance reconciliation — no AI involved.

Keep in sync with: supabase/functions/financial-audit/spreadsheet.ts
"""

from __future__ import annotations

import csv as _csv
import io
import math
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from .audit_rules import coerce_iso_date, js_number_string, normalize_amount, round_money

Table = list[list[Any]]

SUMMARY_WORDS = re.compile(
    r"\b(total|totals|closing|opening|sub-?total|balance b/f|balance c/f|brought forward|carried forward)\b",
    re.I,
)
OPENING_WORDS = re.compile(r"\b(opening|balance b/f|brought forward)\b", re.I)
CLOSING_WORDS = re.compile(r"\b(closing|balance c/f|carried forward)\b", re.I)

ColumnRole = str  # "date" | "description" | "debit" | "credit" | "amount" | "type" | "balance" | "reference" | "ignore"


@dataclass
class SheetReconciliation:
    opening: Optional[float] = None
    closing: Optional[float] = None
    credits: float = 0
    debits: float = 0
    expectedClosing: Optional[float] = None
    difference: Optional[float] = None
    reconciled: bool = False


@dataclass
class SheetParseResult:
    transactions: list[dict]
    columns: dict
    reconciliation: SheetReconciliation
    warnings: list[str] = field(default_factory=list)


def cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        # Keep "500000.00"-style source cells intact; only collapse bare ints.
        return str(int(value)) if abs(value) < 1e15 else str(value)
    return str(value).strip() if isinstance(value, str) else str(value)


def _num(value: Any) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value) if math.isfinite(float(value)) else math.nan
    return normalize_amount(cell_text(value))


def classify_header(raw: Any) -> ColumnRole:
    text = re.sub(r"[^a-z0-9+/()]+", " ", cell_text(raw).lower()).strip()
    if not text:
        return "ignore"
    if re.search(r"(\bref\b|reference|txn|cheque|transaction id|chq|cheque no)", text):
        return "reference"
    if (
        re.search(r"\bdate\b", text)
        or "trans time" in text
        or "transaction time" in text
        or "posting date" in text
        or "value date" in text
    ):
        return "date"
    if re.search(r"(description|narration|particulars|details|memo|remarks|narrative|transaction details|history)", text):
        return "description"
    if (
        re.search(
            r"\b(debit|debits|debit amount|debits amount|withdrawal|withdrawals|withdraw|dr|dr amount|paid out|payout|outflow|outflows)\b",
            text,
        )
        or re.search(r"(money out|pay out|amount out|outward)", text)
        or (re.search(r"\bdebit\b", text) and re.search(r"\bamount\b", text))
        or "(dr)" in text
    ):
        return "debit"
    if (
        re.search(
            r"\b(credit|credits|credit amount|credits amount|deposit|deposits|cr|cr amount|lodgement|lodgements|paid in|payin|inflow|inflows)\b",
            text,
        )
        or re.search(r"(money in|pay in|amount in|inward)", text)
        or (re.search(r"\bcredit\b", text) and re.search(r"\bamount\b", text))
        or "(cr)" in text
    ):
        return "credit"
    if re.search(r"\b(amount|value|transaction amount|trans amount)\b", text) and not re.search(r"\bbalance\b", text):
        return "amount"
    if re.search(r"\b(type|direction|dr cr|dr/cr)\b", text) or "dr/cr" in text:
        return "type"
    if re.search(r"\bbalance\b", text):
        return "balance"
    return "ignore"


def _type_from_cell(raw: Any) -> Optional[str]:
    text = cell_text(raw).lower()
    if re.search(r"\b(cr|credit|deposit|in)\b", text):
        return "credit"
    if re.search(r"\b(dr|debit|withdrawal|out)\b", text):
        return "debit"
    return None


def detect_header(rows: Table) -> Optional[dict]:
    best = None
    limit = min(len(rows), 25)
    for index in range(limit):
        row = rows[index] if index < len(rows) else []
        roles: dict[str, int] = {}
        score = 0
        for col, cell in enumerate(row):
            role = classify_header(cell)
            if role == "ignore":
                continue
            if role not in roles:
                roles[role] = col
            score += 1
        has_money = any(k in roles for k in ("debit", "credit", "amount", "balance"))
        has_core = ("date" in roles and "description" in roles) or has_money
        if score >= 2 and has_core and (best is None or score > best["score"]):
            best = {"index": index, "roles": roles, "score": score, "row": row}
    return best


def _is_repeated_header(row: list, header_row: list) -> bool:
    if len(row) != len(header_row):
        return False
    compared = 0
    for a_cell, b_cell in zip(row, header_row):
        a = cell_text(a_cell).lower()
        b = cell_text(b_cell).lower()
        if not a and not b:
            continue
        if a != b:
            return False
        compared += 1
    return compared >= 2


def _fallback_description(row: list, roles: dict) -> str:
    used = {v for v in roles.values() if v is not None}
    parts = []
    for index, cell in enumerate(row):
        if index in used:
            continue
        text = cell_text(cell)
        if text and not re.fullmatch(r"[\d.,+\-()]+", text):
            parts.append(text)
    return " ".join(parts).strip()


def _resolve_amount(row: list, roles: dict, previous_balance: float) -> dict:
    debit_value = _num(row[roles["debit"]]) if "debit" in roles else math.nan
    credit_value = _num(row[roles["credit"]]) if "credit" in roles else math.nan
    balance = _num(row[roles["balance"]]) if "balance" in roles else math.nan
    explicit_type = _type_from_cell(row[roles["type"]]) if "type" in roles else None

    has_debit = math.isfinite(debit_value) and debit_value > 0
    has_credit = math.isfinite(credit_value) and credit_value > 0

    if has_debit and not has_credit:
        return {"amount": abs(debit_value), "type": "debit", "balance": balance}
    if has_credit and not has_debit:
        return {"amount": abs(credit_value), "type": "credit", "balance": balance}
    if has_debit and has_credit:
        if explicit_type:
            chosen = debit_value if explicit_type == "debit" else credit_value
            return {"amount": abs(chosen), "type": explicit_type, "balance": balance}
        return {"amount": math.nan, "type": None, "balance": balance}

    if "amount" in roles:
        value = _num(row[roles["amount"]])
        if math.isfinite(value) and value != 0:
            txn_type = explicit_type or ("debit" if value < 0 else "credit")
            return {"amount": abs(value), "type": txn_type, "balance": balance}

    if math.isfinite(balance) and math.isfinite(previous_balance):
        delta = round_money(balance - previous_balance)
        if delta > 0:
            return {"amount": delta, "type": "credit", "balance": balance}
        if delta < 0:
            return {"amount": abs(delta), "type": "debit", "balance": balance}

    return {"amount": math.nan, "type": None, "balance": balance}


def table_to_transactions(rows: Table) -> SheetParseResult:
    header = detect_header(rows)
    if not header:
        return SheetParseResult(
            transactions=[],
            columns={},
            reconciliation=SheetReconciliation(),
            warnings=["No header row with transaction columns was found in this table."],
        )

    roles = header["roles"]
    warnings: list[str] = []
    transactions: list[dict] = []
    opening = closing = first_balance = last_balance = None
    previous_balance = math.nan
    skipped_summary = ambiguous_rows = invalid_dates = 0
    credits_total = debits_total = 0.0

    for index in range(header["index"] + 1, len(rows)):
        row = rows[index] if index < len(rows) else []
        if all(cell_text(cell) == "" for cell in row):
            continue
        if _is_repeated_header(row, header["row"]):
            continue

        description = (
            cell_text(row[roles["description"]])
            if "description" in roles
            else _fallback_description(row, roles)
        )
        date_raw = cell_text(row[roles["date"]]) if "date" in roles else ""
        date = coerce_iso_date(date_raw)
        balance = _num(row[roles["balance"]]) if "balance" in roles else math.nan

        debit_probe = _num(row[roles["debit"]]) if "debit" in roles else math.nan
        credit_probe = _num(row[roles["credit"]]) if "credit" in roles else math.nan
        amount_probe = _num(row[roles["amount"]]) if "amount" in roles else math.nan
        has_any_amount = (
            (math.isfinite(debit_probe) and debit_probe > 0)
            or (math.isfinite(credit_probe) and credit_probe > 0)
            or (math.isfinite(amount_probe) and amount_probe != 0)
        )

        # Opening/closing/summary rows are not transactions (skipped even when
        # dated); their balance still anchors reconciliation.
        if SUMMARY_WORDS.search(description) and (not date or not has_any_amount):
            if math.isfinite(balance):
                if OPENING_WORDS.search(description):
                    opening = balance
                elif CLOSING_WORDS.search(description):
                    closing = balance
                if first_balance is None:
                    first_balance = balance
                last_balance = balance
                previous_balance = balance
            skipped_summary += 1
            continue

        resolved = _resolve_amount(row, roles, previous_balance)
        if math.isfinite(resolved["balance"]):
            if first_balance is None:
                first_balance = resolved["balance"]
            last_balance = resolved["balance"]
            previous_balance = resolved["balance"]

        if not math.isfinite(resolved["amount"]) or resolved["amount"] <= 0 or not resolved["type"]:
            if description or date_raw:
                ambiguous_rows += 1
            continue

        if date_raw and not date:
            invalid_dates += 1

        reference = cell_text(row[roles["reference"]]) if "reference" in roles else ""
        transactions.append(
            {
                "date": date,
                "description": description or "Transaction",
                "amount": round_money(resolved["amount"]),
                "type": resolved["type"],
                "transactionId": reference or None,
            }
        )
        if resolved["type"] == "credit":
            credits_total += resolved["amount"]
        else:
            debits_total += resolved["amount"]

    credits = round_money(credits_total)
    debits = round_money(debits_total)
    open_balance = opening if opening is not None else first_balance
    close_balance = closing if closing is not None else last_balance
    expected_closing = difference = None
    reconciled = False
    if open_balance is not None:
        expected_closing = round_money(open_balance + credits - debits)
        if close_balance is not None:
            difference = round_money(close_balance - expected_closing)
            reconciled = abs(difference) <= 0.01

    if skipped_summary:
        warnings.append(f"Ignored {skipped_summary} summary/balance row(s).")
    if invalid_dates:
        warnings.append(f"{invalid_dates} row(s) had an unreadable date.")
    if ambiguous_rows:
        warnings.append(f"{ambiguous_rows} row(s) had no usable amount or direction.")
    if open_balance is not None and close_balance is not None and not reconciled:
        warnings.append(
            f"Statement does not reconcile: expected closing {js_number_string(expected_closing)}, "
            f"found {js_number_string(close_balance)} (difference {js_number_string(difference)})."
        )

    return SheetParseResult(
        transactions=transactions,
        columns=dict(roles),
        reconciliation=SheetReconciliation(
            opening=open_balance,
            closing=close_balance,
            credits=credits,
            debits=debits,
            expectedClosing=expected_closing,
            difference=difference,
            reconciled=reconciled,
        ),
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# CSV parsing (RFC-4180 quoting, BOM, CRLF, comma/semicolon/tab).
# ---------------------------------------------------------------------------

def _pick_delimiter(line: str) -> str:
    best, best_count = ",", -1
    for candidate in (",", ";", "\t"):
        count = line.count(candidate)
        if count > best_count:
            best_count = count
            best = candidate
    return best


def parse_csv(text: str) -> Table:
    content = text.lstrip("﻿")
    first_break = re.search(r"\r?\n", content)
    first_line = content if first_break is None else content[: first_break.start()]
    delimiter = _pick_delimiter(first_line)
    reader = _csv.reader(io.StringIO(content), delimiter=delimiter)
    return [row for row in reader]
