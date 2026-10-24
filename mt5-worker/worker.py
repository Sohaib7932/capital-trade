#!/usr/bin/env python3
"""
CapitalTrade MT5 sync worker.

Each cycle (every few minutes, set in the app): fetch the list of client MT5
accounts from CapitalTrade, decrypt each investor password locally, log in to
each account on this worker's OWN MetaTrader 5 terminal, read the account, open
positions and deal history, and POST them to the CapitalTrade ingest API.

    python worker.py                    # run forever
    python worker.py --once             # one cycle, then exit (for testing)
    python worker.py --test-connection  # log in to each account and print balances only

The worker must use a dedicated (portable) MT5 installation: logging in switches
the terminal's account, which would interrupt a trader using the same terminal.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Callable

import requests
from dotenv import load_dotenv

from credentials import CredentialError, decrypt_password, load_private_key

VERSION = "2.0.0"
BASE_DIR = Path(__file__).resolve().parent
STATE_FILE = BASE_DIR / "state.json"
LOCK_FILE = BASE_DIR / "worker.lock"
LOG_DIR = BASE_DIR / "logs"
# Re-read this much history on every sync so late corrections are picked up.
OVERLAP = timedelta(days=2)
DEFAULT_INTERVAL = 300

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
    """One account to sync. `password` is decrypted in memory only and never logged."""

    login: int
    server: str
    label: str
    password: str = field(repr=False)


@dataclass
class Config:
    api_url: str
    ingest_key: str = field(repr=False)
    private_key: Any = field(repr=False)
    terminals: list[str]
    portable: bool
    interval_override: int | None
    lookback_days: int


class ConfigError(Exception):
    pass


def env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name, default)
    return value.strip() if isinstance(value, str) else value


def is_shared_terminal(path: str) -> bool:
    """A terminal under Program Files is a normal installation (the trader's); the worker needs its own copy."""
    p = path.replace("/", "\\").lower()
    roots = {r.replace("/", "\\").lower().rstrip("\\") for r in (os.getenv("ProgramFiles"), os.getenv("ProgramFiles(x86)")) if r}
    roots |= {"c:\\program files", "c:\\program files (x86)"}
    return any(p.startswith(root + "\\") for root in roots)


def check_terminals(paths: list[str], allow_shared: bool) -> list[str]:
    """The worker's terminal(s). Refuses the trader's (default) installation unless explicitly allowed."""
    if not paths:
        if allow_shared:
            return []
        raise ConfigError(
            "MT5_PATH is not set. Point it at the worker's OWN portable terminal, e.g. C:\\MT5-Sync\\terminal64.exe "
            "(see README: 'A separate MT5 copy for the worker'). Without it MT5 would attach to whichever terminal is "
            "running - possibly the trader's."
        )
    for path in paths:
        if is_shared_terminal(path) and not allow_shared:
            raise ConfigError(
                f"MT5_PATH {path} is a normal MT5 installation. Logging in from the worker switches that terminal's account "
                "and would interrupt the trader. Use a separate portable copy (e.g. C:\\MT5-Sync\\terminal64.exe), or set "
                "ALLOW_SHARED_TERMINAL=true if nobody trades on this terminal."
            )
    return paths


def load_config() -> Config:
    load_dotenv(BASE_DIR / ".env")
    api_url = env("API_URL")
    key = env("MT5_INGEST_KEY")
    private = env("MT5_CREDENTIALS_PRIVATE_KEY")
    if not api_url:
        raise ConfigError("API_URL is missing in .env (e.g. https://your-app.vercel.app)")
    if not key or len(key) < 32:
        raise ConfigError("MT5_INGEST_KEY is missing in .env (copy it from the app's environment variables)")
    if not private:
        raise ConfigError("MT5_CREDENTIALS_PRIVATE_KEY is missing in .env (run `npm run mt5:keygen` in the app folder)")
    try:
        private_key = load_private_key(private)
    except CredentialError as exc:
        raise ConfigError(str(exc)) from exc

    raw_paths = env("MT5_PATHS") or env("MT5_PATH") or ""
    paths = [p.strip().strip('"') for p in raw_paths.replace(";", ",").split(",") if p.strip()]
    allow_shared = (env("ALLOW_SHARED_TERMINAL") or "").lower() in ("1", "true", "yes")
    terminals = check_terminals(paths, allow_shared)
    interval = env("SYNC_INTERVAL_SECONDS")

    return Config(
        api_url=api_url.rstrip("/"),
        ingest_key=key,
        private_key=private_key,
        terminals=terminals,
        portable=(env("MT5_PORTABLE") or "true").lower() not in ("0", "false", "no"),
        interval_override=max(30, int(interval)) if interval else None,
        lookback_days=max(1, int(env("LOOKBACK_DAYS_FIRST_RUN", "90") or 90)),
    )


# --- Single instance -----------------------------------------------------------------------


class InstanceLock:
    """Holds an OS file lock for the life of the process, so only one worker runs per folder."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle = None

    def acquire(self) -> bool:
        self.handle = open(self.path, "a+")  # noqa: SIM115 - kept open while running
        try:
            if os.name == "nt":
                import msvcrt

                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.handle.close()
            self.handle = None
            return False
        self.handle.seek(0)
        self.handle.truncate()
        self.handle.write(str(os.getpid()))
        self.handle.flush()
        return True


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

    def set_many(self, synced: dict[int, datetime]) -> None:
        if not synced:
            return
        for login, when in synced.items():
            self.data[str(login)] = when.isoformat()
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        tmp.replace(self.path)  # atomic on Windows and POSIX


# --- MT5 -------------------------------------------------------------------------------


class Mt5Error(Exception):
    def __init__(self, message: str, kind: str = "other") -> None:
        super().__init__(message)
        self.kind = kind  # "auth" = wrong investor password or server


def import_mt5():
    try:
        import MetaTrader5 as mt5  # Windows only

        return mt5
    except ImportError as exc:  # pragma: no cover
        raise Mt5Error("The MetaTrader5 package is not installed (it only works on Windows with 64-bit Python)") from exc


def is_auth_error(code: int, message: str) -> bool:
    # MT5 reports a rejected login as (-6, 'Terminal: Authorization failed').
    return code == -6 or "authoriz" in (message or "").lower() or "invalid account" in (message or "").lower()


class Terminal:
    """One MT5 terminal, started once per cycle; accounts log in one after another."""

    def __init__(self, mt5, path: str | None, portable: bool) -> None:
        self.mt5 = mt5
        self.path = path
        self.portable = portable
        self.started = False

    def start(self, account: Account) -> bool:
        """Start (or attach to) the terminal logged in to `account`. A fresh terminal with no account
        never answers an initialize() without credentials, so the first account always goes in here."""
        kwargs: dict[str, Any] = {"login": account.login, "password": account.password, "server": account.server, "timeout": 90_000}
        if self.path:
            kwargs["portable"] = self.portable
            ok = self.mt5.initialize(self.path, **kwargs)
        else:
            ok = self.mt5.initialize(**kwargs)
        if ok:
            self.started = True
        return ok

    def login(self, account: Account) -> None:
        ok = (
            self.mt5.login(account.login, password=account.password, server=account.server, timeout=60_000)
            if self.started
            else self.start(account)
        )
        if not ok:
            code, message = self.mt5.last_error()
            if is_auth_error(code, message):
                # The terminal may still be up (logged in to the previous account); keep it for the next one.
                raise Mt5Error(f"Wrong investor password or server for {account.login} @ {account.server}", kind="auth")
            # Anything else: start the terminal afresh for the next account.
            self.stop()
            raise Mt5Error(f"MT5 couldn't open {account.login} @ {account.server} on {self.path or 'the terminal'}: [{code}] {message}")
        info = self.mt5.account_info()
        if info is None or int(info.login) != account.login:
            raise Mt5Error(f"MT5 is logged in to a different account than {account.login}")

    def stop(self) -> None:
        if self.started:
            self.mt5.shutdown()
            self.started = False


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
        row = {
            "ticket": int(x["ticket"]),
            "order": int(x.get("order") or 0),
            "position_id": int(x.get("position_id") or 0),
            "time": int(x["time"]),
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
        if x.get("time_msc"):  # 0 means "not provided"
            row["time_msc"] = int(x["time_msc"])
        deal_rows.append(row)
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
    account_info: dict[str, Any] = {
        "balance": float(info.balance),
        "equity": float(info.equity),
        "margin": float(info.margin),
        "profit": float(info.profit),
    }
    for attr, key, cast in (("currency", "currency", str), ("leverage", "leverage", int), ("trade_mode", "trade_mode", int)):
        value = getattr(info, attr, None)
        if value is not None:
            account_info[key] = cast(value)
    return {
        "account_login": account.login,
        "server": account.server,
        "account": account_info,
        "positions": position_rows,
        "deals": deal_rows,
        "detected_utc_offset_minutes": offset,
        "worker_version": VERSION,
    }


# --- API -------------------------------------------------------------------------------


class ApiError(Exception):
    pass


class Api:
    def __init__(self, api_url: str, ingest_key: str, session: requests.Session | None = None) -> None:
        self.api_url = api_url
        self.ingest_key = ingest_key
        self.session = session or requests.Session()

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None, attempts: int = 5) -> dict[str, Any]:
        """Exponential backoff on network errors, 429 and 5xx. Other 4xx errors are not retried."""
        url = f"{self.api_url}{path}"
        for attempt in range(1, attempts + 1):
            try:
                res = self.session.request(method, url, json=payload, headers={"X-Ingest-Key": self.ingest_key}, timeout=120)
                if res.status_code < 400:
                    return res.json()
                detail = _detail(res)
                if res.status_code != 429 and res.status_code < 500:
                    raise ApiError(f"HTTP {res.status_code}: {detail}")
                log.warning("API %s returned %s (%s), attempt %s/%s", path, res.status_code, detail, attempt, attempts)
            except (requests.ConnectionError, requests.Timeout) as exc:
                log.warning("Network error calling %s: %s (attempt %s/%s)", path, exc, attempt, attempts)
            if attempt < attempts:
                time.sleep(min(60, 2**attempt) + random.uniform(0, 1))
        raise ApiError(f"Giving up on {path} after {attempts} attempts")

    def accounts(self) -> dict[str, Any]:
        return self._request("GET", "/api/ingest/mt5/accounts")

    def ingest(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/ingest/mt5", payload)

    def report_error(self, login: int, message: str, kind: str = "other") -> None:
        try:
            self._request("POST", "/api/ingest/mt5/error", {"account_login": login, "error": message[:1000], "kind": kind}, attempts=2)
        except Exception as exc:  # never let error reporting crash the loop
            log.warning("Couldn't report the error for %s to the API: %s", login, exc)


def _detail(res: requests.Response) -> str:
    try:
        return str(res.json().get("detail", res.text))[:300]
    except ValueError:
        return res.text[:300]


# --- Cycle -----------------------------------------------------------------------------


def fetch_accounts(api: Api, private_key: Any) -> tuple[list[Account], int]:
    """The app's account list, with passwords decrypted. Undecryptable ones are reported and skipped."""
    data = api.accounts()
    accounts: list[Account] = []
    for item in data.get("accounts") or []:
        login = int(item["login"])
        try:
            password = decrypt_password(item["encrypted_password"], private_key)
        except CredentialError as exc:
            log.error("%s: %s", login, exc)
            api.report_error(login, f"The worker can't read the stored password: {exc}")
            continue
        accounts.append(Account(login=login, server=item["server"], label=item.get("label") or str(login), password=password))
    return accounts, int(data.get("sync_interval_seconds") or DEFAULT_INTERVAL)


def sync_account(
    terminal: Terminal, account: Account, since: datetime, api: Api
) -> tuple[datetime, dict[str, Any]]:
    """Read one account and post it. Returns when the read started (the next `since`) and the API result."""
    mt5 = terminal.mt5
    started = datetime.now(timezone.utc)
    until = started + timedelta(days=1)  # broker clocks run ahead of UTC
    terminal.login(account)
    info = mt5.account_info()
    positions = mt5.positions_get() or ()
    deals = mt5.history_deals_get(since, until)
    if deals is None:
        code, message = mt5.last_error()
        raise Mt5Error(f"history_deals_get failed: [{code}] {message}")
    seen = sorted({p.symbol for p in positions} | {d.symbol for d in deals if d.symbol})
    offset = detect_offset_minutes(mt5, clock_symbols(mt5, seen))
    payload = build_payload(account, info, positions, deals, offset)
    return started, api.ingest(payload)


def sync_batch(
    mt5,
    terminal_path: str | None,
    portable: bool,
    accounts: list[Account],
    since_by_login: dict[int, datetime],
    api: Api,
) -> dict[int, datetime]:
    """Sync accounts one by one on one terminal. A failing account never stops the others.
    Returns the start time of each successful sync, by login."""
    terminal = Terminal(mt5, terminal_path, portable)
    synced: dict[int, datetime] = {}
    try:
        for account in accounts:
            try:
                started, result = sync_account(terminal, account, since_by_login[account.login], api)
                synced[account.login] = started
                log.info(
                    "%s (%s): inserted %s, updated %s, ignored %s; cash %s; %s open positions; recalculated %s",
                    account.label,
                    account.login,
                    result.get("inserted"),
                    result.get("updated"),
                    result.get("ignored"),
                    result.get("cashEvents"),
                    result.get("positions"),
                    ", ".join(result.get("recomputedMonths") or []) or "nothing",
                )
                for warning in result.get("warnings") or []:
                    log.warning("%s: %s", account.label, warning)
            except Mt5Error as exc:
                log.error("%s (%s): %s", account.label, account.login, exc)
                api.report_error(account.login, str(exc), exc.kind)
            except ApiError as exc:
                log.error("%s (%s): %s", account.label, account.login, exc)
            except Exception as exc:  # keep going whatever happens
                log.exception("%s (%s): unexpected error: %s", account.label, account.login, exc)
                api.report_error(account.login, f"Unexpected worker error: {exc}")
    finally:
        terminal.stop()
    return synced


def partition(accounts: list[Account], terminals: int) -> list[list[Account]]:
    """Spread accounts evenly over the terminals (round-robin, stable by login)."""
    buckets: list[list[Account]] = [[] for _ in range(max(1, terminals))]
    for i, account in enumerate(sorted(accounts, key=lambda a: a.login)):
        buckets[i % len(buckets)].append(account)
    return buckets


def _batch_in_subprocess(path: str, portable: bool, accounts: list[Account], since: dict[int, datetime], api_url: str, key: str):
    """Entry point for a terminal's own process (the MetaTrader5 module is one connection per process)."""
    setup_logging()
    return sync_batch(import_mt5(), path, portable, accounts, since, Api(api_url, key))


def run_cycle(cfg: Config, state: State, api: Api, mt5_loader: Callable[[], Any] = import_mt5) -> int:
    """One pass over every account. Returns the interval the app asks for. Never raises."""
    try:
        accounts, interval = fetch_accounts(api, cfg.private_key)
    except ApiError as exc:
        log.error("Couldn't fetch the account list: %s", exc)
        return cfg.interval_override or DEFAULT_INTERVAL
    interval = cfg.interval_override or interval
    if not accounts:
        log.info("No accounts to sync yet (add clients with their MT5 login and investor password in the app)")
        return interval

    now = datetime.now(timezone.utc)
    since: dict[int, datetime] = {}
    for a in accounts:
        last = state.last_sync(a.login)
        # First sync: the full lookback. Afterwards: since the last sync, minus an overlap for late corrections.
        since[a.login] = last - OVERLAP if last else now - timedelta(days=cfg.lookback_days)
    paths = cfg.terminals or [None]
    buckets = [b for b in partition(accounts, len(paths)) if b]

    synced: dict[int, datetime] = {}
    if len(buckets) == 1:
        try:
            synced = sync_batch(mt5_loader(), paths[0], cfg.portable, buckets[0], since, api)
        except Mt5Error as exc:
            log.error("%s", exc)
            for a in buckets[0]:
                api.report_error(a.login, str(exc))
    else:
        with ProcessPoolExecutor(max_workers=len(buckets)) as pool:
            futures = [
                pool.submit(_batch_in_subprocess, paths[i], cfg.portable, bucket, since, cfg.api_url, cfg.ingest_key)
                for i, bucket in enumerate(buckets)
            ]
            for i, future in enumerate(futures):
                try:
                    synced.update(future.result())
                except Exception as exc:
                    log.error("Terminal %s failed: %s", paths[i], exc)
                    for a in buckets[i]:
                        api.report_error(a.login, f"Worker terminal failed: {exc}")
    state.set_many(synced)
    log.info("Cycle done: %s/%s account(s) synced", len(synced), len(accounts))
    return interval


def test_connection(cfg: Config, api: Api) -> bool:
    accounts, _ = fetch_accounts(api, cfg.private_key)
    if not accounts:
        print("No accounts with an investor password in the app yet.")
        return True
    mt5 = import_mt5()
    terminal = Terminal(mt5, (cfg.terminals or [None])[0], cfg.portable)
    ok = True
    try:
        for account in accounts:
            try:
                terminal.login(account)
                info = mt5.account_info()
                offset = detect_offset_minutes(mt5, clock_symbols(mt5, []))
                print(
                    f"OK  {account.label} ({info.login} @ {info.server}, {info.company}): "
                    f"balance {info.balance:,.2f} {info.currency}, equity {info.equity:,.2f}, "
                    f"broker clock {'UTC%+.1fh' % (offset / 60) if offset is not None else 'unknown (market closed?)'}"
                )
            except Mt5Error as exc:
                ok = False
                print(f"ERR {account.label} ({account.login}): {exc}")
    finally:
        terminal.stop()
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description="CapitalTrade MT5 sync worker")
    parser.add_argument("--once", action="store_true", help="run a single sync cycle and exit")
    parser.add_argument("--test-connection", action="store_true", help="log in to each account and print its balance")
    args = parser.parse_args()

    setup_logging()
    try:
        cfg = load_config()
    except (ConfigError, ValueError, OSError) as exc:
        log.error("Configuration error: %s", exc)
        return 2

    lock = InstanceLock(LOCK_FILE)
    if not lock.acquire():
        log.error("Another worker is already running from %s - not starting a second one.", BASE_DIR)
        return 3

    api = Api(cfg.api_url, cfg.ingest_key)
    if args.test_connection:
        return 0 if test_connection(cfg, api) else 1

    state = State(STATE_FILE)
    log.info(
        "Worker %s started -> %s; terminal(s): %s",
        VERSION,
        cfg.api_url,
        ", ".join(cfg.terminals) or "any running terminal (ALLOW_SHARED_TERMINAL)",
    )
    if args.once:
        run_cycle(cfg, state, api)
        return 0

    while True:
        started = time.monotonic()
        interval = DEFAULT_INTERVAL
        try:
            interval = run_cycle(cfg, state, api)
        except Exception:  # belt and braces: the loop must never die
            log.exception("Cycle crashed")
        time.sleep(max(5, interval - (time.monotonic() - started)))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.info("Stopped")
        sys.exit(0)
