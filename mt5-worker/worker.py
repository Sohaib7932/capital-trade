#!/usr/bin/env python3
"""
CapitalTrade MT5 sync worker.

Every SYNC_INTERVAL_SECONDS, for each account in accounts.json (or the single
account in .env): log in to MetaTrader 5, read the account, open positions and
deal history, and POST them to the CapitalTrade ingest API.

    python worker.py                    # run forever
    python worker.py --once             # one cycle, then exit (for testing)
    python worker.py --test-connection  # log in and print balances only
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

VERSION = "1.1.0"
BASE_DIR = Path(__file__).resolve().parent
STATE_FILE = BASE_DIR / "state.json"
ACCOUNTS_FILE = BASE_DIR / "accounts.json"
LOG_DIR = BASE_DIR / "logs"
# Re-read this much history on every sync so late corrections are picked up.
OVERLAP = timedelta(days=2)

log = logging.getLogger("mt5-worker")


# --- Setup --------------------------------------------------------------------------


def setup_logging() -> None:
    # The Windows console defaults to a legacy code page; don't let a character crash a log line.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    LOG_DIR.mkdir(exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s")
    file_handler = RotatingFileHandler(LOG_DIR / "worker.log", maxBytes=5_000_000, backupCount=5, encoding="utf-8")
    file_handler.setFormatter(fmt)
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    log.setLevel(logging.INFO)
    log.addHandler(file_handler)
    log.addHandler(console)


@dataclass
class Account:
    label: str
    login: int
    password: str
    server: str
    path: str | None = None


@dataclass
class Config:
    api_url: str
    ingest_key: str
    interval: int
    lookback_days: int
    mt5_path: str | None
    accounts: list[Account]


class ConfigError(Exception):
    pass


def env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name, default)
    return value.strip() if isinstance(value, str) else value


def load_config() -> Config:
    load_dotenv(BASE_DIR / ".env")
    api_url = env("API_URL")
    key = env("MT5_INGEST_KEY")
    if not api_url:
        raise ConfigError("API_URL is missing in .env (e.g. https://your-app.vercel.app)")
    if not key or len(key) < 32:
        raise ConfigError("MT5_INGEST_KEY is missing in .env (copy it from the app's environment variables)")

    accounts: list[Account] = []
    if ACCOUNTS_FILE.exists():
        raw = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
        for i, item in enumerate(raw):
            password = item.get("password") or (env(item["password_env"]) if item.get("password_env") else None)
            if not password:
                raise ConfigError(f"accounts.json entry {i + 1}: set 'password' or 'password_env'")
            accounts.append(
                Account(
                    label=item.get("label") or str(item["login"]),
                    login=int(item["login"]),
                    password=password,
                    server=item["server"],
                    path=item.get("path"),
                )
            )
    elif env("MT5_LOGIN"):
        accounts.append(
            Account(
                label="Main account",
                login=int(env("MT5_LOGIN") or 0),
                password=env("MT5_PASSWORD") or "",
                server=env("MT5_SERVER") or "",
            )
        )
    if not accounts:
        raise ConfigError("No accounts: create accounts.json or set MT5_LOGIN / MT5_PASSWORD / MT5_SERVER in .env")
    for a in accounts:
        if not a.password or not a.server:
            raise ConfigError(f"Account {a.login}: password and server are required")

    return Config(
        api_url=api_url.rstrip("/"),
        ingest_key=key,
        interval=max(15, int(env("SYNC_INTERVAL_SECONDS", "60") or 60)),
        lookback_days=max(1, int(env("LOOKBACK_DAYS_FIRST_RUN", "90") or 90)),
        mt5_path=env("MT5_PATH") or None,
        accounts=accounts,
    )


# --- State (last successful sync per account) -------------------------------------------


class State:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.data: dict[str, str] = {}
        if path.exists():
            try:
                self.data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                log.warning("state.json is unreadable; starting with a full lookback")

    def last_sync(self, login: int) -> datetime | None:
        value = self.data.get(str(login))
        return datetime.fromisoformat(value) if value else None

    def set_last_sync(self, login: int, when: datetime) -> None:
        self.data[str(login)] = when.isoformat()
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        tmp.replace(self.path)  # atomic on Windows and POSIX


# --- MT5 -------------------------------------------------------------------------------


class Mt5Error(Exception):
    pass


def import_mt5():
    try:
        import MetaTrader5 as mt5  # Windows only

        return mt5
    except ImportError as exc:  # pragma: no cover
        raise Mt5Error("The MetaTrader5 package is not installed (it only works on Windows with 64-bit Python)") from exc


def mt5_login(mt5, cfg: Config, account: Account) -> None:
    path = account.path or cfg.mt5_path
    kwargs: dict[str, Any] = {"login": account.login, "password": account.password, "server": account.server, "timeout": 60_000}
    ok = mt5.initialize(path, **kwargs) if path else mt5.initialize(**kwargs)
    if not ok:
        code, message = mt5.last_error()
        mt5.shutdown()
        raise Mt5Error(f"MT5 login failed for {account.login} @ {account.server}: [{code}] {message}")
    info = mt5.account_info()
    if info is None or int(info.login) != account.login:
        mt5.shutdown()
        raise Mt5Error(f"MT5 is logged in to a different account than {account.login}")


def detect_offset_minutes(mt5, symbols: list[str]) -> int | None:
    """Broker server time − UTC, from a fresh tick. None when the market is closed (stale ticks)."""
    now = time.time()
    for symbol in symbols:
        mt5.symbol_select(symbol, True)
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or not tick.time:
            continue
        raw = tick.time - now  # seconds; ≈ offset if the tick is fresh
        rounded = round(raw / 1800) * 1800  # brokers use whole or half hours
        if abs(raw - rounded) <= 120 and -720 * 60 <= rounded <= 840 * 60:
            return int(rounded // 60)
    return None


def clock_symbols(mt5, seen: list[str]) -> list[str]:
    """Symbols to read the broker clock from: the broker's own gold symbol names first
    (any case or suffix, e.g. "xauusd", "XAUUSDm"), then symbols seen in positions/deals."""
    names = [s.name for s in (mt5.symbols_get() or ())]
    gold = [n for n in names if n.upper().startswith(("XAUUSD", "GOLD"))][:3]
    return (gold + [s for s in seen if s not in gold])[:5] or ["XAUUSD"]


def as_dict(row: Any) -> dict[str, Any]:
    return row._asdict() if hasattr(row, "_asdict") else dict(row)


def build_payload(account: Account, info: Any, positions: tuple, deals: tuple, offset: int | None) -> dict[str, Any]:
    deal_rows = []
    for d in deals:
        x = as_dict(d)
        deal_rows.append(
            {
                "ticket": int(x["ticket"]),
                "order": int(x.get("order") or 0),
                "position_id": int(x.get("position_id") or 0),
                "time": int(x["time"]),
                "time_msc": int(x.get("time_msc") or 0) or None,
                "type": int(x["type"]),
                "entry": int(x["entry"]),
                "symbol": x.get("symbol") or "",
                "volume": float(x.get("volume") or 0),
                "price": float(x.get("price") or 0),
                "profit": float(x.get("profit") or 0),
                "swap": float(x.get("swap") or 0),
                "commission": float(x.get("commission") or 0),
                "fee": float(x.get("fee") or 0),
                "magic": int(x.get("magic") or 0),
                "comment": (x.get("comment") or "")[:255],
            }
        )
    position_rows = []
    for p in positions:
        x = as_dict(p)
        position_rows.append(
            {
                "ticket": int(x["ticket"]),
                "symbol": x["symbol"],
                "type": int(x["type"]),
                "volume": float(x["volume"]),
                "time": int(x["time"]),
                "price_open": float(x["price_open"]),
                "price_current": float(x["price_current"]),
                "profit": float(x["profit"]),
                "swap": float(x.get("swap") or 0),
            }
        )
    # time_msc of 0 means "not provided": drop it rather than send null.
    for row in deal_rows:
        if row["time_msc"] is None:
            del row["time_msc"]
    return {
        "account_login": account.login,
        "server": account.server,
        "account": {
            "balance": float(info.balance),
            "equity": float(info.equity),
            "margin": float(info.margin),
            "profit": float(info.profit),
        },
        "positions": position_rows,
        "deals": deal_rows,
        "detected_utc_offset_minutes": offset,
        "worker_version": VERSION,
    }


# --- API -------------------------------------------------------------------------------


class ApiError(Exception):
    pass


def post_json(session: requests.Session, cfg: Config, path: str, payload: dict[str, Any], attempts: int = 5) -> dict[str, Any]:
    """POST with exponential backoff on network errors, 429 and 5xx. 4xx errors are not retried."""
    url = f"{cfg.api_url}{path}"
    for attempt in range(1, attempts + 1):
        try:
            res = session.post(url, json=payload, headers={"X-Ingest-Key": cfg.ingest_key}, timeout=120)
            if res.status_code < 400:
                return res.json()
            detail = _detail(res)
            if res.status_code != 429 and res.status_code < 500:
                raise ApiError(f"HTTP {res.status_code}: {detail}")
            log.warning("API %s returned %s (%s), attempt %s/%s", path, res.status_code, detail, attempt, attempts)
        except (requests.ConnectionError, requests.Timeout) as exc:
            log.warning("Network error posting to %s: %s (attempt %s/%s)", path, exc, attempt, attempts)
        if attempt < attempts:
            time.sleep(min(60, 2**attempt) + random.uniform(0, 1))
    raise ApiError(f"Giving up on {path} after {attempts} attempts")


def _detail(res: requests.Response) -> str:
    try:
        return str(res.json().get("detail", res.text))[:300]
    except ValueError:
        return res.text[:300]


def report_error(session: requests.Session, cfg: Config, account: Account, message: str) -> None:
    try:
        post_json(session, cfg, "/api/ingest/mt5/error", {"account_login": account.login, "error": message[:1000]}, attempts=2)
    except Exception as exc:  # never let error reporting crash the loop
        log.warning("Couldn't report the error to the API: %s", exc)


# --- Cycle -----------------------------------------------------------------------------


def sync_account(mt5, cfg: Config, account: Account, state: State, session: requests.Session) -> None:
    started = datetime.now(timezone.utc)
    last = state.last_sync(account.login)
    since = (last - OVERLAP) if last else started - timedelta(days=cfg.lookback_days)
    until = started + timedelta(days=1)  # broker clocks run ahead of UTC

    mt5_login(mt5, cfg, account)
    try:
        info = mt5.account_info()
        positions = mt5.positions_get() or ()
        deals = mt5.history_deals_get(since, until)
        if deals is None:
            code, message = mt5.last_error()
            raise Mt5Error(f"history_deals_get failed: [{code}] {message}")
        seen = sorted({p.symbol for p in positions} | {d.symbol for d in deals if d.symbol})
        offset = detect_offset_minutes(mt5, clock_symbols(mt5, seen))
        payload = build_payload(account, info, positions, deals, offset)
    finally:
        mt5.shutdown()

    result = post_json(session, cfg, "/api/ingest/mt5", payload)
    state.set_last_sync(account.login, started)
    log.info(
        "%s (%s): %s deals -> inserted %s, updated %s, ignored %s; cash %s; %s open positions; recalculated %s",
        account.label,
        account.login,
        len(payload["deals"]),
        result.get("inserted"),
        result.get("updated"),
        result.get("ignored"),
        result.get("cashEvents"),
        result.get("positions"),
        ", ".join(result.get("recomputedMonths") or []) or "nothing",
    )
    for warning in result.get("warnings") or []:
        log.warning("%s: %s", account.label, warning)


def run_cycle(cfg: Config, state: State, session: requests.Session) -> bool:
    """One pass over every account. Returns True if all succeeded. Never raises."""
    ok = True
    try:
        mt5 = import_mt5()
    except Mt5Error as exc:
        log.error("%s", exc)
        return False
    for account in cfg.accounts:
        try:
            sync_account(mt5, cfg, account, state, session)
        except (Mt5Error, ApiError) as exc:
            ok = False
            log.error("%s (%s): %s", account.label, account.login, exc)
            if isinstance(exc, Mt5Error):
                report_error(session, cfg, account, str(exc))
        except Exception as exc:  # keep going whatever happens
            ok = False
            log.exception("%s (%s): unexpected error: %s", account.label, account.login, exc)
            report_error(session, cfg, account, f"Unexpected worker error: {exc}")
    return ok


def test_connection(cfg: Config) -> bool:
    mt5 = import_mt5()
    ok = True
    for account in cfg.accounts:
        try:
            mt5_login(mt5, cfg, account)
            info = mt5.account_info()
            offset = detect_offset_minutes(mt5, clock_symbols(mt5, []))
            print(
                f"OK  {account.label} ({info.login} @ {info.server}, {info.company}): "
                f"balance {info.balance:,.2f} {info.currency}, equity {info.equity:,.2f}, "
                f"broker clock {'UTC%+.1fh' % (offset / 60) if offset is not None else 'unknown (market closed?)'}"
            )
            mt5.shutdown()
        except Mt5Error as exc:
            ok = False
            print(f"ERR {account.label} ({account.login}): {exc}")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description="CapitalTrade MT5 sync worker")
    parser.add_argument("--once", action="store_true", help="run a single sync cycle and exit")
    parser.add_argument("--test-connection", action="store_true", help="log in to each account and print its balance")
    args = parser.parse_args()

    setup_logging()
    try:
        cfg = load_config()
    except (ConfigError, ValueError, KeyError, OSError) as exc:
        log.error("Configuration error: %s", exc)
        return 2

    if args.test_connection:
        return 0 if test_connection(cfg) else 1

    state = State(STATE_FILE)
    session = requests.Session()
    log.info("Worker %s started: %s account(s), every %ss -> %s", VERSION, len(cfg.accounts), cfg.interval, cfg.api_url)
    if args.once:
        return 0 if run_cycle(cfg, state, session) else 1

    while True:
        started = time.monotonic()
        try:
            run_cycle(cfg, state, session)
        except Exception:  # belt and braces: the loop must never die
            log.exception("Cycle crashed")
        time.sleep(max(5, cfg.interval - (time.monotonic() - started)))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.info("Stopped")
        sys.exit(0)
