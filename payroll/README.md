# pay_employee.py

Replaces the manual "check Jibble, check his email, do math, send Wise
transfer" workflow with one command. It:

1. Pulls tracked hours from Jibble for an arbitrary date range.
2. Computes what's owed at your hourly rate, carrying forward whatever
   balance was left over from the last run.
3. Appends a row to a CSV ledger (`ledger.csv` by default) so you always know
   who owes whom.
4. Optionally creates a Wise quote + transfer for the amount due.

**It never funds the Wise transfer.** Wise's personal API tokens can create
quotes, recipients and transfers, but funding a transfer requires
step-up/2FA authentication that a plain token can't complete. The script
gets everything ready and tells you to log in to Wise and confirm it
yourself.

## Setup

```bash
cd payroll
python3 -m venv .venv
source .venv/bin/activate   # on Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Fill in `.env`:

- **Jibble**: `JIBBLE_CLIENT_ID` / `JIBBLE_CLIENT_SECRET` come from
  Organization Settings > API Keys in Jibble (requires a plan with API
  access). `JIBBLE_PERSON_ID` identifies the employee -- see the note in
  `.env.example` for how to find it.
- **Wise**: `WISE_API_TOKEN` is a personal API token (Wise account > Connect
  and manage apps > API tokens). `WISE_PROFILE_ID` is your sending profile.
  `WISE_RECIPIENT_ID` is the employee's *already-saved* recipient/bank
  account ID in Wise -- this script does not create recipients, it only
  pays an existing one.
- **Pay rate**: `HOURLY_RATE`, `RATE_CURRENCY` (what the rate is denominated
  in), `PAYOUT_CURRENCY` (what he's actually paid in, e.g. `PHP`). If these
  differ, Wise's live quote handles the conversion.

## A note on accuracy before you trust it with real money

Wise's quote/transfer endpoints here are verified against Wise's current
public API reference (`docs.wise.com`). Jibble's `TrackedTimeReport`
response schema is **not** independently verified against a live account --
their docs site wasn't reachable to confirm the exact field names for
tracked duration. The script parses the response defensively (it looks for
one list of entries and a duration field per entry, and refuses to guess if
it can't find either), and prints how many entries it matched and the
resulting hours so you can sanity-check it.

**Before your first real payout**, run:

```bash
python pay_employee.py --jibble-raw --start 2026-01-01 --end 2026-01-07
```

This prints the raw JSON Jibble returns for that range. Compare the hours
the script computes against Jibble's own dashboard/export for the same
range. If the numbers don't match, the raw output will show the actual
field names -- adjust `CANDIDATE_LIST_KEYS` / `CANDIDATE_DURATION_KEYS` /
`extract_hours()` in `pay_employee.py` accordingly.

## Usage

Preview only (hits Jibble, computes the numbers, writes nothing):

```bash
python pay_employee.py --start 2026-06-01 --end 2026-06-14
```

Log the period to the ledger without touching Wise (e.g. you paid him some
other way this time):

```bash
python pay_employee.py --start 2026-06-01 --end 2026-06-14 --skip-wise
```

Log the period AND prep a Wise transfer:

```bash
python pay_employee.py --start 2026-06-01 --end 2026-06-14 --pay-now
```

Test the ledger math with no network calls at all:

```bash
python pay_employee.py --dry-run --hours 42.5
```

Pay a different amount than the full balance due (e.g. rounding, or you're
deliberately leaving a balance):

```bash
python pay_employee.py --start 2026-06-01 --end 2026-06-14 --pay-now --amount-paid 500
```

Override the hourly rate for one run, or point at a different ledger file:

```bash
python pay_employee.py --start 2026-06-01 --end 2026-06-14 --rate 6.5 --ledger ~/payroll/employee-a.csv
```

### Flags

| Flag | Purpose |
|---|---|
| `--start`, `--end` | Period to pull from Jibble (`YYYY-MM-DD`). Required unless `--dry-run --hours`. |
| `--pay-now` | Append to the ledger and create a Wise quote + transfer (prepped, not funded). |
| `--skip-wise` | Append to the ledger without calling Wise at all. |
| `--dry-run` | Compute and print only -- no API calls, no ledger write. Requires `--hours`. |
| `--hours` | Manually supply hours instead of calling Jibble. |
| `--amount-paid` | Actual amount being sent, if different from the full amount due. |
| `--rate` | Override `HOURLY_RATE` for this run. |
| `--ledger` | Override `LEDGER_PATH` for this run. |
| `--jibble-raw` | Print Jibble's raw response for `--start`/`--end` and exit (schema debugging). |

Neither `--pay-now` nor `--skip-wise` given: the script fetches real hours
and prints the computed row, but writes nothing -- a safe default for a real
run you haven't committed to yet.

## The ledger

`ledger.csv` (path configurable via `LEDGER_PATH` or `--ledger`) gets one
row per run that used `--pay-now` or `--skip-wise`:

`payment_date, period_start, period_end, hours, hourly_rate, rate_currency, amount_earned, prior_balance, amount_due, amount_paid, payout_currency, new_balance, wise_quote_id, wise_transfer_id, notes`

**Sign convention: a positive `new_balance` means you still owe him wages; a
negative balance means he owes you** (e.g. after an advance). Each run reads
the previous row's `new_balance` as this run's `prior_balance`, so the
running total always carries forward correctly regardless of how irregular
the pay periods are.

The ledger CSV is gitignored by default (`payroll/*.csv`) since it's
financial data about a real person -- if you want it version-controlled,
remove that line from the repo's `.gitignore`.

## Error handling

The script fails with a clear, non-zero-exit error message (not a stack
trace) for: missing `.env` variables, malformed or inverted date ranges,
negative hours/amounts, Jibble/Wise API/network failures (with the response
body included), and an unrecognized Jibble response shape. Nothing is
written to the ledger and no Wise calls are made unless the whole
computation succeeds first.
