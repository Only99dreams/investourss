"""Deterministic Python port of the line parser in auditRules.ts
(`parseFinancialRecords` + `normalizeStatementLine`).

This is the fallback path: when a PDF cannot be rebuilt into a real table, the
page text is parsed line by line instead.

Keep in sync with: supabase/functions/financial-audit/auditRules.ts
"""

from __future__ import annotations

import math
import re
from typing import Optional

from .audit_rules import (
    BARE_AMOUNT_PATTERN,
    BALANCE_TOKEN_PATTERN,
    CREDIT_WORDS,
    CURRENCY_AMOUNT_PATTERN,
    DEBIT_WORDS,
    MARKED_AMOUNT_PATTERN,
    SOURCE_DATE_PATTERN,
    SOURCE_ID_CLEANUP_PATTERN,
    is_summary_line,
    parse_source_date,
    round_money,
)


def normalize_statement_line(line: str) -> str:
    value = line.replace("\u00A0", " ")
    # Merge space-separated thousands ("1 250 000.00" -> "1250000.00").
    while True:
        previous = value
        value = re.sub(r"(\d)\s(?=\d{3}(?:\D|$))", r"\1", value)
        if value == previous:
            break
    # Separate an amount from digits glued to its decimals ("...00" + "700...").
    value = re.sub(r"(\.\d{2})(?=\d)", r"\1 ", value)
    # Separate a number from an immediately following CR/DR marker.
    value = re.sub(r"(\d)(?=(?:CR|DR)\b)", r"\1 ", value, flags=re.I)
    # Separate a trailing number (often a date) from a glued word.
    value = re.sub(r"(\d)(?=[A-Za-z]{2,})", r"\1 ", value)
    # Separate letters from a following money-like amount.
    value = re.sub(r"([A-Za-z])(?=(?:\d{1,3}(?:,\d{3})+|\d+\.\d{1,2}))", r"\1 ", value)
    return value


def _pick_amount(entries: list[dict]) -> Optional[dict]:
    non_zero = [e for e in entries if e["value"] != 0]
    if not non_zero:
        return None
    for entry in non_zero:
        if re.search(r"[.,]", entry["raw"]):
            return entry
    return non_zero[0]


_ID_PATTERN = re.compile(
    r"\b(?:txn(?:\s*id)?|transaction(?:\s*id)?|reference|ref)\s*[:#-]?\s*([A-Z0-9-]+)", re.I
)


def parse_financial_records(text: str) -> list[dict]:
    lines = [
        normalized
        for original in re.split(r"\r?\n", text)
        if (normalized := normalize_statement_line(original).strip())
    ]

    rows: list[dict] = []

    for original_line in lines:
        if is_summary_line(original_line):
            continue

        id_match = _ID_PATTERN.search(original_line)
        transaction_id = id_match.group(1) if id_match else None

        labelled_balance: Optional[float] = None
        balance_match = BALANCE_TOKEN_PATTERN.search(original_line)
        if balance_match:
            try:
                value = float(balance_match.group(1).replace(" ", "").replace(",", ""))
            except ValueError:
                value = math.nan
            if math.isfinite(value):
                labelled_balance = value

        date_token = SOURCE_DATE_PATTERN.search(original_line)
        transaction_date = parse_source_date(date_token.group(0)) if date_token else None

        # Remove balances, references, dates and currency symbols, then read
        # every amount that remains.
        amount_text = BALANCE_TOKEN_PATTERN.sub(" ", original_line)
        amount_text = SOURCE_ID_CLEANUP_PATTERN.sub(" ", amount_text)
        amount_text = SOURCE_DATE_PATTERN.sub(" ", amount_text)
        amount_text = re.sub(r"(?:NGN|₦)", " ", amount_text, flags=re.I)

        amounts = []
        for match in BARE_AMOUNT_PATTERN.finditer(amount_text):
            try:
                value = float(match.group(1).replace(" ", "").replace(",", ""))
            except ValueError:
                value = math.nan
            if math.isfinite(value):
                amounts.append({"raw": match.group(1), "value": value})

        if not amounts:
            # A line that is only a labelled balance anchors the running
            # balance so the first real transaction can still get a direction.
            if labelled_balance is not None:
                rows.append(
                    {
                        "date": transaction_date,
                        "description": "",
                        "amount": 0,
                        "explicitType": None,
                        "balance": labelled_balance,
                        "transactionId": transaction_id,
                        "balanceOnly": True,
                    }
                )
            continue

        balance = labelled_balance
        if labelled_balance is None and len(amounts) >= 2:
            balance = amounts[-1]["value"]
            chosen = _pick_amount(amounts[:-1])
        else:
            chosen = _pick_amount(amounts)
        if not chosen or chosen["value"] == 0:
            continue

        marker = MARKED_AMOUNT_PATTERN.search(original_line)
        marker_value = None
        if marker:
            marker_value = (marker.group(2) or marker.group(3) or "").lower() or None
        is_credit = CREDIT_WORDS.search(original_line) is not None
        is_debit = DEBIT_WORDS.search(original_line) is not None
        explicit_type: Optional[str] = None
        if marker_value in ("cr", "dr"):
            explicit_type = "credit" if marker_value == "cr" else "debit"
        elif is_credit != is_debit:
            explicit_type = "credit" if is_credit else "debit"
        elif chosen["raw"].strip()[:1] in ("+", "-"):
            explicit_type = "credit" if chosen["raw"].strip().startswith("+") else "debit"

        description = SOURCE_ID_CLEANUP_PATTERN.sub(" ", original_line)
        description = BALANCE_TOKEN_PATTERN.sub(" ", description)
        description = SOURCE_DATE_PATTERN.sub(" ", description)
        description = CURRENCY_AMOUNT_PATTERN.sub(" ", description, count=1)
        description = MARKED_AMOUNT_PATTERN.sub(" ", description, count=1)
        description = BARE_AMOUNT_PATTERN.sub(" ", description)
        description = re.sub(
            r"\b(?:CR|DR|NGN|Avail Bal|Available Balance|Closing Balance|Txn ID|Acct|Account)\b",
            " ",
            description,
            flags=re.I,
        )
        description = re.sub(r"\s+", " ", description).strip()

        rows.append(
            {
                "date": transaction_date,
                "description": description,
                "amount": abs(chosen["value"]),
                "explicitType": explicit_type,
                "balance": balance,
                "transactionId": transaction_id,
                "balanceOnly": False,
            }
        )

    # Rows without a direction word can still be read from the running balance:
    # a row's own balance differs from an adjacent row's balance by exactly its
    # amount, and the sign of that difference gives the direction.
    for index, row in enumerate(rows):
        if row["balanceOnly"] or row["explicitType"] is not None or row["balance"] is None:
            continue
        for neighbour_index in (index - 1, index + 1):
            if not 0 <= neighbour_index < len(rows):
                continue
            neighbour = rows[neighbour_index]
            if neighbour["balance"] is None:
                continue
            delta = round_money(row["balance"] - neighbour["balance"])
            if abs(abs(delta) - row["amount"]) <= 0.01:
                row["explicitType"] = "credit" if delta > 0 else "debit"
                break

    transactions = []
    for row in rows:
        if row["balanceOnly"] or not row["explicitType"]:
            continue
        transactions.append(
            {
                "date": row["date"],
                "description": row["description"]
                or ("Credit received" if row["explicitType"] == "credit" else "Debit"),
                "amount": row["amount"],
                "type": row["explicitType"],
                "transactionId": row["transactionId"],
            }
        )
    return transactions
