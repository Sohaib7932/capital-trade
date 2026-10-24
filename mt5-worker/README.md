# CapitalTrade MT5 sync worker

A small Python program that runs on a Windows machine (or VPS) next to its **own copy** of MetaTrader 5. Every few
minutes it:

1. asks CapitalTrade for the list of client MT5 accounts (`GET /api/ingest/mt5/accounts`),
2. decrypts each account's **investor (read-only) password** locally,
3. logs in to each account in turn, reads the balance, open positions and deal history,
4. sends them to CapitalTrade (`POST /api/ingest/mt5`).

The software never trades. Passwords are entered in the app, stored there only encrypted, and decrypted only here.
New clients are picked up on the next cycle without a restart. One failing account (e.g. a wrong password) never
stops the others; its error shows in the app.

## What you need

- Windows 10/11 or Windows Server 2019/2022 (a VPS near the broker is ideal). 2 vCPU / 4 GB RAM is plenty.
- **Python 3.11+ (64-bit)** — the `MetaTrader5` package only works with 64-bit Python on Windows.
- The EC Markets **MetaTrader 5** installer.
- From the CapitalTrade app: its URL and `MT5_INGEST_KEY`.

## 1. A separate MT5 copy for the worker (important)

Logging in to an account switches the terminal to that account. If the worker used the trader's terminal, the trader
would be kicked to another account in the middle of trading. So the worker gets its **own portable copy**, and refuses to
start on a normal installation (anything under `C:\Program Files`) unless `ALLOW_SHARED_TERMINAL=true`.

1. Install MT5 normally once (or use the trader's existing installation as the source — it is only read).
2. Copy the program folder to a folder of its own, e.g. in PowerShell:
   ```powershell
   robocopy "C:\Program Files\MetaTrader 5" C:\MT5-Sync /E /XD "C:\Program Files\MetaTrader 5\Bases"
   ```
3. Give the copy the broker's server list: copy `servers.dat` from the normal terminal's data folder
   (MT5 → **File → Open Data Folder** → `config\servers.dat`) to `C:\MT5-Sync\Config\servers.dat`.
4. Optional check: start `C:\MT5-Sync\terminal64.exe /portable` once, **File → Login to Trade Account**, log in with
   any client's investor password on `ECMarketsLtd-Live`, then close it.
5. Set `MT5_PATH=C:\MT5-Sync\terminal64.exe` in `.env`. The worker starts it in portable mode itself.

For many accounts you can make more copies (`C:\MT5-Sync-2`, …) and list them in `MT5_PATHS`; accounts are split
across them and synced in parallel.

## 2. Install the worker

```powershell
cd C:\capitaltrade\mt5-worker
python -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
notepad .env
```

| Setting | Value |
| --- | --- |
| `MT5_PATH` | The worker's portable terminal, e.g. `C:\MT5-Sync\terminal64.exe` |
| `API_URL` | The app, e.g. `https://capital-trade-seven.vercel.app` (no trailing slash) |
| `MT5_INGEST_KEY` | Exactly the value in the app's environment |
| `MT5_CREDENTIALS_PRIVATE_KEY` | Written by `npm run mt5:keygen` (app folder). Keep it only here |
| `LOOKBACK_DAYS_FIRST_RUN` | `90` — history pulled the first time an account syncs |

The sync interval (default 5 minutes) is set in the app: **Settings → MT5 Connection → Sync interval**.

Lock the folder down — `.env` holds the private key:

```powershell
icacls C:\capitaltrade\mt5-worker /inheritance:r /grant:r "$env:USERNAME:(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F"
```

## 3. Add clients in the app

**Clients → Add Client**: name, contact, Source (Direct or an IB), and the MT5 login, server (`ECMarketsLtd-Live` or
`ECMarketsLtd-Demo`) and **investor** password. The account shows *Waiting for first sync* until the next cycle.

## 4. Test

```powershell
.\start-worker.bat --test-connection   # logs in to every account and prints balances (no data sent)
.\start-worker.bat --once              # one full sync
```

## 5. Run it in the background (starts after reboot)

Use **Task Scheduler** (MT5 needs a user session, so not a service):

1. *Create Task* → General: *Run only when user is logged on* (or *whether user is logged on or not* on a VPS with
   auto-logon), tick *Run with highest privileges*.
2. Triggers: *At log on* (and/or *At startup*).
3. Actions: *Start a program* → `C:\capitaltrade\mt5-worker\start-worker.bat`, *Start in* `C:\capitaltrade\mt5-worker`.
4. Settings: untick *Stop the task if it runs longer than…*; *If the task is already running: Do not start a new instance*.

Only one worker can run per folder: a second copy exits with *Another worker is already running*.

## Day to day

- **Logs:** `logs\worker.log` (rotates at 5 MB, keeps 5 files).
- **Status:** the app's top bar, **Dashboard → Sync health**, and each client's page (green < 5 min after a sync,
  amber < 30 min, red otherwise). A rejected login shows *Wrong investor password or server* — use **Replace password**
  on the client's page.
- **Daylight saving:** when the broker's clock changes, the app warns with the detected offset; update the account's
  broker clock in Settings → MT5 Connection.
- **New key pair?** (`npm run mt5:keygen -- --force`) — every investor password must be re-entered in the app.
- **Resync from scratch:** stop the worker, delete `state.json`, start it (the app ignores deals it already has).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `MT5_PATH … is a normal MT5 installation` | Point `MT5_PATH` at the portable copy (section 1). |
| `Wrong investor password or server` | Replace the password on the client's page; check the server name. |
| `Couldn't start the MT5 terminal` | Wrong `MT5_PATH`, or the copy is missing files. |
| `can't read the stored password … different key` | The key pair changed; re-enter that account's password. |
| `HTTP 401: Invalid ingest key` | `MT5_INGEST_KEY` differs from the app's. |
| `Another worker is already running` | Close the other window / Task Scheduler instance. |
