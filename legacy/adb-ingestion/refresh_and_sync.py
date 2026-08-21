import argparse
import csv
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from newinmeter_web import dedupe_rows, fetch_ledger_rows, write_csv

# Resolved from this file's location, not the process cwd -- see the same
# comment in capture_livemopay.py. Keeps `npm run refresh:emulator` (cwd =
# repo root), `python3 legacy/adb-ingestion/refresh_and_sync.py` (cwd = repo
# root), and running this script directly from inside legacy/adb-ingestion
# all resolve the same .env.local and the same default data files.
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_DATA_DIR = SCRIPT_DIR / "data"

CAPTURE_SCRIPT = SCRIPT_DIR / "capture_livemopay.py"
FIELDNAMES = [
    "capture_dt",
    "source_ts",
    "charge_label",
    "period_dt",
    "kwh",
    "water_kl",
    "tariff",
    "cost",
    "balance",
]
REQUIRED_FIELDNAMES = [field for field in FIELDNAMES if field not in {"source_ts", "water_kl"}]
BATCH_SIZE = 500


def read_dotenv(path: Path):
    if not path.exists():
        return

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


read_dotenv(REPO_ROOT / ".env.local")
CSV_PATH = Path(os.environ.get("NEWINMETER_CSV_PATH") or (DEFAULT_DATA_DIR / "livemopay_energy.csv"))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_numeric_string(value, scale):
    trimmed = str(value or "").strip()
    if not trimmed:
        return f"{0:.{scale}f}"

    try:
        numeric = float(trimmed)
    except ValueError:
        return trimmed

    return f"{numeric:.{scale}f}"


def ledger_key(row):
    return (
        row["charge_label"].strip(),
        row["period_dt"].strip(),
        normalize_numeric_string(row["cost"], 2),
        normalize_numeric_string(row["balance"], 2),
    )


def supabase_config():
    read_dotenv(REPO_ROOT / ".env.local")

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise SystemExit(
            "Missing Supabase sync credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell or .env.local."
        )

    return url.rstrip("/") + "/rest/v1", key


def request_json(method, path, body=None, prefer=None):
    rest_url, key = supabase_config()
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    if prefer:
        headers["Prefer"] = prefer

    request = urllib.request.Request(
        rest_url + path,
        data=data,
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(request) as response:
            content = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {method} {path} failed with {error.code}: {detail}") from error

    return json.loads(content) if content else None


class LegacyTargetError(SystemExit):
    """Raised (as a SystemExit subclass) whenever the configured legacy demo
    target can't be resolved to exactly one non-demo LiveMopay connection.
    Always fails loudly and exits before any capture or write happens --
    this script must never guess whose data it's writing."""


def resolve_target_connection():
    """Resolves NEWINMETER_LEGACY_TARGET_USER_ID to exactly one
    livemopay_connections row and returns its id. This is the only thing
    that scopes every write in this script to one account -- there is no
    fallback, no "most recent connection", no first-row default. If the
    lookup doesn't resolve to exactly one row, or that row is the demo
    account, this refuses to run.
    """
    user_id = os.environ.get("NEWINMETER_LEGACY_TARGET_USER_ID")
    if not user_id:
        raise LegacyTargetError(
            "LEGACY_TARGET_MISSING: set NEWINMETER_LEGACY_TARGET_USER_ID in .env.local to your "
            "Supabase Auth user id (Supabase dashboard -> Authentication -> Users). This legacy "
            "ADB ingestion path refuses to guess which account owns the data it writes."
        )

    rows = request_json(
        "GET",
        "/livemopay_connections?select=id,user_id,livemopay_email,status,is_demo"
        f"&user_id=eq.{urllib.parse.quote(user_id, safe='')}",
    )

    if not rows:
        raise LegacyTargetError(
            f"LEGACY_TARGET_NOT_FOUND: no livemopay_connections row exists for user_id={user_id}. "
            "Sign in once and visit /connect (even without finishing a real LiveMopay connection -- "
            "the row just needs to exist) before running this."
        )

    if len(rows) > 1:
        ids = ", ".join(f"{row['id']} ({row['status']})" for row in rows)
        raise LegacyTargetError(
            f"LEGACY_TARGET_AMBIGUOUS: {len(rows)} connections exist for user_id={user_id}: {ids}. "
            "Refusing to guess which one to write into."
        )

    connection = rows[0]

    if connection["is_demo"]:
        raise LegacyTargetError(
            "LEGACY_TARGET_IS_DEMO: the resolved connection is the demo/recruiter account. "
            "This script refuses to write legacy ADB capture data into it."
        )

    expected_email = os.environ.get("NEWINMETER_LEGACY_TARGET_LIVEMOPAY_EMAIL")
    if expected_email and connection["livemopay_email"] != expected_email:
        # Real scenario this catches: two different Supabase accounts can be
        # connected with the *same* LiveMopay login (one person signing up
        # twice, or two people sharing a LiveMopay account). user_id alone
        # already disambiguates the connection row, but this is a cheap,
        # explicit second check against a copy/pasted wrong user id.
        raise LegacyTargetError(
            f"LEGACY_TARGET_EMAIL_MISMATCH: connection {connection['id']} has livemopay_email="
            f"{connection['livemopay_email']!r}, expected {expected_email!r} "
            "(NEWINMETER_LEGACY_TARGET_LIVEMOPAY_EMAIL). Refusing to write."
        )

    return connection["id"]


def start_capture_run(connection_id, mode):
    response = request_json(
        "POST",
        "/capture_runs",
        [{"connection_id": connection_id, "mode": mode, "status": "running"}],
        prefer="return=representation",
    )
    return response[0]["id"]


def finish_capture_run(run_id, status, rows_synced=None, error=None):
    # Routed through the finish_capture_run RPC -- not a plain PATCH -- so
    # this matches the current production sync path exactly (see
    # src/lib/newinmeter-sync.ts finishCaptureRun and
    # supabase/migrations/20260726030000_livenopay_finish_capture_run_rpc.sql).
    # The RPC raises statement_timeout to 5min for itself before the UPDATE
    # that fires the rollup-refresh trigger, which a plain PATCH would not.
    request_json(
        "POST",
        "/rpc/finish_capture_run",
        {
            "p_run_id": run_id,
            "p_status": status,
            "p_rows_synced": rows_synced,
            "p_error": error,
        },
        prefer="return=minimal",
    )


def run_capture(full):
    command = ["python3", str(CAPTURE_SCRIPT)]
    if full:
        command.append("--full")

    print("Running local LiveMopay capture...", flush=True)
    subprocess.run(command, check=True)


def latest_csv_start_date():
    if not CSV_PATH.exists():
        return None

    latest_period = None
    with CSV_PATH.open(newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            value = row.get("period_dt")
            if not value:
                continue
            if latest_period is None or value > latest_period:
                latest_period = value

    if latest_period is None:
        return None

    return latest_period.split(" ", 1)[0]


def latest_synced_period_date(connection_id):
    """The latest period_dt Supabase already has for this connection, date-only.
    Supabase is the source of truth for "already known" -- the local CSV is
    just a cache and can be stale (e.g. the web-API path or the in-app sync
    kept the connection current while this machine's last ADB capture was
    weeks ago)."""
    rows = request_json(
        "GET",
        f"/energy_rows?connection_id=eq.{urllib.parse.quote(connection_id, safe='')}"
        "&select=period_dt&order=period_dt.desc&limit=1",
    )
    if not rows:
        return None

    return rows[0]["period_dt"].split(" ", 1)[0]


def fetch_synced_rows(connection_id):
    """Every row Supabase already has for this connection, in the local
    CSV's row shape. Paginated -- a long-lived connection can have tens of
    thousands of rows."""
    select = "capture_dt,source_ts,charge_label,period_dt,kwh,water_kl,tariff,cost,balance"
    page_size = 1000
    offset = 0
    rows = []

    while True:
        page = request_json(
            "GET",
            f"/energy_rows?connection_id=eq.{urllib.parse.quote(connection_id, safe='')}"
            f"&select={select}&order=id.asc&limit={page_size}&offset={offset}",
        )
        if not page:
            break

        for row in page:
            rows.append(
                {
                    "capture_dt": row["capture_dt"],
                    "source_ts": row.get("source_ts") or "",
                    "charge_label": row["charge_label"],
                    "period_dt": row["period_dt"],
                    "kwh": str(row.get("kwh", 0)),
                    "water_kl": str(row.get("water_kl", 0)),
                    "tariff": str(row.get("tariff", 0)),
                    "cost": str(row.get("cost", 0)),
                    "balance": str(row.get("balance", 0)),
                }
            )

        if len(page) < page_size:
            break

        offset += page_size

    return rows


def merge_rows_by_ledger_key(*row_lists):
    seen = set()
    merged = []

    for rows in row_lists:
        for row in rows:
            key = ledger_key(row)
            if key in seen:
                continue

            seen.add(key)
            merged.append(row)

    return merged


def seed_csv_from_supabase(connection_id):
    """Merges rows Supabase already has for this connection into the local
    CSV before an incremental ADB capture runs, so capture_livemopay.py's
    own dedup (which only reads the local CSV -- it has no Supabase access)
    recognizes them as already-seen and stops scrolling once it reaches
    them, instead of re-walking however much history the local CSV cache
    happens to be behind by."""
    print("Checking Supabase for rows already synced to this connection...", flush=True)
    synced = fetch_synced_rows(connection_id)
    if not synced:
        return

    local = read_csv_rows() if CSV_PATH.exists() else []
    merged = merge_rows_by_ledger_key(local, synced)

    if len(merged) == len(local):
        print(f"Local CSV already has all {len(local)} rows Supabase knows about.", flush=True)
        return

    write_csv(merged, CSV_PATH)
    print(
        f"Seeded local CSV with {len(merged) - len(local)} row(s) already in Supabase "
        f"({len(merged)} total) so capture won't re-walk them.",
        flush=True,
    )


def run_web_capture(connection_id, full):
    start_date = os.environ.get("NEWINMETER_WEB_START_DATE")
    if not start_date:
        if full:
            start_date = "2000-01-01"
        else:
            # The later of what the local CSV cache has and what Supabase
            # already has -- the local CSV can be behind (see
            # seed_csv_from_supabase), and re-fetching a range Supabase
            # already covers is wasted work even though, unlike the ADB
            # scroll, it can't hang.
            start_date = max(
                filter(None, [latest_csv_start_date(), latest_synced_period_date(connection_id)]),
                default=datetime.now().strftime("%Y-01-01"),
            )

    print(f"Fetching LiveMopay ledger from web API since {start_date}...", flush=True)
    fetched_rows = fetch_ledger_rows(start_date)
    if full or not CSV_PATH.exists():
        rows = fetched_rows
    else:
        cutoff = f"{start_date} 00:00"
        retained_rows = [row for row in read_csv_rows() if row["period_dt"] < cutoff]
        rows = dedupe_rows(retained_rows + fetched_rows)
    write_csv(rows, CSV_PATH)
    print(f"Wrote {len(rows)} rows to {CSV_PATH}", flush=True)


def read_csv_rows():
    if not CSV_PATH.exists():
        raise RuntimeError(f"{CSV_PATH} does not exist. Run capture before syncing.")

    rows = []
    seen = set()

    with CSV_PATH.open(newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if not all(row.get(field) is not None and row.get(field) != "" for field in REQUIRED_FIELDNAMES):
                continue

            clean = {field: row.get(field, "") for field in FIELDNAMES}
            clean["water_kl"] = clean.get("water_kl") or "0"
            key = ledger_key(clean)
            if key in seen:
                continue

            seen.add(key)
            rows.append(clean)

    return rows


def upsert_rows(connection_id, rows, run_id):
    synced_at = now_iso()
    total = 0
    # Matches the unique index created in
    # supabase/migrations/20260725020000_livenopay_enforce_ownership.sql --
    # connection_id must lead the on_conflict target now that the natural
    # key is per-connection, not global.
    on_conflict = urllib.parse.quote("connection_id,charge_label,period_dt,cost,balance", safe=",")

    for index in range(0, len(rows), BATCH_SIZE):
        batch_seen = set()
        batch = []
        for row in rows[index : index + BATCH_SIZE]:
            key = ledger_key(row)
            if key in batch_seen:
                continue

            batch_seen.add(key)
            source_ts = row.get("source_ts", "").strip()
            batch.append(
                {
                    "connection_id": connection_id,
                    **{field: row[field] for field in REQUIRED_FIELDNAMES},
                    "water_kl": row.get("water_kl", "0") or "0",
                    "source_ts": source_ts or None,
                    "sync_run_id": run_id,
                    "last_seen_at": synced_at,
                }
            )

        request_json(
            "POST",
            f"/energy_rows?on_conflict={on_conflict}",
            batch,
            prefer="resolution=merge-duplicates,return=minimal",
        )
        total += len(batch)
        print(f"Synced {total}/{len(rows)} rows", flush=True)

    return total


def main():
    parser = argparse.ArgumentParser(
        description=(
            "LEGACY / DEMO ONLY: run the original ADB (or web-API) LiveMopay capture and sync it "
            "into the current connection-scoped NewinMeter schema, for a single explicitly "
            "configured account. See legacy/adb-ingestion/README.md."
        )
    )
    parser.add_argument("--skip-capture", action="store_true", help="Sync the existing CSV without touching Android/ADB.")
    parser.add_argument("--full", action="store_true", help="Pass --full to capture_livemopay.py before syncing.")
    parser.add_argument("--source", choices=("adb", "web"), default="adb", help="Choose the ledger ingestion source.")
    args = parser.parse_args()

    connection_id = resolve_target_connection()
    print(f"Target connection: {connection_id}", flush=True)

    mode = f"{args.source}-full" if args.full else args.source
    if args.skip_capture:
        mode = "csv-only"

    run_id = start_capture_run(connection_id, mode)

    try:
        if not args.skip_capture:
            if args.source == "web":
                run_web_capture(connection_id, args.full)
            else:
                if not args.full:
                    # Without this, an incremental capture dedupes purely
                    # against the local CSV cache and has no idea Supabase
                    # might already be current via a different path (web
                    # sync, an in-app sync) -- it'll scroll through however
                    # much history the cache is behind by before it ever
                    # sees a stagnant round. --full intentionally skips this
                    # and rebuilds from scratch regardless.
                    seed_csv_from_supabase(connection_id)
                run_capture(args.full)

        rows = read_csv_rows()
        synced = upsert_rows(connection_id, rows, run_id)
        finish_capture_run(run_id, "success", rows_synced=synced)
        print(f"Done. Synced {synced} rows from {CSV_PATH} to Supabase connection {connection_id}.", flush=True)
    except BaseException as error:
        # BaseException, not Exception: capture_runs_one_running_per_connection
        # is a partial unique index on (connection_id) WHERE status='running',
        # so a run that's interrupted (Ctrl+C -> KeyboardInterrupt, which
        # `except Exception` does NOT catch, since it subclasses BaseException
        # directly) and never gets marked 'failed' here permanently blocks
        # every future run for this connection with a 409 until someone
        # manually closes it out.
        try:
            finish_capture_run(run_id, "failed", error=str(error))
        except Exception as cleanup_error:
            print(f"Also failed to mark capture run {run_id} as failed: {cleanup_error}", file=sys.stderr, flush=True)
        print(f"Sync failed: {error}", file=sys.stderr, flush=True)
        raise


if __name__ == "__main__":
    main()
