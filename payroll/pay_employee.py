#!/usr/bin/env python3
"""Pay a remote employee from tracked Jibble hours, keeping a running ledger
and prepping (never funding) a Wise transfer.

See payroll/README.md for setup and usage.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv
import os

JIBBLE_TOKEN_URL = "https://identity.prod.jibble.io/connect/token"
JIBBLE_REPORT_URL = "https://time-attendance.prod.jibble.io/v1/TrackedTimeReport"

# Wise's production base is stable. The sandbox base is mid-migration
# (v1 -> v2) as of mid-2026 -- confirm the current URL at
# https://docs.wise.com/guides/developer/environments before testing against
# sandbox, and override it with WISE_API_BASE in .env if it's changed.
WISE_PRODUCTION_BASE = "https://api.wise.com"
WISE_SANDBOX_BASE = "https://api.sandbox.transferwise.tech"

LEDGER_FIELDS = [
    "payment_date",
    "period_start",
    "period_end",
    "hours",
    "hourly_rate",
    "rate_currency",
    "amount_earned",
    "prior_balance",
    "amount_due",
    "amount_paid",
    "payout_currency",
    "new_balance",
    "wise_quote_id",
    "wise_transfer_id",
    "notes",
]

# Balance sign convention: positive new_balance = you still owe him wages.
# Negative new_balance = he owes you (e.g. from an earlier advance).

CANDIDATE_LIST_KEYS = ("data", "entries", "report", "results", "groups", "items")
CANDIDATE_DURATION_KEYS = ("trackedTime", "totalTrackedTime", "duration", "totalDuration", "seconds")


class ConfigError(RuntimeError):
    """Missing or invalid configuration/arguments."""


class ApiError(RuntimeError):
    """An upstream API call failed or returned an unrecognized shape."""


@dataclass
class Config:
    jibble_client_id: str
    jibble_client_secret: str
    jibble_person_id: str
    wise_api_token: str
    wise_profile_id: str
    wise_recipient_id: str
    wise_base_url: str
    hourly_rate: Decimal
    rate_currency: str
    payout_currency: str
    ledger_path: Path


def load_config(rate_override: Optional[float], need_jibble: bool, need_wise: bool) -> Config:
    load_dotenv()

    def require(name: str) -> str:
        value = os.environ.get(name, "").strip()
        if not value:
            raise ConfigError(f"Missing required environment variable: {name} (see payroll/.env.example)")
        return value

    rate_str = str(rate_override) if rate_override is not None else os.environ.get("HOURLY_RATE", "")
    try:
        hourly_rate = Decimal(rate_str)
    except (InvalidOperation, ValueError) as exc:
        raise ConfigError(f"HOURLY_RATE must be a number, got: {rate_str!r}") from exc
    if hourly_rate <= 0:
        raise ConfigError(f"HOURLY_RATE must be positive, got: {hourly_rate}")

    wise_env = os.environ.get("WISE_ENV", "production").strip().lower()
    if wise_env not in ("production", "sandbox"):
        raise ConfigError(f"WISE_ENV must be 'production' or 'sandbox', got: {wise_env!r}")
    wise_base_url = os.environ.get("WISE_API_BASE", "").strip() or (
        WISE_PRODUCTION_BASE if wise_env == "production" else WISE_SANDBOX_BASE
    )

    jibble_client_id = jibble_client_secret = jibble_person_id = ""
    if need_jibble:
        jibble_client_id = require("JIBBLE_CLIENT_ID")
        jibble_client_secret = require("JIBBLE_CLIENT_SECRET")
        jibble_person_id = require("JIBBLE_PERSON_ID")

    wise_api_token = wise_profile_id = wise_recipient_id = ""
    if need_wise:
        wise_api_token = require("WISE_API_TOKEN")
        wise_profile_id = require("WISE_PROFILE_ID")
        wise_recipient_id = require("WISE_RECIPIENT_ID")

    return Config(
        jibble_client_id=jibble_client_id,
        jibble_client_secret=jibble_client_secret,
        jibble_person_id=jibble_person_id,
        wise_api_token=wise_api_token,
        wise_profile_id=wise_profile_id,
        wise_recipient_id=wise_recipient_id,
        wise_base_url=wise_base_url,
        hourly_rate=hourly_rate,
        rate_currency=os.environ.get("RATE_CURRENCY", "USD").strip().upper(),
        payout_currency=os.environ.get("PAYOUT_CURRENCY", "PHP").strip().upper(),
        ledger_path=Path(os.environ.get("LEDGER_PATH", "ledger.csv")),
    )


# --------------------------------------------------------------------------
# Jibble
# --------------------------------------------------------------------------

def get_jibble_access_token(cfg: Config) -> str:
    try:
        resp = requests.post(
            JIBBLE_TOKEN_URL,
            data={
                "client_id": cfg.jibble_client_id,
                "client_secret": cfg.jibble_client_secret,
                "grant_type": "client_credentials",
            },
            timeout=30,
        )
    except requests.RequestException as exc:
        raise ApiError(f"Could not reach Jibble auth endpoint: {exc}") from exc
    if resp.status_code != 200:
        raise ApiError(f"Jibble authentication failed ({resp.status_code}): {resp.text[:500]}")
    try:
        token = resp.json().get("access_token")
    except ValueError as exc:
        raise ApiError(f"Jibble auth returned non-JSON response: {resp.text[:500]}") from exc
    if not token:
        raise ApiError(f"Jibble auth response had no access_token: {resp.text[:500]}")
    return token


def _fetch_jibble_report(cfg: Config, start: date, end: date) -> requests.Response:
    token = get_jibble_access_token(cfg)
    body = {
        "from": f"{start.isoformat()}T00:00:00.000Z",
        "to": f"{end.isoformat()}T23:59:59.999Z",
        "personIds": [cfg.jibble_person_id],
        "groupBy": ["person"],
        "subGroupBy": ["date"],
    }
    try:
        return requests.post(
            JIBBLE_REPORT_URL,
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
    except requests.RequestException as exc:
        raise ApiError(f"Could not reach Jibble TrackedTimeReport: {exc}") from exc


def dump_jibble_raw(cfg: Config, start: date, end: date) -> None:
    resp = _fetch_jibble_report(cfg, start, end)
    print(f"HTTP {resp.status_code}")
    print(resp.text)


def _find_entry_list(payload) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in CANDIDATE_LIST_KEYS:
            value = payload.get(key)
            if isinstance(value, list) and value:
                return value
    return []


def _coerce_seconds(value) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        if ":" in value:
            parts = value.split(":")
            try:
                numeric_parts = [float(p) for p in parts]
            except ValueError:
                return None
            while len(numeric_parts) < 3:
                numeric_parts.insert(0, 0.0)
            h, m, s = numeric_parts[-3:]
            return h * 3600 + m * 60 + s
        if value.startswith("PT"):
            match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", value)
            if match:
                h, m, s = (float(g) if g else 0.0 for g in match.groups())
                return h * 3600 + m * 60 + s
    return None


def _extract_duration_seconds(entry: dict) -> Optional[float]:
    for key in CANDIDATE_DURATION_KEYS:
        if key in entry:
            seconds = _coerce_seconds(entry[key])
            if seconds is not None:
                return seconds
    return None


def extract_hours(payload) -> tuple[Decimal, int]:
    """Best-effort extraction of total tracked hours from a Jibble report payload.

    Jibble's exact TrackedTimeReport response shape isn't confirmed against a
    live account, so this looks for one flat list of entries and sums a single
    duration field per entry (never both a nested total and its children, to
    avoid double-counting). If the shape doesn't match, it fails loudly with
    the raw payload instead of guessing. Verify with --jibble-raw before
    trusting this for a real payout.
    """
    entries = _find_entry_list(payload)
    if not entries:
        raise ApiError(
            "Could not find a list of report entries in the Jibble response "
            f"(looked for keys: {', '.join(CANDIDATE_LIST_KEYS)}). "
            "Run with --jibble-raw to see the actual shape and adjust "
            "CANDIDATE_LIST_KEYS / extract_hours() to match.\n"
            f"Raw response: {json.dumps(payload)[:2000]}"
        )
    total_seconds = 0.0
    matched = 0
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        seconds = _extract_duration_seconds(entry)
        if seconds is not None:
            total_seconds += seconds
            matched += 1
    if matched == 0:
        raise ApiError(
            "Found report entries but none had a recognizable duration field "
            f"(looked for: {', '.join(CANDIDATE_DURATION_KEYS)}). "
            "Run with --jibble-raw to see the actual shape and adjust "
            "CANDIDATE_DURATION_KEYS / extract_hours() to match.\n"
            f"Raw response: {json.dumps(payload)[:2000]}"
        )
    hours = (Decimal(str(total_seconds)) / Decimal(3600)).quantize(Decimal("0.01"))
    return hours, matched


def get_jibble_hours(cfg: Config, start: date, end: date) -> Decimal:
    resp = _fetch_jibble_report(cfg, start, end)
    if resp.status_code != 200:
        raise ApiError(f"Jibble TrackedTimeReport failed ({resp.status_code}): {resp.text[:500]}")
    try:
        payload = resp.json()
    except ValueError as exc:
        raise ApiError(f"Jibble returned non-JSON response: {resp.text[:500]}") from exc

    hours, matched = extract_hours(payload)
    print(
        f"Jibble: matched {matched} report entr{'y' if matched == 1 else 'ies'} "
        f"totaling {hours} hours for {start} to {end}.",
        file=sys.stderr,
    )
    print(
        "  (Response schema wasn't verified against a live Jibble account -- "
        "cross-check this number once with the Jibble dashboard before trusting "
        "it for a real payout. Use --jibble-raw to inspect the raw response.)",
        file=sys.stderr,
    )
    return hours


# --------------------------------------------------------------------------
# Wise
# --------------------------------------------------------------------------

def _wise_headers(cfg: Config) -> dict:
    return {
        "Authorization": f"Bearer {cfg.wise_api_token}",
        "Content-Type": "application/json",
    }


def create_wise_quote(cfg: Config, source_amount: Decimal) -> dict:
    url = f"{cfg.wise_base_url}/v3/profiles/{cfg.wise_profile_id}/quotes"
    body = {
        "sourceCurrency": cfg.rate_currency,
        "targetCurrency": cfg.payout_currency,
        "targetAccount": int(cfg.wise_recipient_id),
        "sourceAmount": float(source_amount),
    }
    try:
        resp = requests.post(url, json=body, headers=_wise_headers(cfg), timeout=30)
    except requests.RequestException as exc:
        raise ApiError(f"Could not reach Wise quotes endpoint: {exc}") from exc
    if resp.status_code not in (200, 201):
        raise ApiError(f"Wise quote creation failed ({resp.status_code}): {resp.text[:500]}")
    return resp.json()


def create_wise_transfer(cfg: Config, quote_id: str, reference: str) -> dict:
    url = f"{cfg.wise_base_url}/v1/transfers"
    body = {
        "targetAccount": int(cfg.wise_recipient_id),
        "quoteUuid": quote_id,
        "customerTransactionId": str(uuid.uuid4()),
        "details": {"reference": reference[:100]},
    }
    try:
        resp = requests.post(url, json=body, headers=_wise_headers(cfg), timeout=30)
    except requests.RequestException as exc:
        raise ApiError(f"Could not reach Wise transfers endpoint: {exc}") from exc
    if resp.status_code not in (200, 201):
        raise ApiError(f"Wise transfer creation failed ({resp.status_code}): {resp.text[:500]}")
    return resp.json()


# --------------------------------------------------------------------------
# Ledger
# --------------------------------------------------------------------------

def read_last_balance(ledger_path: Path) -> Decimal:
    if not ledger_path.exists():
        return Decimal("0")
    with ledger_path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return Decimal("0")
    last = rows[-1]
    try:
        return Decimal(last["new_balance"])
    except (KeyError, TypeError, InvalidOperation) as exc:
        raise ApiError(
            f"{ledger_path} exists but its last row has no valid 'new_balance' value; "
            "fix or remove the bad row before continuing."
        ) from exc


def append_ledger_row(ledger_path: Path, row: dict) -> None:
    is_new = not ledger_path.exists()
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    with ledger_path.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=LEDGER_FIELDS)
        if is_new:
            writer.writeheader()
        writer.writerow(row)


def compute_period(
    cfg: Config,
    start: date,
    end: date,
    hours: Decimal,
    prior_balance: Decimal,
    amount_paid_override: Optional[Decimal],
) -> dict:
    amount_earned = (hours * cfg.hourly_rate).quantize(Decimal("0.01"))
    amount_due = amount_earned + prior_balance
    amount_paid = amount_paid_override if amount_paid_override is not None else amount_due
    new_balance = amount_due - amount_paid
    return {
        "payment_date": date.today().isoformat(),
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "hours": str(hours),
        "hourly_rate": str(cfg.hourly_rate),
        "rate_currency": cfg.rate_currency,
        "amount_earned": str(amount_earned),
        "prior_balance": str(prior_balance),
        "amount_due": str(amount_due),
        "amount_paid": str(amount_paid),
        "payout_currency": cfg.payout_currency,
        "new_balance": str(new_balance),
        "wise_quote_id": "",
        "wise_transfer_id": "",
        "notes": "",
    }


def print_row(row: dict) -> None:
    print("\n--- Pay period summary ---")
    print(f"  Period:          {row['period_start']} to {row['period_end']}")
    print(f"  Hours:           {row['hours']}")
    print(f"  Hourly rate:     {row['hourly_rate']} {row['rate_currency']}")
    print(f"  Amount earned:   {row['amount_earned']} {row['rate_currency']}")
    print(f"  Prior balance:   {row['prior_balance']} {row['rate_currency']}  (positive = you owe him)")
    print(f"  Amount due:      {row['amount_due']} {row['rate_currency']}")
    print(f"  Amount paying:   {row['amount_paid']} {row['rate_currency']}")
    print(f"  New balance:     {row['new_balance']} {row['rate_currency']}  (positive = you owe him)")


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def parse_date(value: str, label: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ConfigError(f"{label} must be in YYYY-MM-DD format, got: {value!r}") from exc


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Pay a remote employee based on tracked Jibble hours, keeping a running "
            "ledger and prepping (never funding) a Wise transfer."
        )
    )
    parser.add_argument("--start", help="Period start date, YYYY-MM-DD")
    parser.add_argument("--end", help="Period end date, YYYY-MM-DD")
    parser.add_argument("--rate", type=float, help="Override HOURLY_RATE from .env for this run")
    parser.add_argument(
        "--amount-paid",
        type=float,
        help="Actual amount being paid this run, if different from the full amount due",
    )
    parser.add_argument(
        "--hours",
        type=float,
        help="Manually specify hours instead of calling Jibble (required with --dry-run)",
    )
    parser.add_argument(
        "--pay-now",
        action="store_true",
        help="Append to the ledger AND create a Wise quote + transfer (prepped only, not funded)",
    )
    parser.add_argument(
        "--skip-wise",
        action="store_true",
        help="Append to the ledger but do not call the Wise API",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the computed ledger row only. No API calls, no ledger write. Requires --hours.",
    )
    parser.add_argument(
        "--jibble-raw",
        action="store_true",
        help="Print the raw Jibble TrackedTimeReport response for --start/--end and exit",
    )
    parser.add_argument("--ledger", help="Path to the ledger CSV (overrides LEDGER_PATH)")
    return parser


def main(argv: Optional[list] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    try:
        if args.pay_now and args.skip_wise:
            raise ConfigError("--pay-now and --skip-wise are mutually exclusive.")

        if args.dry_run and args.hours is None:
            raise ConfigError("--dry-run requires --hours (no API calls are made in dry-run mode).")

        if args.hours is not None and args.hours < 0:
            raise ConfigError(f"--hours cannot be negative, got: {args.hours}")

        if args.amount_paid is not None and args.amount_paid < 0:
            raise ConfigError(f"--amount-paid cannot be negative, got: {args.amount_paid}")

        start = end = None
        if args.start or args.end:
            if not args.start or not args.end:
                raise ConfigError("--start and --end must both be given together.")
            start = parse_date(args.start, "--start")
            end = parse_date(args.end, "--end")
            if end < start:
                raise ConfigError(f"--end ({end}) is before --start ({start}).")

        if args.jibble_raw:
            if start is None or end is None:
                raise ConfigError("--jibble-raw requires --start and --end.")
            cfg = load_config(args.rate, need_jibble=True, need_wise=False)
            dump_jibble_raw(cfg, start, end)
            return 0

        if not args.dry_run and args.hours is None and (start is None or end is None):
            raise ConfigError("--start and --end are required unless using --dry-run --hours.")

        need_jibble = args.hours is None and not args.dry_run
        need_wise = args.pay_now
        cfg = load_config(args.rate, need_jibble=need_jibble, need_wise=need_wise)
        if args.ledger:
            cfg.ledger_path = Path(args.ledger)

        if start is None:
            start = end = date.today()

        prior_balance = read_last_balance(cfg.ledger_path) if not args.dry_run else Decimal("0")

        if args.hours is not None:
            hours = Decimal(str(args.hours))
        else:
            hours = get_jibble_hours(cfg, start, end)

        amount_paid_override = Decimal(str(args.amount_paid)) if args.amount_paid is not None else None
        row = compute_period(cfg, start, end, hours, prior_balance, amount_paid_override)
        print_row(row)

        if args.dry_run:
            print("\n[dry run] Nothing was written to the ledger and no API calls were made.")
            return 0

        if not args.pay_now and not args.skip_wise:
            print(
                "\nPreview only -- nothing was written. Re-run with --pay-now "
                "(ledger + Wise) or --skip-wise (ledger only) to commit this."
            )
            return 0

        if args.pay_now:
            source_amount = Decimal(row["amount_paid"])
            if source_amount <= 0:
                raise ConfigError(
                    f"Amount to pay must be positive to create a Wise transfer, got: {source_amount}"
                )
            quote = create_wise_quote(cfg, source_amount)
            quote_id = quote.get("id")
            if not quote_id:
                raise ApiError(f"Wise quote response had no 'id': {json.dumps(quote)[:500]}")
            transfer = create_wise_transfer(cfg, str(quote_id), reference=f"{start} to {end}")
            transfer_id = transfer.get("id")
            row["wise_quote_id"] = str(quote_id)
            row["wise_transfer_id"] = str(transfer_id or "")
            row["notes"] = "Wise transfer prepped; log in to Wise to review and confirm/fund it manually."
            print(f"\nWise quote {quote_id} and transfer {transfer_id} created.")
            print(
                "This has NOT been funded. Log in to wise.com (or the Wise app), find "
                "this transfer, and confirm/fund it manually -- funding requires "
                "step-up authentication that a plain API token cannot complete."
            )

        append_ledger_row(cfg.ledger_path, row)
        print(f"\nLedger updated: {cfg.ledger_path}")
        return 0

    except (ConfigError, ApiError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
