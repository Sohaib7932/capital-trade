"""Worker tests with a fake MetaTrader5 module and a fake API (no terminal, no network).

    .venv\\Scripts\\python -m unittest discover -s tests
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import worker  # noqa: E402
from worker import Account, ConfigError, check_terminals, is_shared_terminal, partition, sync_batch  # noqa: E402


class FakeMt5:
    """Just enough of the MetaTrader5 module. Logins in `bad_password` are rejected like MT5 does."""

    def __init__(self, bad_password: set[int] = frozenset(), crash_on: set[int] = frozenset()) -> None:
        self.bad_password = bad_password
        self.crash_on = crash_on
        self.current: int | None = None
        self.error = (1, "Success")
        self.initialized_with: list = []
        self.logins: list[int] = []

    def initialize(self, *args, **kwargs):
        """Like MT5: initialize() with credentials starts the terminal and logs in."""
        self.initialized_with.append((args, kwargs))
        return self.login(kwargs["login"], kwargs["password"], kwargs["server"], kwargs["timeout"])

    def shutdown(self):
        self.current = None

    def login(self, login, password, server, timeout):
        self.logins.append(login)
        if login in self.bad_password:
            self.error = (-6, "Terminal: Authorization failed")
            return False
        self.current = login
        return True

    def last_error(self):
        return self.error

    def account_info(self):
        return SimpleNamespace(
            login=self.current, balance=1000.0, equity=1000.0, margin=0.0, profit=0.0, currency="USD", leverage=500, trade_mode=0
        )

    def positions_get(self):
        if self.current in self.crash_on:
            raise RuntimeError("IPC timeout")
        return ()

    def history_deals_get(self, since, until):
        return ()

    def symbols_get(self):
        return (SimpleNamespace(name="xauusd"),)

    def symbol_select(self, symbol, enable):
        return True

    def symbol_info_tick(self, symbol):
        return None


class FakeApi:
    def __init__(self) -> None:
        self.ingested: list[int] = []
        self.errors: list[tuple[int, str, str]] = []

    def ingest(self, payload):
        self.ingested.append(payload["account_login"])
        return {"inserted": 0, "updated": 0, "ignored": 0, "warnings": []}

    def report_error(self, login, message, kind="other"):
        self.errors.append((login, message, kind))


def accounts(*logins: int) -> list[Account]:
    return [Account(login=l, server="ECMarketsLtd-Demo", label=str(l), password="secret") for l in logins]


def since(accs: list[Account]) -> dict[int, datetime]:
    return {a.login: datetime.now(timezone.utc) - timedelta(days=2) for a in accs}


class SeparateTerminalTest(unittest.TestCase):
    def test_refuses_the_default_installation(self):
        with self.assertRaises(ConfigError) as ctx:
            check_terminals([r"C:\Program Files\MetaTrader 5\terminal64.exe"], allow_shared=False)
        self.assertIn("separate portable copy", str(ctx.exception))

    def test_refuses_a_broker_installation_under_program_files(self):
        self.assertTrue(is_shared_terminal(r"C:\Program Files\EC Markets MetaTrader 5\terminal64.exe"))
        self.assertTrue(is_shared_terminal("C:/Program Files (x86)/MetaTrader 5/terminal64.exe"))

    def test_refuses_no_path_at_all(self):
        with self.assertRaises(ConfigError):
            check_terminals([], allow_shared=False)

    def test_accepts_a_portable_copy(self):
        path = r"C:\MT5-Sync\terminal64.exe"
        self.assertFalse(is_shared_terminal(path))
        self.assertEqual(check_terminals([path], allow_shared=False), [path])

    def test_shared_terminal_only_when_explicitly_allowed(self):
        path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
        self.assertEqual(check_terminals([path], allow_shared=True), [path])


class SyncBatchTest(unittest.TestCase):
    def test_one_failing_account_never_blocks_the_others(self):
        mt5 = FakeMt5(bad_password={2002})
        api = FakeApi()
        accs = accounts(2001, 2002, 2003)
        synced = sync_batch(mt5, r"C:\MT5-Sync\terminal64.exe", True, accs, since(accs), api)

        self.assertEqual(sorted(synced), [2001, 2003])
        self.assertEqual(api.ingested, [2001, 2003])
        self.assertEqual(len(api.errors), 1)
        login, message, kind = api.errors[0]
        self.assertEqual((login, kind), (2002, "auth"))
        self.assertIn("Wrong investor password or server", message)
        self.assertNotIn("secret", message)

    def test_an_unexpected_crash_is_reported_and_the_rest_continue(self):
        mt5 = FakeMt5(crash_on={2001})
        api = FakeApi()
        accs = accounts(2001, 2002)
        synced = sync_batch(mt5, r"C:\MT5-Sync\terminal64.exe", True, accs, since(accs), api)
        self.assertEqual(list(synced), [2002])
        self.assertEqual([e[0] for e in api.errors], [2001])

    def test_starts_the_terminal_once_and_logs_in_to_each_account(self):
        mt5 = FakeMt5()
        accs = accounts(2001, 2002, 2003)
        sync_batch(mt5, r"C:\MT5-Sync\terminal64.exe", True, accs, since(accs), FakeApi())
        self.assertEqual(len(mt5.initialized_with), 1)
        args, kwargs = mt5.initialized_with[0]
        self.assertEqual(args, (r"C:\MT5-Sync\terminal64.exe",))
        self.assertTrue(kwargs["portable"])
        # A fresh terminal needs the first account's credentials to start; then login() per account.
        self.assertEqual(kwargs["login"], 2001)
        self.assertEqual(mt5.logins, [2001, 2002, 2003])

    def test_a_rejected_first_account_does_not_stop_the_rest(self):
        mt5 = FakeMt5(bad_password={2001})
        api = FakeApi()
        accs = accounts(2001, 2002)
        synced = sync_batch(mt5, r"C:\MT5-Sync\terminal64.exe", True, accs, since(accs), api)
        self.assertEqual(list(synced), [2002])
        self.assertEqual([(e[0], e[2]) for e in api.errors], [(2001, "auth")])

    def test_payload_reports_account_details(self):
        mt5 = FakeMt5()
        mt5.current = 2001
        payload = worker.build_payload(accounts(2001)[0], mt5.account_info(), (), (), None)
        self.assertEqual(payload["account"]["currency"], "USD")
        self.assertEqual(payload["account"]["leverage"], 500)
        self.assertEqual(payload["account"]["trade_mode"], 0)
        self.assertNotIn("password", str(payload).lower())


class PartitionTest(unittest.TestCase):
    def test_spreads_accounts_over_terminals(self):
        buckets = partition(accounts(5, 1, 4, 2, 3), 2)
        self.assertEqual([[a.login for a in b] for b in buckets], [[1, 3, 5], [2, 4]])

    def test_single_terminal_gets_everything(self):
        self.assertEqual(len(partition(accounts(1, 2, 3), 1)[0]), 3)


class FetchAccountsTest(unittest.TestCase):
    def test_skips_and_reports_undecryptable_passwords(self):
        from cryptography.hazmat.primitives.asymmetric import rsa

        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)

        class Api(FakeApi):
            def accounts(self):
                return {"sync_interval_seconds": 300, "accounts": [{"login": 7, "server": "S", "label": "L", "encrypted_password": "v1.badkey.AAAA"}]}

        api = Api()
        accs, interval = worker.fetch_accounts(api, key)
        self.assertEqual((accs, interval), ([], 300))
        self.assertEqual(api.errors[0][0], 7)


class InstanceLockTest(unittest.TestCase):
    def test_only_one_worker_per_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "worker.lock"
            first = worker.InstanceLock(path)
            self.assertTrue(first.acquire())
            self.assertFalse(worker.InstanceLock(path).acquire())
            first.handle.close()


if __name__ == "__main__":
    unittest.main()
