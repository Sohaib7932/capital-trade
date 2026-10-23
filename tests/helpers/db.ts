import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { SplitPercent } from "@/lib/types";
import { recomputeMonths, type Queryable } from "@/server/allocations";
import { freezeMonth, loadLedger } from "@/server/store";

/**
 * An in-process Postgres (PGlite) with the real migrations applied, so tests
 * exercise the same SQL the app runs on Neon.
 */
export async function createTestDb(options: { timezone?: string } = {}): Promise<TestDb> {
  const pg = new PGlite();
  const dir = path.join(process.cwd(), "db", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  await pg.query("INSERT INTO settings (id, business_timezone) VALUES (1, $1)", [options.timezone ?? "Asia/Karachi"]);
  await pg.query("INSERT INTO ibs (id, code, name, phone, email, joined_at) VALUES ('ib-01', 'IB-01', 'Test IB', '1', 'ib@x.test', '2020-01-01')");
  // The pooled trading account the helper's trades belong to.
  await pg.query("INSERT INTO mt5_accounts (label, login, server) VALUES ('Pool', $1, 'Test-Server')", [POOL_LOGIN]);
  return new TestDb(pg);
}

let ticket = 1;
export const POOL_LOGIN = 1000;

export class TestDb {
  constructor(readonly pg: PGlite) {}

  get db(): Queryable {
    return { query: (text, params) => this.pg.query(text, params) };
  }

  async client(id: string, split: SplitPercent = { trader: 30, company: 5, client: 65 }): Promise<void> {
    await this.pg.query(
      `INSERT INTO clients (id, code, full_name, phone, email, ib_id, joined_at, split_trader, split_company, split_client)
       VALUES ($1, upper($1), $1, '1', 'c@x.test', 'ib-01', '2020-01-01', $2, $3, $4)`,
      [id, split.trader, split.company, split.client],
    );
  }

  async deposit(clientId: string, amount: string, date: string): Promise<void> {
    await this.txn(clientId, "deposit", amount, date);
  }

  async withdraw(clientId: string, amount: string, date: string): Promise<void> {
    await this.txn(clientId, "withdrawal", amount, date);
  }

  private async txn(clientId: string, type: string, amount: string, date: string): Promise<void> {
    await this.pg.query(
      "INSERT INTO transactions (id, client_id, type, amount, date) VALUES (gen_random_uuid()::text, $1, $2, $3, $4)",
      [clientId, type, amount, date],
    );
  }

  /** A closed 1-lot trade with the given net result: an opening and a closing deal, as MT5 records them. */
  async trade(closeTimeUtc: string, net: string, login = POOL_LOGIN): Promise<void> {
    const position = ticket++;
    await this.pg.query(
      `INSERT INTO mt5_deals (account_login, deal_ticket, position_id, time, type, entry, symbol, volume, price, profit)
       VALUES ($1, $2 * 2, $2, $3::timestamptz - interval '1 minute', 0, 0, 'XAUUSD', 1, 4000, 0),
              ($1, $2 * 2 + 1, $2, $3::timestamptz, 1, 1, 'XAUUSD', 1, 4000, $4)`,
      [login, position, closeTimeUtc, net],
    );
  }

  /** Lock a month exactly as Finalize Month does (frozen settlements + payouts). */
  async finalize(month: string): Promise<void> {
    await this.pg.transaction((tx) => freezeMonth({ query: (text, params) => tx.query(text, params) }, month));
  }

  /** Set an IB's rule and switch IB commissions on (they're off by default). */
  async setIbCommission(ibId: string, percent: number, source: "from_company_share" | "additional"): Promise<void> {
    await this.pg.query("UPDATE ibs SET commission_percent = $2, commission_source = $3 WHERE id = $1", [ibId, percent, source]);
    await this.setIbCommissionsEnabled(true);
  }

  async setIbCommissionsEnabled(enabled: boolean): Promise<void> {
    await this.pg.query("UPDATE settings SET ib_commissions_enabled = $1 WHERE id = 1", [enabled]);
  }

  async setSplit(clientId: string, split: SplitPercent): Promise<void> {
    await this.pg.query("UPDATE clients SET split_trader = $2, split_company = $3, split_client = $4 WHERE id = $1", [
      clientId,
      split.trader,
      split.company,
      split.client,
    ]);
  }

  /** Recompute open months, as the app does after a change. `today` decides the current month. */
  async recompute(today = "2026-12"): Promise<string[]> {
    return this.pg.transaction(async (tx) =>
      recomputeMonths({ query: (text, params) => tx.query(text, params) }, { today }),
    );
  }

  ledger() {
    return loadLedger(this.db);
  }

  async dailyAllocations(month: string) {
    const { rows } = await this.pg.query<{ day: string; client_id: string; capital: string; gross: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, client_id, capital::text, gross::text
         FROM daily_allocations WHERE month = $1 ORDER BY day, client_id`,
      [month],
    );
    return rows;
  }

  async dailyPnl(month: string) {
    const { rows } = await this.pg.query<{ day: string; net: string; pool_capital: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, net::text, pool_capital::text FROM daily_pnl WHERE month = $1 ORDER BY day`,
      [month],
    );
    return rows;
  }

  close(): Promise<void> {
    return this.pg.close();
  }
}
