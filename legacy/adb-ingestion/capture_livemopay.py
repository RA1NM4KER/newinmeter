import argparse
import csv
import os
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path


def read_dotenv(path: Path):
    if not path.exists():
        return

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


# Resolved from this file's location, not the process cwd, so this still
# finds .env.local and the default data dir whether it's invoked via
# `npm run refresh:emulator` from the repo root, `python3
# legacy/adb-ingestion/capture_livemopay.py`, or `cd`'d directly into
# legacy/adb-ingestion (the old livenopay-repo muscle memory).
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_DATA_DIR = SCRIPT_DIR / "data"

read_dotenv(REPO_ROOT / ".env.local")


def env_path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value) if value else default


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default

    try:
        return int(value)
    except ValueError:
        raise SystemExit(f"INVALID_ENV: {name} must be an integer, got {value!r}")


def env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None:
        return default

    try:
        return float(value)
    except ValueError:
        raise SystemExit(f"INVALID_ENV: {name} must be a number, got {value!r}")


ANDROID_STUDIO_ADB = Path.home() / "Library/Android/sdk/platform-tools/adb"
OUT_DIR = env_path("NEWINMETER_DUMPS_DIR", DEFAULT_DATA_DIR / "livemopay_dumps")
OUT_DIR.mkdir(parents=True, exist_ok=True)
CSV_PATH = env_path("NEWINMETER_CSV_PATH", DEFAULT_DATA_DIR / "livemopay_energy.csv")
LOG_PATH = env_path("NEWINMETER_CAPTURE_LOG", DEFAULT_DATA_DIR / "livemopay_capture.log")
CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
REMOTE_DUMP_PATH = os.environ.get("NEWINMETER_REMOTE_DUMP_PATH", "/sdcard/view.xml")
MAX_ITERATIONS = env_int("NEWINMETER_MAX_ITERATIONS", 500)
MAX_STAGNANT_ROUNDS = env_int("NEWINMETER_MAX_STAGNANT_ROUNDS", 4)
SCREEN_WAIT_ATTEMPTS = env_int("NEWINMETER_SCREEN_WAIT_ATTEMPTS", 15)
SCREEN_WAIT_SECONDS = env_float("NEWINMETER_SCREEN_WAIT_SECONDS", 2.0)
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
MONEY_RE = r'-?[\d,]+(?:\.\d+)?'
BOUNDS_RE = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")

ENERGY_ROW_RE = re.compile(
    r'^(?P<capture_dt>\d{2}/\d{2}/\d{4} \d{2}:\d{2})\n'
    r'(?P<charge_label>.+?) \((?P<period_dt>\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)\n'
    rf'(?P<kwh>{MONEY_RE}) kWh @ R(?P<tariff>{MONEY_RE}) \(VAT Incl\)\n'
    rf'R(?P<cost>{MONEY_RE})\n'
    rf'R(?P<balance>{MONEY_RE})$'
)

WATER_ROW_RE = re.compile(
    r'^(?P<capture_dt>\d{2}/\d{2}/\d{4} \d{2}:\d{2})\n'
    r'(?P<charge_label>Water:.+?) \((?P<period_dt>\d{4}-\d{2}-\d{2} \d{2}:\d{2}) to \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)\n'
    rf'(?P<water_kl>{MONEY_RE}) kL @ R(?P<tariff>{MONEY_RE}) \(VAT Incl\)\n'
    rf'R(?P<cost>{MONEY_RE})\n'
    rf'R(?P<balance>{MONEY_RE})$'
)

FIXED_ROW_RE = re.compile(
    r'^(?P<capture_dt>\d{2}/\d{2}/\d{4} \d{2}:\d{2})\n'
    r'(?P<charge_label>Daily .+?) - (?P<period_date>\d{4}-\d{2}-\d{2})\n'
    rf'(?P<quantity>{MONEY_RE})\s+@ R(?P<tariff>{MONEY_RE}) \(VAT Incl\)\n'
    rf'R(?P<cost>{MONEY_RE})\n'
    rf'R(?P<balance>{MONEY_RE})$'
)

TOPUP_ROW_RE = re.compile(
    r'^(?P<capture_dt>\d{2}/\d{2}/\d{4} \d{2}:\d{2})\n'
    rf'Subtotal-R(?P<subtotal>{MONEY_RE})\n'
    rf'VAT-R(?P<vat>{MONEY_RE})\n'
    rf'Total-R(?P<total>{MONEY_RE})\n'
    rf'R(?P<amount>{MONEY_RE})\n'
    rf'R(?P<balance>{MONEY_RE})$'
)

seen_keys = set()
rows = []
adb_path = None
adb_serial = None

SETUP_MESSAGE = (
    "SETUP_REQUIRED: Open LiveMopay, go to the Ledger tab, tap the orange Ledger button, "
    "then scroll to the newest entries at the top before refreshing capture."
)

def row_key(item):
    return (item["charge_label"], item["period_dt"], item["cost"], item["balance"])


def log(message):
    line = f"CAPTURE_LOG: {message}"
    print(line, flush=True)
    with LOG_PATH.open("a") as f:
        f.write(f"{datetime.now().isoformat(timespec='seconds')} {message}\n")


def resolve_adb():
    global adb_path

    if adb_path:
        return adb_path

    candidates = [
        os.environ.get("ADB_PATH"),
        shutil.which("adb"),
        str(ANDROID_STUDIO_ADB) if ANDROID_STUDIO_ADB.exists() else None,
    ]

    for candidate in candidates:
        if candidate:
            adb_path = candidate
            log(f"Using adb at {adb_path}")
            return adb_path

    raise SystemExit(
        "ADB_NOT_FOUND: Install Android platform tools, or set ADB_PATH to the adb executable. "
        "On macOS with Homebrew, run: brew install android-platform-tools"
    )


def resolve_adb_serial(devices):
    configured = os.environ.get("ADB_SERIAL") or os.environ.get("ANDROID_SERIAL")
    if configured:
        for serial, state in devices:
            if serial == configured and state == "device":
                return serial

        raise SystemExit(
            f"ADB_SERIAL_NOT_FOUND: {configured} is not connected as a ready device. "
            "Run `adb devices` and update ADB_SERIAL or ANDROID_SERIAL."
        )

    ready = [serial for serial, state in devices if state == "device"]
    return ready[0] if ready else None


def run(*args):
    command = [resolve_adb()]
    if adb_serial and args and args[0] not in {"devices", "start-server", "kill-server"}:
        command.extend(["-s", adb_serial])

    command.extend(args)
    display = "adb " + " ".join(command[1:])
    log(display)
    return subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
    )


def ensure_device_ready():
    global adb_serial

    result = run("devices")
    devices = []
    unauthorized = []

    for line in result.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 2:
            continue

        serial, state = parts[0], parts[1]
        devices.append((serial, state))
        if state == "unauthorized":
            unauthorized.append(serial)

    serial = resolve_adb_serial(devices)
    if serial:
        adb_serial = serial
        log(f"Using Android device {adb_serial}")
        return

    if unauthorized:
        raise SystemExit(
            "ADB_UNAUTHORIZED: Unlock the Android phone and tap Allow on the USB debugging prompt, then try again."
        )

    raise SystemExit(
        "NO_ANDROID_DEVICE: Connect an Android phone with USB debugging enabled, or start an Android emulator, then try again."
    )


def node_desc(node):
    return (node.attrib.get("content-desc") or "").strip()


def is_transaction_desc(desc: str) -> bool:
    return "Energy Charge:" in desc or "Water:" in desc or "Daily " in desc or "Subtotal-" in desc


def is_parseable_transaction_desc(desc: str) -> bool:
    return bool(WATER_ROW_RE.match(desc) or ENERGY_ROW_RE.match(desc) or FIXED_ROW_RE.match(desc) or TOPUP_ROW_RE.match(desc))


def node_bounds(node):
    match = BOUNDS_RE.match(node.attrib.get("bounds", ""))
    if not match:
        return None

    return tuple(int(value) for value in match.groups())


def bounds_center(node):
    bounds = node_bounds(node)
    if not bounds:
        return None

    left, top, right, bottom = bounds
    return (left + right) // 2, (top + bottom) // 2


def tap_node(node, wait_seconds: float = 1.2):
    center = bounds_center(node)
    if not center:
        log("Could not tap node because bounds were missing")
        return False

    log(
        f"Tapping {node_desc(node) or node.attrib.get('class', 'node')} at {center[0]},{center[1]} and waiting {wait_seconds:.1f}s"
    )
    run("shell", "input", "tap", str(center[0]), str(center[1]))
    time.sleep(wait_seconds)
    return True


def find_clickable_node(root, desc: str, starts_with: bool = False, contains: bool = False):
    for node in root.iter("node"):
        value = node_desc(node)
        if node.attrib.get("clickable") != "true":
            continue
        if value == desc or (starts_with and value.startswith(desc)) or (contains and desc in value):
            return node

    return None


def node_size(node):
    bounds = node_bounds(node)
    if not bounds:
        return None

    left, top, right, bottom = bounds
    return right - left, bottom - top


def is_large_content_button(node):
    size = node_size(node)
    if not size:
        return False

    width, height = size
    return width > 300 and height > 45


def find_ledger_button(root):
    exact = []
    preferred = []
    fallback = []

    for node in root.iter("node"):
        value = node_desc(node)
        if node.attrib.get("clickable") != "true" or "Ledger" not in value:
            continue

        if "Tab" in value:
            continue

        log(f"Found Ledger button candidate {value!r} bounds={node.attrib.get('bounds', '')}")

        if value == "Ledger":
            exact.append(node)
        elif is_large_content_button(node):
            preferred.append(node)
        else:
            fallback.append(node)

    return (exact or preferred or fallback or [None])[0]


def root_size(root):
    for node in root.iter("node"):
        size = node_size(node)
        if size:
            return size

    return 1080, 2424


def tap_ledger_history_fallback(root):
    width, height = root_size(root)
    x = width // 2
    y = int(height * 0.75)
    log(f"Tapping fallback orange Ledger button position at {x},{y}")
    run("shell", "input", "tap", str(x), str(y))
    time.sleep(1.2)


def press_back():
    log("Pressing Android back")
    run("shell", "input", "keyevent", "4")
    time.sleep(1.2)


def capture_dt_to_period_dt(value):
    return datetime.strptime(value, "%d/%m/%Y %H:%M").strftime("%Y-%m-%d %H:%M")


def dump_ui_to(local: Path) -> Path:
    run("shell", "uiautomator", "dump", REMOTE_DUMP_PATH)
    run("pull", REMOTE_DUMP_PATH, str(local))
    return local


def dump_ui(i: int) -> Path:
    return dump_ui_to(OUT_DIR / f"view_{i:04d}.xml")


def load_xml(path: Path):
    return ET.parse(path).getroot()


def has_transaction_rows(root) -> bool:
    return any(is_parseable_transaction_desc(node_desc(node)) for node in root.iter("node"))


def wait_for_condition(
    check_fn,
    snapshot_name: str,
    attempts: int = SCREEN_WAIT_ATTEMPTS,
    delay_seconds: float = SCREEN_WAIT_SECONDS,
):
    for attempt in range(1, attempts + 1):
        root = load_xml(dump_ui_to(OUT_DIR / snapshot_name))
        if check_fn(root):
            log(f"Condition met for {snapshot_name} on attempt {attempt}")
            return root

        log(f"Condition not met for {snapshot_name} on attempt {attempt}/{attempts}; waiting {delay_seconds:.1f}s")
        if attempt < attempts:
            time.sleep(delay_seconds)

    return None


def has_ledger_tab(root) -> bool:
    return find_clickable_node(root, "Ledger\nTab", starts_with=True) is not None


def has_orange_ledger_button(root) -> bool:
    return find_ledger_button(root) is not None


def confirm_transaction_screen(snapshot_name: str):
    return wait_for_condition(has_transaction_rows, snapshot_name)


def open_ledger_history_from_current_screen():
    log("Preparing LiveMopay ledger screen")
    initial_snapshot = dump_ui_to(OUT_DIR / "view_prepare_0000.xml")
    root = load_xml(initial_snapshot)
    setup_added = 0

    if has_transaction_rows(root):
        log("Initial screen already looks like the individual row list")
        added, candidate_count = parse_xml(initial_snapshot)
        setup_added += added
        log(f"Parsed initial visible row list before reset: added={added} candidates={candidate_count}")
        back = find_clickable_node(root, "Back")
        if back is not None:
            tap_node(back)
        else:
            press_back()
        root = load_xml(dump_ui_to(OUT_DIR / "view_prepare_0001.xml"))
    else:
        log("Initial screen does not look like the individual row list")

    root_wait = wait_for_condition(has_ledger_tab, "view_prepare_wait_ledger.xml")
    if root_wait is not None:
        root = root_wait

    ledger_tab = find_clickable_node(root, "Ledger\nTab", starts_with=True)
    if ledger_tab is not None and tap_node(ledger_tab, wait_seconds=6.0):
        root_button = wait_for_condition(has_orange_ledger_button, "view_prepare_0002.xml")
        if root_button is not None:
            root = root_button

    ledger_button = find_ledger_button(root)
    if ledger_button is not None and tap_node(ledger_button, wait_seconds=8.0):
        root_rows = confirm_transaction_screen("view_prepare_tab_ledger.xml")
        if root_rows is not None:
            return setup_added

    tap_ledger_history_fallback(root)
    time.sleep(4.0)
    root = confirm_transaction_screen("view_prepare_0003.xml")
    if root is not None:
        return setup_added

    raise SystemExit(SETUP_MESSAGE)


def parse_xml(path: Path):
    root = load_xml(path)
    added = 0
    candidate_count = 0

    for node in root.iter("node"):
        desc = node_desc(node)
        if not is_transaction_desc(desc):
            continue

        m = ENERGY_ROW_RE.match(desc)
        item = None

        if m:
            candidate_count += 1
            item = m.groupdict()
            item["water_kl"] = "0"
        else:
            m = WATER_ROW_RE.match(desc)

            if m:
                candidate_count += 1
                item = m.groupdict()
                item["kwh"] = "0"
            else:
                m = FIXED_ROW_RE.match(desc)

                if m:
                    candidate_count += 1
                    item = m.groupdict()
                    item["period_dt"] = f"{item.pop('period_date')} 00:00"
                    item["kwh"] = "0"
                    item["water_kl"] = "0"
                    item.pop("quantity", None)
                else:
                    m = TOPUP_ROW_RE.match(desc)

                    if m:
                        candidate_count += 1
                        item = m.groupdict()
                        item["charge_label"] = "Top Up"
                        item["period_dt"] = capture_dt_to_period_dt(item["capture_dt"])
                        item["kwh"] = "0"
                        item["water_kl"] = "0"
                        item["tariff"] = "0"
                        item["cost"] = item.pop("amount")
                        item.pop("subtotal", None)
                        item.pop("vat", None)
                        item.pop("total", None)

        if not m:
            continue

        item.setdefault("source_ts", "")

        for field in ("kwh", "water_kl", "tariff", "cost", "balance"):
            if field in item:
                item[field] = item[field].replace(",", "")

        key = row_key(item)
        if key in seen_keys:
            continue

        seen_keys.add(key)
        rows.append(item)
        added += 1

    return added, candidate_count


def parse_existing_dumps():
    rows.clear()
    seen_keys.clear()

    for path in sorted(OUT_DIR.glob("view_*.xml")):
        parse_xml(path)

    save_csv()
    print(f"Done. Wrote {len(rows)} rows to livemopay_energy.csv", flush=True)


def find_scrollable_bounds(root):
    candidates = []

    for node in root.iter("node"):
        if node.attrib.get("scrollable") != "true":
            continue

        bounds = node_bounds(node)
        if not bounds:
            continue

        left, top, right, bottom = bounds
        candidates.append((bottom - top, left, top, right, bottom))

    if not candidates:
        width, height = root_size(root)
        return 0, 0, width, height

    _, left, top, right, bottom = max(candidates)
    return left, top, right, bottom


def swipe_up(xml_path: Path):
    root = load_xml(xml_path)
    left, top, right, bottom = find_scrollable_bounds(root)
    height = bottom - top
    x = (left + right) // 2
    start_y = max(top + 1, bottom - max(120, height // 4))
    end_y = min(bottom - 1, top + max(120, height // 3))

    if start_y <= end_y:
        start_y = max(top + 1, bottom - 120)
        end_y = min(bottom - 1, top + 120)

    log(f"Swiping list from {x},{start_y} to {x},{end_y}")
    run("shell", "input", "swipe", str(x), str(start_y), str(x), str(end_y), "600")


def load_existing_csv():
    if not CSV_PATH.exists():
        return 0

    loaded = 0
    with CSV_PATH.open(newline="") as f:
        reader = csv.DictReader(f)
        for item in reader:
            if not all(item.get(field) for field in REQUIRED_FIELDNAMES):
                continue

            key = row_key(item)
            if key in seen_keys:
                continue

            seen_keys.add(key)
            rows.append({field: item.get(field, "0" if field == "water_kl" else "") for field in FIELDNAMES})
            loaded += 1

    return loaded


def save_csv():
    with CSV_PATH.open("w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=FIELDNAMES,
        )
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description="Capture LiveMopay ledger rows from a local Android device or emulator.")
    parser.add_argument("--full", action="store_true", help="Rebuild the CSV instead of loading existing rows first.")
    parser.add_argument("--from-dumps", action="store_true", help="Rebuild the CSV from existing XML dumps only.")
    parser.add_argument("--no-reset", action="store_true", help="Start scanning from the current screen without navigation.")
    args = parser.parse_args()

    LOG_PATH.write_text("")

    if args.from_dumps:
        parse_existing_dumps()
        return

    full_recapture = args.full
    stagnant_rounds = 0
    existing_count = 0 if full_recapture else load_existing_csv()
    new_count = 0

    if full_recapture:
        print(f"Starting full recapture. Existing {CSV_PATH} will be rebuilt.", flush=True)

    if existing_count:
        print(f"Loaded {existing_count} existing rows from {CSV_PATH}", flush=True)

    ensure_device_ready()

    if not args.no_reset:
        new_count += open_ledger_history_from_current_screen()

    for i in range(1, MAX_ITERATIONS + 1):
        xml_path = dump_ui(i)
        added, candidate_count = parse_xml(xml_path)

        if i == 1 and candidate_count == 0:
            raise SystemExit(SETUP_MESSAGE)

        new_count += added
        total = len(rows)

        print(f"[{i}] added={added} new={new_count} total={total}", flush=True)

        if added == 0:
            stagnant_rounds += 1
        else:
            stagnant_rounds = 0

        save_csv()

        if stagnant_rounds >= MAX_STAGNANT_ROUNDS:
            print("No new rows found for several rounds. Stopping.", flush=True)
            break

        swipe_up(xml_path)
        time.sleep(1.2)

    if full_recapture:
        print(f"Done. Rebuilt {CSV_PATH} with {len(rows)} rows.", flush=True)
    else:
        print(f"Done. Added {new_count} new rows. Wrote {len(rows)} rows to {CSV_PATH}", flush=True)


if __name__ == "__main__":
    main()
