# CapitalTrade Advisor

Admin app for a pooled gold (XAUUSD) investment business: clients, introducing brokers (IBs), MT5 trades, and the monthly
profit split. Only profit is split — invested capital never is.

**Stack:** Next.js 16 (App Router, route handlers as the backend) · Neon Postgres via `pg` · Tailwind + shadcn/ui ·
decimal.js for money · vitest + PGlite for tests.

## How profit is calculated

1. **Daily allocation (SQL).** A "day" is a calendar day in the business timezone (default `Asia/Karachi`). Each day's
   pool net profit (profit + swap + commission of trades closed that day) is shared by the capital each client had
   active that day. A deposit counts from the day **after** its effective date; a withdrawal stops counting **on** its
   effective date. Rows are stored unrounded in `daily_allocations`.
2. **Monthly settlement.** A client's month = the sum of their daily shares, rounded to cents once. With
   `carry_forward` (default), an unrecovered loss from earlier months is recovered first and goes back to the client;
   only profit beyond that is shared. IB commission is a % of that profit — either taken from the company's share or
   off the top before the split. Trader and client shares are rounded; the company line takes the remainder cent, so
   every month reconciles exactly to its real net profit.
3. **Finalizing** a month freezes every client's numbers in `settlements` and creates payouts (clients, trader, IBs).
   Nothing changes a finalized month afterwards. Months are finalized oldest-first and reopened newest-first; reopening
   needs an admin and a reason, and is written to the audit log.

`npm run example` prints a worked example (three clients, a mid-month deposit, a withdrawal) straight from the engine.

## MetaTrader 5 sync

Trades come from MT5 automatically:

1. **Register the account** in **Settings → MT5 Connection** (login, server, broker clock, pool or one client).
2. **Run the worker** in [`mt5-worker/`](mt5-worker/README.md) on a Windows VPS next to the MT5 terminal. It posts
   each account's balance, open positions and deals to `POST /api/ingest/mt5` every minute, authenticated with the
   `X-Ingest-Key` header (= `MT5_INGEST_KEY`). The investor password stays on the VPS.
3. The app upserts deals by `(account_login, deal_ticket)` (re-sends are ignored), converts broker time to UTC with the
   account's offset, and recalculates open months.

Rules: trading profit = profit + swap + commission + fee of the BUY/SELL deals (profit itself only appears on closing
deals; entry commissions count on their own day). Lots = volume of opening deals, so a round trip isn't counted twice.
Balance operations (deposits, credit, bonus, charges) go to **account cash events** for review — never profit, never a
client transaction. Trades on the Trades page are deals grouped by position. Deals that arrive for a **finalized** month
are stored but change nothing; admins see a banner. Seeded demo trades are removed automatically on the first real sync.

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
| `npm run mt5:send-fake` | Post fake MT5 deals to the ingest endpoint (`--register`, `--url`, `--locked-month`) |
| `npm run db:clear-demo` | Remove demo trades (`-- --everything --yes` removes all business data) |

## Deploy to Vercel

1. Push the repo to GitHub and **Import** it in Vercel (framework: Next.js, defaults are fine).
2. Add the environment variables from `.env.example` (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `MT5_INGEST_KEY`) for Production — or
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
