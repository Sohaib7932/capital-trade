# CapitalTrade Advisor

Admin app for a gold (XAUUSD) managed-account business. Every client has **their own MT5 account at EC Markets**; the
trader trades it with the master password, and this app only **reads** it (investor password) and calculates
everything: capital, profit, the monthly split, fees and IB data. Only profit is split — capital never is.

**Stack:** Next.js 16 (App Router, route handlers as the backend) · Neon Postgres via `pg` · Tailwind + shadcn/ui ·
decimal.js for money · vitest + PGlite for tests · a Python worker for MT5.

## The business rules

- **Source:** a client comes from an IB, or is a **Direct** client of the company (no IB).
- **Accounts:** a client can have several MT5 accounts; an account belongs to exactly one client. (An account with no
  client is a *pooled* account, shared by pool clients by capital — still supported.)
- **Profit:** a client's month = the net trading profit of their own accounts: profit + swap + commission + fee of
  gold BUY/SELL deals (profit on closing deals, lots from opening deals). Balance operations are never profit.
- **Split:** default 30% trader / 5% company / 65% client, per-client override (must total 100), on profit only.
- **Losses carry forward per client (always):** while a client's result since the last split is negative, nothing is
  split; later profit first recovers the loss and only the profit above it is split. Oct −300, Nov +1,000 → Nov split
  base 700 (trader 210, company 35, client 455 + the 300 recovered).
- **Capital** = confirmed deposits − withdrawals on the client's accounts. Each balance operation from MT5 is
  suggested as deposit/withdrawal by its sign and *needs review* until an admin classifies it: **deposit**,
  **withdrawal**, **fee payment** (the client paying the trader/company share — not capital; it marks that month's fee
  paid) or **ignore**. Capital is never typed in (only pool clients without an account have manual entries).
- **Fees:** profit stays in the client's own account, so finalizing a month records a **fee due** from the client
  (trader + company share, + IB if "additional"). Fee payments seen in MT5 settle it automatically once classified.
- **IB commission:** each IB has a rule (percent of client profit, from the company's share or additional), but IB
  commissions are **off** globally until decided (Settings). While off, nothing is calculated and commission columns
  are hidden; IB pages still show each IB's clients, capital, lots and profit.
- **Months** are finalized oldest-first (numbers frozen, fees/payouts created) and reopened newest-first with a reason.
  Rounding is exact; the company line takes the remainder cent, so totals always equal the real split base.

`npm run example` prints a worked example of the pool engine.

## MetaTrader 5 sync

1. **Add the client** (Clients → Add Client) with their MT5 login, server (`ECMarketsLtd-Live` / `-Demo`) and
   **investor password**. The password is encrypted at once with the worker's public key
   (`MT5_CREDENTIALS_PUBLIC_KEY`, RSA-3072 OAEP-SHA256); the app stores only ciphertext and can never decrypt it. The UI
   only ever shows "•••• set" / "Replace password".
2. **The worker** ([`mt5-worker/`](mt5-worker/README.md)) runs on Windows with its **own portable MT5 copy**. Each cycle
   (default 5 min, Settings → MT5 Connection) it fetches the accounts from `GET /api/ingest/mt5/accounts`, decrypts the
   passwords with its private key (only in `mt5-worker/.env`), logs in to each account in turn and posts it to
   `POST /api/ingest/mt5` (`X-Ingest-Key` = `MT5_INGEST_KEY`). A failing account is reported and never blocks others.
3. The app upserts deals by `(account_login, deal_ticket)` (re-sends are ignored), converts broker time to UTC with the
   account's offset, and recalculates open months. Deals for a **finalized** month are stored but change nothing.

Only **gold symbols** count (Settings → MT5 Connection, default `XAUUSD`, `GOLD`, matched ignoring case and broker
suffixes like `xauusd`, `XAUUSDm`, `XAUUSD.r`); other symbols are stored, flagged and never counted.

Key pair: `npm run mt5:keygen` writes the public key to `.env.local` (add it to Vercel too) and the private key to
`mt5-worker/.env`. Replacing it (`-- --force`) means re-entering every investor password.

Test the whole pipeline without MT5:

```bash
npm run mt5:send-fake -- --register              # registers a fake account and posts tests/fixtures/mt5-deals.ts
npm run mt5:send-fake -- --locked-month 2026-09  # also sends deals for a finalized month
```

## Demo data

Once real MT5 data flows into production, keep demo data on its own Neon branch:

```bash
neon checkout demo --create       # creates the branch and points .env.local at it
npm run db:migrate && npm run db:seed
neon checkout production          # switch back
```

The seed refuses to run on the `production` branch unless `--allow-production` is passed. To start production clean:
`npm run db:clear-demo` (demo trades only) or `npm run db:clear-demo -- --everything --yes` (all clients, IBs,
transactions, months and payouts; users, settings and MT5 accounts are kept).

## Local setup

Requires Node 20.19+ and a Neon project.

```bash
npm install
neon deploy                 # writes DATABASE_URL / DATABASE_URL_UNPOOLED to .env.local (see .env.example)
npm run db:migrate          # applies db/migrations/*.sql over the direct connection
npm run db:seed             # demo data + first admin login (password printed once)
npm run dev
```

- `npm run db:seed -- --reset` wipes business data and reloads the demo (logins are kept).
- Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` before seeding to choose the first login. For a real deployment, skip the demo
  seed and create users directly (below).

## Users and roles

- **admin** — everything. **viewer** — every page, read-only (enforced by the API, not just hidden buttons).
- Manage users in **Settings → Users**, or from the command line:

```bash
npm run user:create -- --email owner@example.com --name "Owner" --role admin
# USER_PASSWORD=... to choose the password; otherwise one is generated and printed.
# Running it for an existing email resets that user's password and signs them out.
```

- Sign-in is rate limited: 5 failed attempts per email + IP within 15 minutes.
- Every change (clients, transactions, IBs, finalize/reopen, payouts, settings, users) is written to the audit log
  (**Settings → Audit log**).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Ledger and database tests (vitest + in-process Postgres, no network) |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed` | Demo data and first admin |
| `npm run db:recompute` | Rebuild daily allocations for open months (`-- --all` includes finalized; first backfill only) |
| `npm run user:create` | Create a user or reset a password |
| `npm run example` | Print the worked allocation example |
| `npm run mt5:account` | Register or update an MT5 account (`-- --login … --server … --label … --offset 180`) |
| `npm run mt5:keygen` | Create the investor-password key pair (public → `.env.local`, private → `mt5-worker/.env`) |
| `npm run test:worker` | The MT5 worker's Python tests (also run by `npm test`) |
| `npm run mt5:send-fake` | Post fake MT5 deals to the ingest endpoint (`--register`, `--url`, `--locked-month`) |
| `npm run db:clear-demo` | Remove demo trades (`-- --everything --yes` removes all business data) |

## Deploy to Vercel

1. Push the repo to GitHub and **Import** it in Vercel (framework: Next.js, defaults are fine).
2. Add the environment variables from `.env.example` (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `MT5_INGEST_KEY`,
   `MT5_CREDENTIALS_PUBLIC_KEY`) for Production — or
   install the Neon integration so they're set for you. Use the pooled URL for `DATABASE_URL`.
3. Run migrations against the production database before (or right after) the first deploy:
   `npm run db:migrate` with the production `DATABASE_URL_UNPOOLED` in `.env.local`.
4. Create the first admin: `npm run user:create -- --email you@example.com --role admin`.
5. Deploy. The app uses Vercel Fluid compute with `attachDatabasePool` so idle Postgres connections are closed cleanly.

Pick a Vercel region close to your Neon region (e.g. both in `us-east`) — every page makes 1–2 database round-trips,
so distance dominates load time.

## Layout

- `src/lib/api.ts` — the only data entry point for the UI; calls the `/api/*` route handlers.
- `src/app/api/*` — route handlers. Every input is validated with zod; writes require the admin role.
- `src/server/` — `allocations.ts` (daily SQL), `settle.ts` (monthly rules), `ledger.ts` (months, payouts, views),
  `store.ts` (queries and writes), `auth.ts`, `users.ts`, `audit.ts`, `exports.ts` (Excel), `statement.tsx` (PDF).
- `db/migrations/` — schema as SQL. `tests/` — vitest suites (run the real migrations on PGlite).
