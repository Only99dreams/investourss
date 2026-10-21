"""Deterministic Python port of supabase/functions/financial-audit/auditRules.ts.

The TypeScript module is the single source of truth for the audit arithmetic in
the web app. This port keeps the same logic, the same field names and the same
rounding behaviour (half-up like JavaScript's Math.round) so a statement audited
here produces the same figures as the edge function.

Keep in sync with: supabase/functions/financial-audit/auditRules.ts
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

FINANCIAL_AUDIT_RULES_VERSION = "1.0.0"
MAX_NUMERIC_15_2_EXCLUSIVE = 10_000_000_000_000

LEAKAGE_DESCRIPTION = re.compile(
    r"\b(bank fee|bank charge|service charge|maintenance fee|commission|stamp duty|vat)\b",
    re.I,
)

TABLE_HEADER_WORDS = [
    "date", "value date", "trans. time", "trans time", "transaction date", "posting date",
    "description", "narration", "particulars", "details", "transaction details", "remarks",
    "debit", "credit", "debits", "credits", "amount", "withdrawal", "deposit",
    "balance", "balance after", "running balance", "closing balance", "available balance",
    "channel", "reference", "transaction reference", "txn", "dr", "cr",
]

SOURCE_DATE_PATTERN = re.compile(
    r"\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,9}[-\s,]{0,2}\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})\b"
)
ROW_DATE_PATTERN = re.compile(
    r"\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,9}[-\s,]{0,2}\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})\b"
)
ROW_AMOUNT_PATTERN = re.compile(r"(?:₦|NGN)?\s*\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|(?:₦|NGN)?\s*\d+\.\d{2}")
SUMMARY_LINE_PATTERN = re.compile(
    r"\b(?:total|closing|opening|sub-?total|balance b/f|balance c/f|carried forward)\b", re.I
)

MONTH_NAMES = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

FALLBACK_AMOUNT_PATTERN = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?"
CURRENCY_AMOUNT_PATTERN = re.compile(
    r"(?:NGN|₦)\s*([+-]?[\d,]+(?:\.\d{1,2})?)|([+-]?[\d,]+(?:\.\d{1,2})?)\s*(?:NGN|₦)", re.I
)
MARKED_AMOUNT_PATTERN = re.compile(
    rf"({FALLBACK_AMOUNT_PATTERN})\s*(CR|DR)\b|\b(CR|DR)\s*({FALLBACK_AMOUNT_PATTERN})", re.I
)
BARE_AMOUNT_PATTERN = re.compile(
    r"(?:^|\s)([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{1,2}|\d{1,3}(?:,\d{3})+|\d+))(?=$|\s)"
)
BALANCE_TOKEN_PATTERN = re.compile(
    r"\b(?:avail(?:able)?\s+bal(?:ance)?|closing\s+bal(?:ance)?|opening\s+bal(?:ance)?|ledger\s+bal(?:ance)?|running\s+bal(?:ance)?|book\s+bal(?:ance)?|bal(?:ance)?)\b\s*[:=]?\s*(?:NGN|₦)?\s*([\d,]+(?:\.\d{1,2})?)",
    re.I,
)
SOURCE_ID_CLEANUP_PATTERN = re.compile(
    r"\b(?:txn(?:\s*id)?|transaction(?:\s*id)?|reference|ref)\s*[:#-]?\s*[A-Z0-9-]+", re.I
)
CREDIT_WORDS = re.compile(
    r"\b(credit|cr|deposit|transfer from|payment received|salary|funding|interest|refund|inward|remittance)\b",
    re.I,
)
DEBIT_WORDS = re.compile(
    r"\b(debit|dr|withdraw|transfer to|transfer of|payment to|outgoing|sent to|charged|deducted|pos|atm|bill|airtime|charge|fee|purchase|outward|levy)\b",
    re.I,
)


# ---------------------------------------------------------------------------
# Data contracts (mirror the TS interfaces).
# ---------------------------------------------------------------------------

@dataclass
class ExtractedTransaction:
    date: Optional[str]
    description: str
    amount: float
    type: str  # "credit" | "debit"
    transactionId: Optional[str] = None


@dataclass
class FinancialTransaction:
    date: Optional[str]
    description: str
    amount: float
    type: str
    category: str
    transactionId: Optional[str] = None


@dataclass
class MonthlyObservation:
    month: str
    income: float
    outflows: float
    source: str = "calculated"
    verification: str = "unverified"


@dataclass
class MonthlyScore:
    month: str
    score: int


@dataclass
class NamedAmount:
    name: str
    amount: float


@dataclass
class Leakage:
    description: str
    amount: float
    category: str


@dataclass
class DataQuality:
    excludedInvalidTransactions: int = 0
    duplicateRowsIgnored: int = 0
    undatedTransactions: int = 0
    excludedUndatedTransactions: int = 0


@dataclass
class FinancialAuditRulesResult:
    rulesVersion: str
    periodStart: str
    periodEnd: str
    auditMonths: int
    statementMonthsCovered: int
    totalIncome: float
    totalExpenses: float
    cashFlow: float
    savingsRate: float
    score: int
    healthScore: int
    healthStatus: str
    recoverableAmount: float
    recoverable: list[dict]
    transactions: list[FinancialTransaction]
    monthlyObservations: list[MonthlyObservation]
    monthlyScores: list[MonthlyScore]
    incomeSources: list[NamedAmount]
    topSpendingCategories: list[NamedAmount]
    leakages: list[Leakage]
    dataQuality: DataQuality


# ---------------------------------------------------------------------------
# Small numeric / date helpers.
# ---------------------------------------------------------------------------

def js_round(value: float) -> int:
    """JavaScript Math.round: halves round toward +Infinity."""
    return math.floor(value + 0.5)


def round_money(value: float) -> float:
    """Same as TS roundMoney: Math.round((value + Number.EPSILON) * 100) / 100."""
    return js_round((value + 2.220446049250313e-16) * 100) / 100


def valid_iso_date(value: Any) -> bool:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return parsed.strftime("%Y-%m-%d") == value


def normalize_amount(value: Any) -> float:
    if isinstance(value, bool):
        return math.nan
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return math.nan
    normalized = value.strip()
    normalized = re.sub(r"^(?:NGN|₦)\s*", "", normalized, flags=re.I)
    normalized = re.sub(r"\s*(?:NGN|₦)$", "", normalized, flags=re.I)
    normalized = normalized.replace(",", "")
    if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d+)?|\.\d+)", normalized):
        return math.nan
    return float(normalized)


def parse_source_date(value: str) -> Optional[str]:
    iso = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", value)
    local = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$", value)
    day_first = re.match(r"^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]{0,2}(\d{2,4})$", value)
    name_first = re.match(r"^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$", value)
    year = month = day = None
    if iso:
        year, month, day = int(iso.group(1)), int(iso.group(2)), int(iso.group(3))
    elif local:
        year, month, day = int(local.group(3)), int(local.group(2)), int(local.group(1))
    elif day_first:
        year = int(day_first.group(3))
        month = MONTH_NAMES.get(day_first.group(2)[:3].lower())
        day = int(day_first.group(1))
    elif name_first:
        year = int(name_first.group(3))
        month = MONTH_NAMES.get(name_first.group(1)[:3].lower())
        day = int(name_first.group(2))
    else:
        return None
    if month is None or day is None:
        return None
    if year < 100:
        year = 2000 + year
    try:
        parsed = datetime(year, month, day)
    except ValueError:
        return None
    return parsed.strftime("%Y-%m-%d")


def coerce_iso_date(value: Any) -> Optional[str]:
    if valid_iso_date(value):
        return value
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    iso_prefix = trimmed[:10]
    if valid_iso_date(iso_prefix):
        return iso_prefix
    match = SOURCE_DATE_PATTERN.search(trimmed)
    return parse_source_date(match.group(0)) if match else None


def utc_today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def js_number_string(value: Any) -> str:
    """Format a number the way JavaScript's String(n) does (no trailing ".0").

    Used in message text so warnings read identically to the TypeScript app.
    """
    if value is None:
        return "undefined"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        if value.is_integer():
            return str(int(value))
        return repr(value)
    return str(value)


def _reference_day(reference_date: Optional[datetime] = None) -> str:
    if reference_date is None:
        return utc_today()
    if reference_date.tzinfo is not None:
        reference_date = reference_date.astimezone(timezone.utc)
    return reference_date.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Row classification helpers.
# ---------------------------------------------------------------------------

def is_header_line(line: str) -> bool:
    trimmed = line.strip()
    if not trimmed or len(trimmed) > 40:
        return False
    stripped = re.sub(r"[₦$.,()/:_-]+", " ", trimmed.lower())
    stripped = re.sub(r"\s+", " ", stripped).strip()
    if not stripped:
        return False
    if re.search(r"\d{2,}", stripped):
        return False
    words = [w for w in stripped.split(" ") if w]
    if not words or len(words) > 4:
        return False
    return all(word in TABLE_HEADER_WORDS for word in words)


def looks_like_row_line(line: str) -> bool:
    return bool(ROW_DATE_PATTERN.search(line) and ROW_AMOUNT_PATTERN.search(line))


def is_summary_line(line: str) -> bool:
    trimmed = line.strip()
    if not trimmed or len(trimmed) > 48:
        return False
    if not SUMMARY_LINE_PATTERN.search(trimmed):
        return False
    # A genuine transaction row carries a date; a summary line does not.
    return not ROW_DATE_PATTERN.search(trimmed)


def category_from_description(description: str) -> str:
    value = description.lower()
    if LEAKAGE_DESCRIPTION.search(value):
        return "bank charges"
    if re.search(r"\b(pos|atm|withdrawal)\b", value):
        return "withdrawals"
    if re.search(r"\b(airtime|data bundle|mobile data)\b", value):
        return "airtime & data"
    if re.search(r"\b(transfer|sent to|received from)\b", value):
        return "transfers"
    if re.search(r"\b(rent|landlord|housing)\b", value):
        return "rent"
    if re.search(r"\b(salary|wages|payroll)\b", value):
        return "salary"
    if re.search(r"\b(electricity|utility|water bill|internet bill)\b", value):
        return "utilities"
    if re.search(r"\b(food|restaurant|grocery|supermarket|market)\b", value):
        return "food & shopping"
    return "other"


# ---------------------------------------------------------------------------
# Printed totals + parser confidence.
# ---------------------------------------------------------------------------

def _read_printed_totals(text: str) -> tuple[Optional[float], Optional[float]]:
    def find(pattern: re.Pattern) -> Optional[float]:
        match = pattern.search(text)
        if not match:
            return None
        tail = text[match.end(): match.end() + 60]
        amount_match = re.search(r"(?:₦|NGN)?\s*([+-]?[\d,]+(?:\.\d{1,2})?)", tail)
        if not amount_match:
            return None
        try:
            value = float(amount_match.group(1).replace(",", "").replace(" ", ""))
        except ValueError:
            return None
        return value if math.isfinite(value) else None

    credit = find(re.compile(r"\btotal\s+credits?\b|\bcredits?\s*\(₦\)|\btotal\s+credit\b", re.I))
    debit = find(re.compile(r"\btotal\s+debits?\b|\bdebits?\s*\(₦\)|\btotal\s+debit\b", re.I))
    return credit, debit


def _as_extracted(item: Any) -> ExtractedTransaction:
    """Accept either an ExtractedTransaction or a plain mapping (as the TS does)."""
    if isinstance(item, ExtractedTransaction):
        return item
    if isinstance(item, dict):
        return ExtractedTransaction(
            date=item.get("date"),
            description=item.get("description") or "",
            amount=item.get("amount"),
            type=item.get("type"),
            transactionId=item.get("transactionId"),
        )
    raise TypeError(f"Expected a transaction (mapping or ExtractedTransaction), got {type(item)!r}")


def compare_printed_totals(
    text: str,
    parsed_transactions: Iterable[ExtractedTransaction],
    tolerance: float = 1.0,
) -> dict:
    printed_credit, printed_debit = _read_printed_totals(text)
    parsed = [_as_extracted(t) for t in parsed_transactions]
    parsed_credits = round_money(sum(t.amount for t in parsed if t.type == "credit"))
    parsed_debits = round_money(sum(t.amount for t in parsed if t.type == "debit"))
    credit_matches = (
        None if printed_credit is None else abs(parsed_credits - printed_credit) <= tolerance
    )
    debit_matches = (
        None if printed_debit is None else abs(parsed_debits - printed_debit) <= tolerance
    )
    return {
        "printedCredit": printed_credit,
        "printedDebit": printed_debit,
        "parsedCredits": parsed_credits,
        "parsedDebits": parsed_debits,
        "creditMatches": credit_matches,
        "debitMatches": debit_matches,
    }


def assess_parser_confidence(
    text: str, parsed_transactions: Iterable[ExtractedTransaction]
) -> dict:
    lines = text.splitlines()
    header_lines = 0
    row_lines = 0
    for line in lines:
        if is_header_line(line):
            header_lines += 1
        elif looks_like_row_line(line) or is_summary_line(line):
            row_lines += 1

    if header_lines >= 3 and row_lines <= max(2, header_lines // 3):
        return {"reliable": False, "reason": "header-fragmented"}

    totals = compare_printed_totals(text, parsed_transactions)
    if totals["creditMatches"] is False or totals["debitMatches"] is False:
        return {"reliable": False, "reason": "total-mismatch"}

    return {"reliable": True, "reason": "ok"}


# ---------------------------------------------------------------------------
# Audit window.
# ---------------------------------------------------------------------------

def rows_are_final(table_reader: str) -> bool:
    """Whether the rows in a request must be trusted verbatim.

    A PDF the OpenCV service read arrives as rows, and those rows ARE the
    statement — re-reading their text with an AI extractor could change the
    totals, so the auditor keeps them instead. A CSV/XLSX the browser parsed also
    arrives as rows that nothing needs to re-read.

    The one table that is not final on its own is one reconstructed from text
    without a real reader, where a column can be mis-assigned; the caller may
    then fall back to the statement text.

    Mirrors `rowsAreFinal` in supabase/functions/financial-audit/auditRules.ts.
    """
    return table_reader in ("opencv", "browser-spreadsheet")


def months_covered_by_statement(
    dates: Iterable[Optional[str]], reference_date: Optional[datetime] = None
) -> int:
    reference_day = _reference_day(reference_date)
    valid = sorted(d for d in dates if d and valid_iso_date(d) and d <= reference_day)
    if not valid:
        return 1
    first, last = valid[0], valid[-1]
    first_year, first_month = int(first[:4]), int(first[5:7])
    last_year, last_month = int(last[:4]), int(last[5:7])
    return max(1, (last_year - first_year) * 12 + (last_month - first_month) + 1)


def get_audit_window(
    dates: Iterable[Optional[str]],
    months: int,
    reference_date: Optional[datetime] = None,
) -> dict:
    audit_months = int(months) if math.isfinite(months) and months >= 1 else 1
    audit_months = max(1, math.floor(audit_months))
    reference_day = _reference_day(reference_date)
    valid = sorted(d for d in dates if d and valid_iso_date(d) and d <= reference_day)
    if valid:
        anchor_str = valid[0]
        anchor_year, anchor_month = int(anchor_str[:4]), int(anchor_str[5:7])
    else:
        anchor_year, anchor_month = int(reference_day[:4]), int(reference_day[5:7])
    start = datetime(anchor_year, anchor_month, 1)
    # end = last day of (anchor month + auditMonths - 1)
    total_months = anchor_year * 12 + (anchor_month - 1) + audit_months
    end_year, end_month_zero = divmod(total_months, 12)
    end = datetime(end_year, end_month_zero + 1, 1) - timedelta(days=1)
    return {
        "periodStart": start.strftime("%Y-%m-%d"),
        "periodEnd": end.strftime("%Y-%m-%d"),
        "auditMonths": audit_months,
    }


# ---------------------------------------------------------------------------
# Normalisation of raw transaction rows.
# ---------------------------------------------------------------------------

def normalize_transactions(raw: Iterable[Any]) -> dict:
    seen_signatures: set[str] = set()
    excluded_invalid = 0
    duplicate_rows = 0
    undated = 0
    transactions: list[FinancialTransaction] = []

    for item in raw:
        if not isinstance(item, dict):
            excluded_invalid += 1
            continue
        direction = str(item.get("type", "") or "").strip().lower()
        if direction in ("credit", "cr"):
            txn_type = "credit"
        elif direction in ("debit", "dr"):
            txn_type = "debit"
        else:
            txn_type = None
        amount = normalize_amount(item.get("amount"))
        magnitude = abs(amount)
        description = item.get("description").strip() if isinstance(item.get("description"), str) else ""
        has_date = item.get("date") not in (None, "")
        date = coerce_iso_date(item.get("date"))
        rounded = round_money(magnitude)
        if (
            txn_type is None
            or not math.isfinite(amount)
            or magnitude == 0
            or rounded >= MAX_NUMERIC_15_2_EXCLUSIVE
            or (has_date and not date)
        ):
            excluded_invalid += 1
            continue
        if not date:
            undated += 1

        raw_id = item.get("transactionId")
        transaction_id = raw_id.strip() if isinstance(raw_id, str) and raw_id.strip() else None
        resolved_description = description or "Transaction"
        if transaction_id:
            signature = "\x00".join(
                [transaction_id, date or "", resolved_description, str(rounded), txn_type]
            )
            if signature in seen_signatures:
                duplicate_rows += 1
                continue
            seen_signatures.add(signature)

        transactions.append(
            FinancialTransaction(
                date=date,
                description=resolved_description,
                amount=rounded,
                type=txn_type,
                category=category_from_description(resolved_description),
                transactionId=transaction_id,
            )
        )

    return {
        "transactions": transactions,
        "excludedInvalidTransactions": excluded_invalid,
        "duplicateRowsIgnored": duplicate_rows,
        "undatedTransactions": undated,
    }


# ---------------------------------------------------------------------------
# Scoring.
# ---------------------------------------------------------------------------

def score_health(total_income: float, total_expenses: float, leakage_count: int) -> int:
    cash_flow = total_income - total_expenses
    savings_rate = (cash_flow / total_income) * 100 if total_income > 0 else 0
    score = 55
    if cash_flow > 0:
        score += 15
    if savings_rate >= 20:
        score += 10
    elif savings_rate >= 10:
        score += 5
    score -= min(15, leakage_count * 2)
    return max(10, min(95, js_round(score)))


def status_from_score(score: int) -> str:
    if score >= 80:
        return "excellent"
    if score >= 65:
        return "good"
    if score >= 50:
        return "needs_attention"
    return "critical"


def _sum_by(items: Iterable[Any], key_fn, amount_fn) -> list[NamedAmount]:
    totals: dict[str, float] = {}
    for item in items:
        name = key_fn(item)
        totals[name] = totals.get(name, 0) + amount_fn(item)
    result = [NamedAmount(name=k, amount=round_money(v)) for k, v in totals.items()]
    result.sort(key=lambda entry: (-entry.amount, entry.name))
    return result


def sum_monthly(transactions: Iterable[FinancialTransaction]) -> list[MonthlyObservation]:
    months: dict[str, dict] = {}
    for transaction in transactions:
        if not transaction.date:
            continue
        month = transaction.date[:7]
        total = months.setdefault(month, {"month": month, "income": 0.0, "outflows": 0.0})
        total["income" if transaction.type == "credit" else "outflows"] += transaction.amount
    observations = [
        MonthlyObservation(
            month=entry["month"],
            income=round_money(entry["income"]),
            outflows=round_money(entry["outflows"]),
        )
        for entry in sorted(months.values(), key=lambda e: e["month"])
    ]
    return observations


def score_monthly(transactions: list[FinancialTransaction]) -> list[MonthlyScore]:
    observations = sum_monthly(transactions)
    result = []
    for obs in observations:
        leakage_count = sum(
            1
            for t in transactions
            if t.date
            and t.date.startswith(obs.month)
            and t.type == "debit"
            and LEAKAGE_DESCRIPTION.search(t.description)
        )
        result.append(MonthlyScore(month=obs.month, score=score_health(obs.income, obs.outflows, leakage_count)))
    return result


# ---------------------------------------------------------------------------
# The main rules entry point.
# ---------------------------------------------------------------------------

def apply_financial_audit_rules(
    raw_transactions: Iterable[Any],
    requested_months: float,
    reference_date: Optional[datetime] = None,
) -> FinancialAuditRulesResult:
    normalized = normalize_transactions(raw_transactions)
    # Every transaction in the uploaded statement is totalled, so the figures are
    # exactly the statement's own columns: total income is the sum of ALL credit
    # rows and total expenses the sum of ALL debit rows. The selected months are
    # reported (periodStart/periodEnd, the monthly breakdown,
    # statementMonthsCovered) but they no longer trim the totals — trimming is
    # what made an audited statement show less income than the Credit column
    # printed on it.
    statement_dates = [t.date for t in normalized["transactions"]]
    statement_months_covered = months_covered_by_statement(statement_dates, reference_date)
    audit_months = int(requested_months) if requested_months is not None and requested_months >= 1 else 1
    audit_months = max(1, math.floor(audit_months))
    window = get_audit_window(statement_dates, audit_months, reference_date)

    # Nothing is trimmed, so no row is excluded from the totals: every credit and
    # every debit in the statement counts. Kept at zero for the data-quality
    # block, which still reports rows dropped for other reasons.
    excluded_undated = 0
    selected = list(normalized["transactions"])
    selected.sort(
        key=lambda t: (t.date or "", t.description, t.amount, t.type)
    )

    totals_by_type = {"credit": 0.0, "debit": 0.0}
    transactions: list[FinancialTransaction] = []
    excluded_invalid = normalized["excludedInvalidTransactions"]
    for transaction in selected:
        next_total = round_money(totals_by_type[transaction.type] + transaction.amount)
        if not math.isfinite(next_total) or next_total >= MAX_NUMERIC_15_2_EXCLUSIVE:
            excluded_invalid += 1
            continue
        totals_by_type[transaction.type] = next_total
        transactions.append(transaction)

    credits = [t for t in transactions if t.type == "credit"]
    debits = [t for t in transactions if t.type == "debit"]
    total_income = round_money(sum(t.amount for t in credits))
    total_expenses = round_money(sum(t.amount for t in debits))
    cash_flow = round_money(total_income - total_expenses)
    if total_income > 0:
        savings_rate = max(0.0, min(100.0, round_money((cash_flow / total_income) * 100)))
    else:
        savings_rate = 0.0
    leakages = [
        Leakage(description=t.description, amount=t.amount, category=t.category)
        for t in debits
        if LEAKAGE_DESCRIPTION.search(t.description)
    ]
    health_score = score_health(total_income, total_expenses, len(leakages))
    dated_transactions = [t for t in transactions if t.date]

    return FinancialAuditRulesResult(
        rulesVersion=FINANCIAL_AUDIT_RULES_VERSION,
        periodStart=window["periodStart"],
        periodEnd=window["periodEnd"],
        auditMonths=window["auditMonths"],
        statementMonthsCovered=statement_months_covered,
        totalIncome=total_income,
        totalExpenses=total_expenses,
        cashFlow=cash_flow,
        savingsRate=savings_rate,
        score=health_score,
        healthScore=health_score,
        healthStatus=status_from_score(health_score),
        recoverableAmount=0,
        recoverable=[],
        transactions=transactions,
        monthlyObservations=sum_monthly(dated_transactions),
        monthlyScores=score_monthly(dated_transactions),
        incomeSources=_sum_by(credits, lambda t: t.description, lambda t: t.amount)[:10],
        topSpendingCategories=_sum_by(debits, lambda t: t.category, lambda t: t.amount)[:10],
        leakages=leakages,
        dataQuality=DataQuality(
            excludedInvalidTransactions=excluded_invalid,
            duplicateRowsIgnored=normalized["duplicateRowsIgnored"],
            undatedTransactions=sum(1 for t in transactions if not t.date),
            excludedUndatedTransactions=excluded_undated,
        ),
    )
