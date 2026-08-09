import csv
import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

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

ENERGY_LABEL_RE = re.compile(r"^(?P<label>.+?) \((?P<period_dt>\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)$")
WATER_LABEL_RE = re.compile(
    r"^(?P<label>Water:.+?) \((?P<period_dt>\d{4}-\d{2}-\d{2} \d{2}:\d{2}) to \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$"
)
FIXED_LABEL_RE = re.compile(r"^(?P<label>Daily .+?) - (?P<period_date>\d{4}-\d{2}-\d{2})$")
# Credits describing a refund (e.g. "Incorrect Tariff Refund") reverse an
# earlier overcharge rather than being a wallet top-up. Matched generically.
REFUND_LABEL_RE = re.compile(r"refund", re.IGNORECASE)
ENERGY_UNITS_RE = re.compile(r"(?P<kwh>-?[\d.]+)\s*kWh\s*@\s*R(?P<tariff>-?[\d.]+)")
WATER_UNITS_RE = re.compile(r"(?P<water_kl>-?[\d.]+)\s*kL\s*@\s*R(?P<tariff>-?[\d.]+)")
FIXED_UNITS_RE = re.compile(r"(?P<quantity>-?[\d.]+)\s*@\s*R(?P<tariff>-?[\d.]+)")


def read_dotenv(path: Path):
    if not path.exists():
        return

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


read_dotenv(Path(".env.local"))


def env_path(name: str, default: str) -> Path:
    return Path(os.environ.get(name, default))


def env_str(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value


def require_env(name: str) -> str:
    value = env_str(name)
    if value is None:
        raise SystemExit(f"MISSING_ENV: {name} must be set in your shell or .env.local.")
    return value


SESSION_PATH = env_path("NEWINMETER_WEB_SESSION_PATH", ".secrets/livemopay_auth.json")
CSV_PATH = env_path("NEWINMETER_CSV_PATH", "livemopay_energy.csv")
LOCAL_TZ = ZoneInfo(os.environ.get("NEWINMETER_TIMEZONE", "Africa/Johannesburg"))
PORTAL_ORIGIN = os.environ.get("NEWINMETER_WEB_PORTAL_ORIGIN", "https://app.livewalletportal.co.za")
API_BASE_URL = os.environ.get("NEWINMETER_WEB_BASE_URL", "https://app.propertywallet.co.za")
AUTH_HEADER = os.environ.get("NEWINMETER_WEB_AUTH_HEADER", "Authorization")
AUTH_SCHEME = os.environ.get("NEWINMETER_WEB_AUTH_SCHEME", "Bearer")
REFRESH_BUFFER_SECONDS = int(os.environ.get("NEWINMETER_WEB_REFRESH_BUFFER_SECONDS", "300"))
ACCEPT_LANGUAGE = os.environ.get("NEWINMETER_WEB_ACCEPT_LANGUAGE", "en-US,en;q=0.9")
APP_FLAVOR = os.environ.get("NEWINMETER_WEB_APP_FLAVOR", "livemopay")
USER_AGENT = os.environ.get(
    "NEWINMETER_WEB_USER_AGENT",
    (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/136.0.0.0 Safari/537.36"
    ),
)


@dataclass
class AuthSession:
    id_token: str
    refresh_token: str
    expires_at: str
    email: str | None = None
    local_id: str | None = None

    def expires_at_dt(self) -> datetime:
        return datetime.fromisoformat(self.expires_at)

    def is_expiring_soon(self) -> bool:
        return datetime.now(timezone.utc) + timedelta(seconds=REFRESH_BUFFER_SECONDS) >= self.expires_at_dt()


def ensure_session_dir():
    SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)


def load_session() -> AuthSession | None:
    if not SESSION_PATH.exists():
        return None

    data = json.loads(SESSION_PATH.read_text())
    return AuthSession(**data)


def save_session(session: AuthSession):
    ensure_session_dir()
    SESSION_PATH.write_text(json.dumps(asdict(session), indent=2) + "\n")


def post_json(url: str, payload: dict, headers: dict[str, str] | None = None) -> dict:
    request_headers = {"Content-Type": "application/json"}
    if headers:
        request_headers.update(headers)

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=request_headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {url} failed with {error.code}: {detail}") from error


def post_form(url: str, payload: dict[str, str], headers: dict[str, str] | None = None) -> dict:
    request_headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if headers:
        request_headers.update(headers)

    request = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(payload).encode("utf-8"),
        headers=request_headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {url} failed with {error.code}: {detail}") from error


def get_json(url: str, headers: dict[str, str]) -> dict | list:
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET {url} failed with {error.code}: {detail}") from error


def expires_at_from_seconds(expires_in: str | int) -> str:
    seconds = int(expires_in)
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def firebase_response_to_session(response: dict, email: str | None = None) -> AuthSession:
    return AuthSession(
        id_token=response["idToken"],
        refresh_token=response["refreshToken"],
        expires_at=expires_at_from_seconds(response["expiresIn"]),
        email=email or response.get("email"),
        local_id=response.get("localId"),
    )


def firebase_login() -> AuthSession:
    api_key = require_env("NEWINMETER_FIREBASE_API_KEY")
    email = require_env("NEWINMETER_WEB_EMAIL")
    password = require_env("NEWINMETER_WEB_PASSWORD")
    response = post_json(
        f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={urllib.parse.quote(api_key, safe='')}",
        {
            "email": email,
            "password": password,
            "returnSecureToken": True,
        },
    )
    session = firebase_response_to_session(response, email=email)
    save_session(session)
    return session


def firebase_refresh(refresh_token: str, email: str | None = None) -> AuthSession:
    api_key = require_env("NEWINMETER_FIREBASE_API_KEY")
    response = post_form(
        f"https://securetoken.googleapis.com/v1/token?key={urllib.parse.quote(api_key, safe='')}",
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
    )
    session = AuthSession(
        id_token=response["id_token"],
        refresh_token=response["refresh_token"],
        expires_at=expires_at_from_seconds(response["expires_in"]),
        email=email,
        local_id=response.get("user_id"),
    )
    save_session(session)
    return session


def ensure_valid_session() -> AuthSession:
    session = load_session()
    if session is None:
        return firebase_login()
    if session.is_expiring_soon():
        return firebase_refresh(session.refresh_token, email=session.email)
    return session


def decode_jwt_claims(token: str) -> dict:
    parts = token.split(".")
    if len(parts) < 2:
        raise RuntimeError("Invalid JWT: expected at least two segments.")

    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    decoded = base64.urlsafe_b64decode(payload + padding).decode("utf-8")
    return json.loads(decoded)


def auth_headers(session: AuthSession) -> dict[str, str]:
    claims = decode_jwt_claims(session.id_token)
    account_id = require_env("NEWINMETER_ACCOUNT_ID")
    company_id = str(env_str("NEWINMETER_COMPANY_ID") or claims["company_id"])
    property_id = str(env_str("NEWINMETER_PROPERTY_ID") or claims["property_id"])

    return {
        AUTH_HEADER: f"{AUTH_SCHEME} {session.id_token}".strip(),
        "Accept": "*/*",
        "Accept-Language": ACCEPT_LANGUAGE,
        "accountid": account_id,
        "appflavor": APP_FLAVOR,
        "companyid": company_id,
        "Origin": PORTAL_ORIGIN,
        "propertyid": property_id,
        "Referer": PORTAL_ORIGIN.rstrip("/") + "/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "User-Agent": USER_AGENT,
    }


def parse_money(value: str) -> str:
    value = (value or "").strip().replace("R", "").replace(",", "")
    return value or "0"


def negate_money(value: str) -> str:
    # Flips the sign of an already-parsed money string so refunds reduce net
    # spend downstream.
    if value in ("", "0"):
        return "0"
    return value[1:] if value.startswith("-") else f"-{value}"


def parse_local_capture_dt(value: str) -> str:
    source = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return source.astimezone(LOCAL_TZ).strftime("%d/%m/%Y %H:%M")


def capture_dt_to_period_dt(value: str) -> str:
    return datetime.strptime(value, "%d/%m/%Y %H:%M").strftime("%Y-%m-%d %H:%M")


def normalize_ledger_row(item: dict) -> dict | None:
    description = (item.get("description") or "").strip()
    capture_dt = parse_local_capture_dt(item["date"])
    balance = parse_money(item.get("balanceIncl") or item.get("balance"))

    energy_match = ENERGY_LABEL_RE.match(description)
    if energy_match:
        units = item.get("unitsDescriptionIncl") or item.get("unitsDescription") or ""
        units_match = ENERGY_UNITS_RE.search(units)
        if not units_match:
            raise RuntimeError(f"Could not parse energy units from {units!r}")

        return {
            "capture_dt": capture_dt,
            "source_ts": item["date"],
            "charge_label": energy_match.group("label"),
            "period_dt": energy_match.group("period_dt"),
            "kwh": units_match.group("kwh"),
            "water_kl": "0",
            "tariff": units_match.group("tariff"),
            "cost": parse_money(item.get("debitIncl") or item.get("debit")),
            "balance": balance,
        }

    water_match = WATER_LABEL_RE.match(description)
    if water_match:
        units = item.get("unitsDescriptionIncl") or item.get("unitsDescription") or ""
        units_match = WATER_UNITS_RE.search(units)
        if not units_match:
            raise RuntimeError(f"Could not parse water units from {units!r}")

        return {
            "capture_dt": capture_dt,
            "source_ts": item["date"],
            "charge_label": water_match.group("label"),
            "period_dt": water_match.group("period_dt"),
            "kwh": "0",
            "water_kl": units_match.group("water_kl"),
            "tariff": units_match.group("tariff"),
            "cost": parse_money(item.get("debitIncl") or item.get("debit")),
            "balance": balance,
        }

    fixed_match = FIXED_LABEL_RE.match(description)
    if fixed_match:
        units = item.get("unitsDescriptionIncl") or item.get("unitsDescription") or ""
        units_match = FIXED_UNITS_RE.search(units)
        if not units_match:
            raise RuntimeError(f"Could not parse fixed-charge units from {units!r}")

        return {
            "capture_dt": capture_dt,
            "source_ts": item["date"],
            "charge_label": fixed_match.group("label"),
            "period_dt": f"{fixed_match.group('period_date')} 00:00",
            "kwh": "0",
            "water_kl": "0",
            "tariff": units_match.group("tariff"),
            "cost": parse_money(item.get("debitIncl") or item.get("debit")),
            "balance": balance,
        }

    # A refund is a credit, but unlike a top-up it reverses an earlier
    # overcharge, so it must reduce net spend rather than land in the top-up
    # bucket. Keep the original description as the label (distinct type, no
    # usage) and store the amount as a negative cost.
    if REFUND_LABEL_RE.search(description):
        refund = parse_money(item.get("creditIncl") or item.get("credit"))
        return {
            "capture_dt": capture_dt,
            "source_ts": item["date"],
            "charge_label": description,
            "period_dt": capture_dt_to_period_dt(capture_dt),
            "kwh": "0",
            "water_kl": "0",
            "tariff": "0",
            "cost": negate_money(refund),
            "balance": balance,
        }

    credit = parse_money(item.get("creditIncl") or item.get("credit"))
    if credit != "0":
        return {
            "capture_dt": capture_dt,
            "source_ts": item["date"],
            "charge_label": "Top Up",
            "period_dt": capture_dt_to_period_dt(capture_dt),
            "kwh": "0",
            "water_kl": "0",
            "tariff": "0",
            "cost": credit,
            "balance": balance,
        }

    return None


def dedupe_rows(rows: list[dict]) -> list[dict]:
    seen = set()
    unique = []
    for row in rows:
        key = (row["charge_label"], row["period_dt"], row["cost"], row["balance"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


def discover_account_id(session: AuthSession) -> str:
    payload = get_json(API_BASE_URL.rstrip("/") + "/mobile/", auth_headers(session))
    if isinstance(payload, list):
        for item in payload:
            account_id = item.get("accountId") or item.get("id")
            if account_id is not None:
                return str(account_id)
    raise RuntimeError("Could not discover account id from /mobile/. Set NEWINMETER_ACCOUNT_ID in .env.local.")


def fetch_ledger_rows(start_date: str) -> list[dict]:
    session = ensure_valid_session()
    account_id = env_str("NEWINMETER_ACCOUNT_ID") or discover_account_id(session)
    url = (
        API_BASE_URL.rstrip("/")
        + f"/mobile/ledger/{urllib.parse.quote(start_date, safe='')}?accountId={urllib.parse.quote(account_id, safe='')}"
    )
    payload = get_json(url, auth_headers(session))
    if not isinstance(payload, list):
        raise RuntimeError(f"Expected a list from ledger endpoint, got {type(payload).__name__}")

    rows = []
    for item in payload:
        normalized = normalize_ledger_row(item)
        if normalized is not None:
            rows.append(normalized)
    return dedupe_rows(rows)


def write_csv(rows: list[dict], path: Path = CSV_PATH):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
