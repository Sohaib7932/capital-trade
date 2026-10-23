# CapitalTrade MT5 sync worker

A small Python program that runs on a **Windows VPS** next to the MetaTrader 5 terminal. Every minute it logs in to each
MT5 account with the **investor (read-only) password**, reads the balance, open positions and deal history, and sends
them to CapitalTrade (`POST /api/ingest/mt5`). Passwords stay on the VPS; the app never sees them.

It is safe to run continuously: the app ignores deals it already has, so the worker always re-sends the last 2 days.

## What you need

- A Windows VPS (Windows Server 2019/2022 or Windows 10/11), ideally in the same region as your broker's server.
  2 vCPU / 4 GB RAM is plenty.
- Your broker's **MetaTrader 5** installer, the account **login number**, **server name**, and **investor password**
  (MT5 → right-click the account → *Change password* → *Investor*, or ask the broker).
- From the CapitalTrade app: its URL and the `MT5_INGEST_KEY` value set in its environment.

## Setup (step by step)

### 1. Install MetaTrader 5 from your broker

1. On the VPS, download MT5 **from your broker's website** (not the generic MetaQuotes one, so the server list is right).
2. Install it. Note the install folder, e.g. `C:\Program Files\YourBroker MetaTrader 5\` — you need the full path to
   `terminal64.exe`.

### 2. Log in once by hand with the investor password

1. Open MT5 → **File → Login to Trade Account**.
2. Enter the login, the **investor** password, and pick the exact server. Tick **Save password**.
3. Check that the account's history appears (**Toolbox → History**, right-click → *All History*).
4. Close MT5. (The worker starts the terminal itself.)

> Logging in once by hand makes the terminal download the server list and accept the broker's terms. The Python
> library can't do that step.

### 3. Install Python 3.11+ (64-bit)

1. Download **Windows installer (64-bit)** from <https://www.python.org/downloads/windows/>.
2. Tick **Add python.exe to PATH**, then *Install Now*.
3. Open **PowerShell** and check: `python --version` → `Python 3.11` or newer.

The `MetaTrader5` package only works with **64-bit** Python on **Windows**.

### 4. Install the worker

```powershell
# Copy the mt5-worker folder to the VPS, e.g. C:\capitaltrade\mt5-worker
cd C:\capitaltrade\mt5-worker
python -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\pip install -r requirements.txt
```

### 5. Register the account in CapitalTrade

In the app: **Settings → MT5 Connection → Add account**. Enter the same login and server, choose the broker clock
(most brokers: **UTC+2 in winter, UTC+3 in summer**), and whether profit goes to the pool or one client.
The app refuses data from accounts that aren't registered.

### 6. Configure `.env` (and `accounts.json` for several accounts)

```powershell
copy .env.example .env
notepad .env
```

| Setting | Value |
| --- | --- |
| `MT5_PATH` | Full path to `terminal64.exe` from step 1 |
| `MT5_LOGIN` / `MT5_PASSWORD` / `MT5_SERVER` | The account and its **investor** password (single-account setup) |
| `API_URL` | Your app, e.g. `https://capitaltrade.vercel.app` (no trailing slash) |
| `MT5_INGEST_KEY` | Exactly the value in the app's environment |
| `SYNC_INTERVAL_SECONDS` | `60` |
| `LOOKBACK_DAYS_FIRST_RUN` | `90` — how much history the very first sync pulls |

**Several accounts:** copy `accounts.example.json` to `accounts.json` and list them. When `accounts.json` exists it
replaces the `MT5_LOGIN/…` settings. Each entry can use `"password"` or `"password_env": "NAME"` (read from `.env`),
and an optional `"path"` if an account needs its own terminal installation.

Lock the folder down — `.env` and `accounts.json` hold passwords:

```powershell
icacls C:\capitaltrade\mt5-worker /inheritance:r /grant:r "$env:USERNAME:(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F"
```

### 7. Test

```powershell
.\.venv\Scripts\python worker.py --test-connection   # logs in, prints balance and the broker clock offset
.\.venv\Scripts\python worker.py --once              # one full sync; check the app's Settings → MT5 Connection
```

`--test-connection` prints the broker clock it measured (e.g. `UTC+3.0h`). Make sure the app's account setting matches.
If the market is closed it prints *unknown* — that's fine.

### 8. Run it as a Windows service (starts after reboot)

1. Download **NSSM** from <https://nssm.cc/download>, unzip, and copy `win64\nssm.exe` to `C:\Windows\System32\`.
2. In an **Administrator** PowerShell:

```powershell
$dir = "C:\capitaltrade\mt5-worker"
nssm install CapitalTradeMT5 "$dir\.venv\Scripts\python.exe" "$dir\worker.py"
nssm set CapitalTradeMT5 AppDirectory $dir
nssm set CapitalTradeMT5 DisplayName "CapitalTrade MT5 sync"
nssm set CapitalTradeMT5 Start SERVICE_AUTO_START
nssm set CapitalTradeMT5 AppStdout "$dir\logs\service.log"
nssm set CapitalTradeMT5 AppStderr "$dir\logs\service.log"
nssm set CapitalTradeMT5 AppRestartDelay 10000
# Run as the Windows user that installed MT5 and logged in once (step 2) — not LocalSystem,
# which can't see that user's MT5 data folder.
nssm set CapitalTradeMT5 ObjectName ".\YourWindowsUser" "YourWindowsPassword"
nssm start CapitalTradeMT5
```

Check it: `nssm status CapitalTradeMT5` → `SERVICE_RUNNING`, and `logs\worker.log` gets a line every minute.

> If MT5 refuses to start from the service on your VPS (some terminal builds need an interactive desktop), use
> **Task Scheduler** instead: *Create Task* → run whether user is logged on or not → trigger *At startup* → action
> `C:\capitaltrade\mt5-worker\.venv\Scripts\python.exe` with argument `worker.py` and *Start in*
> `C:\capitaltrade\mt5-worker` → in *Settings*, untick "Stop the task if it runs longer than…".

## Day to day

- **Logs:** `logs\worker.log` (rotates at 5 MB, keeps 5 files).
- **Status:** the app's top bar shows *MT5 Synced • Xm ago*; Settings → MT5 Connection shows each account (green < 5 min,
  amber < 30 min, red otherwise) and the last error.
- **Daylight saving:** when the broker's clock changes, the app shows a warning with the detected offset. Update the
  account's broker clock in Settings — open months are corrected automatically.
- **Password changed?** Update `.env` / `accounts.json`, then `nssm restart CapitalTradeMT5`.
- **Resync from scratch:** stop the service, delete `state.json`, start it — the first run pulls `LOOKBACK_DAYS_FIRST_RUN`
  again (the app ignores what it already has).
- **Upgrade:** stop the service, replace `worker.py`, `pip install -r requirements.txt`, start it.

## What gets sent

Per account, per cycle: `account_info()` (balance, equity, margin, floating P/L), `positions_get()`, and
`history_deals_get(last successful sync − 2 days, now + 1 day)`. MT5 reports times in the broker's clock; the app
converts them to UTC using the account's offset. Balance operations (deposits, credit, bonus, …) are stored for review
and never counted as trading profit.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `MT5 login failed … Authorization failed` | Wrong investor password or server name. Log in by hand (step 2) to confirm. |
| `IPC timeout` / `terminal not found` | Wrong `MT5_PATH`, or the terminal was never started once by this Windows user. |
| `HTTP 401: Invalid ingest key` | `MT5_INGEST_KEY` differs from the app's. |
| `HTTP 404 … isn't registered` | Add the account in Settings → MT5 Connection (same login and server). |
| `Server mismatch` | The server name in the app differs from MT5's. Copy it exactly. |
| Times look shifted by an hour | The account's broker clock in Settings is off (daylight saving). |
