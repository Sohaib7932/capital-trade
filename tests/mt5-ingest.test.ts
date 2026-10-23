import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sumMoney } from "@/lib/calculations";
import { ingestMt5, ingestSchema, serverTimeToUtc, type IngestPayload } from "@/server/ingest";
import { createTestDb, type TestDb } from "./helpers/db";
import { buildFakePayload, FAKE_BROKER_OFFSET_MINUTES } from "./fixtures/mt5-deals";

const LOGIN = 7001234;
const SERVER = "Broker-Live";
const MONTH = "2026-11";
const LOCKED = "2026-10";
const NOW = new Date("2026-11-20T12:00:00Z");

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
  await db.pg.query(
    "INSERT INTO mt5_accounts (label, login, server, broker_timezone_offset_minutes) VALUES ('Main pool', $1, $2, $3)",
    [LOGIN, SERVER, FAKE_BROKER_OFFSET_MINUTES],
  );
  await db.client("A");
  await db.deposit("A", "10000.00", "2026-09-01");
});
afterEach(() => db.close());

/** Validate like the API does, then ingest inside a transaction. */
function ingest(payload: unknown) {
  const parsed = ingestSchema.parse(payload);
  return db.pg.transaction((tx) => ingestMt5({ query: (text, params) => tx.query(text, params) }, parsed, NOW));
}

const payload = (extra: Partial<Parameters<typeof buildFakePayload>[0]> = {}) =>
  buildFakePayload({ login: LOGIN, server: SERVER, month: MONTH, ...extra });

describe("MT5 ingest", () => {
  it("is idempotent: resending the same window changes nothing", async () => {
    const first = await ingest(payload());
    expect(first).toMatchObject({ inserted: 7, updated: 0, ignored: 1, cashEvents: { inserted: 3, updated: 0, ignored: 0 }, positions: 1 });
    expect(first.recomputedMonths).toEqual([MONTH]);

    const again = await ingest(payload());
    expect(again).toMatchObject({ inserted: 0, updated: 0, ignored: 8, cashEvents: { inserted: 0, updated: 0, ignored: 3 } });
    expect(again.recomputedMonths).toEqual([]);

    const { rows } = await db.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM mt5_deals WHERE account_login = $1", [LOGIN]);
    expect(rows[0].n).toBe(7);
  });

  it("updates a deal the broker corrected, and recalculates", async () => {
    await ingest(payload());
    const corrected = payload();
    corrected.deals[1] = { ...corrected.deals[1], profit: "1100.00" };
    const result = await ingest(corrected);
    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    expect((await db.ledger()).monthlySplit(MONTH).netProfit).toBe("1325.80");
  });

  it("counts lots from opening deals only and profit from every trading deal", async () => {
    await ingest(payload());
    const days = await db.pg.query<{ day: string; net: string; lots: string; trades: number }>(
      "SELECT to_char(day, 'YYYY-MM-DD') AS day, net::text, lots::text, trades FROM daily_pnl WHERE month = $1 ORDER BY day",
      [MONTH],
    );
    expect(days.rows).toEqual([
      { day: `${MONTH}-03`, net: "982.80", lots: "2.00", trades: 1 },
      { day: `${MONTH}-04`, net: "194.75", lots: "1.00", trades: 1 },
      { day: `${MONTH}-05`, net: "-51.75", lots: "0.00", trades: 1 },
      { day: `${MONTH}-06`, net: "100.00", lots: "1.00", trades: 1 },
    ]);

    // The partially closed sell is one trade of 1.00 lot, not 2.00.
    const trade = await db.pg.query<{ lots: string; profit: string; commission: string; type: string }>(
      "SELECT lots::text, profit::text, commission::text, type FROM trades WHERE ticket = 502",
    );
    expect(trade.rows[0]).toEqual({ lots: "1.00", profit: "150.00", commission: "-7.00", type: "sell" });
  });

  it("keeps balance operations out of trading profit", async () => {
    await ingest(payload());
    const split = (await db.ledger()).monthlySplit(MONTH);
    expect(split.netProfit).toBe("1225.80"); // the 51,250 of deposits/credit/bonus is not here
    expect(sumMoney([split.trader, split.company, split.client, split.ib])).toBe(split.netProfit);

    const cash = await db.pg.query<{ kind: string; amount: string }>(
      "SELECT kind, amount::text FROM account_cash_events ORDER BY deal_ticket",
    );
    expect(cash.rows).toEqual([
      { kind: "balance", amount: "50000.00" },
      { kind: "credit", amount: "1000.00" },
      { kind: "bonus", amount: "250.00" },
    ]);
    // …and never becomes a client transaction.
    const txns = await db.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM transactions");
    expect(txns.rows[0].n).toBe(1);
  });

  it("converts broker server time to UTC with the account's offset", async () => {
    expect(serverTimeToUtc(Date.UTC(2026, 10, 6, 1, 30) / 1000, undefined, 180)).toBe("2026-11-05T22:30:00.000Z");
    await ingest(payload());
    const { rows } = await db.pg.query<{ utc: string }>(
      `SELECT to_char(time AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS utc FROM mt5_deals WHERE deal_ticket = 9006`,
    );
    expect(rows[0].utc).toBe(`${MONTH}-05 22:30`);
    // …which is Nov 6 in Karachi, so it lands on day 06 (see the lots test).
  });

  it("stores deals for a finalized month without changing its totals, and warns", async () => {
    await db.trade(`${LOCKED}-15T09:00:00Z`, "300.00");
    await db.recompute(MONTH);
    await db.finalize(LOCKED);
    const before = (await db.ledger()).monthlySplit(LOCKED);

    const result = await ingest(payload({ lockedMonth: LOCKED }));
    expect(result.warnings.some((w) => w.includes(LOCKED))).toBe(true);
    expect(result.recomputedMonths).toEqual([MONTH]);

    const after = (await db.ledger()).monthlySplit(LOCKED);
    expect(after.netProfit).toBe(before.netProfit);
    expect(after.rows).toEqual(before.rows);

    const warnings = await db.pg.query<{ kind: string; month: string; occurrences: number }>(
      "SELECT kind, month, occurrences FROM sync_warnings WHERE resolved_at IS NULL",
    );
    expect(warnings.rows).toEqual([{ kind: "finalized_month_deals", month: LOCKED, occurrences: 2 }]);

    // Resending the same deals doesn't pile up more warnings.
    await ingest(payload({ lockedMonth: LOCKED }));
    const again = await db.pg.query<{ occurrences: number }>("SELECT occurrences FROM sync_warnings WHERE kind = 'finalized_month_deals'");
    expect(again.rows[0].occurrences).toBe(2);
  });

  it("replaces the open positions snapshot and updates the account", async () => {
    await ingest(payload());
    const noPositions: IngestPayload = { ...payload(), positions: [] };
    await ingest(noPositions);
    const pos = await db.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM mt5_positions");
    expect(pos.rows[0].n).toBe(0);
    const acc = await db.pg.query<{ balance: string; equity: string; floating_pl: string; last_sync_status: string }>(
      "SELECT balance::text, equity::text, floating_pl::text, last_sync_status FROM mt5_accounts WHERE login = $1",
      [LOGIN],
    );
    expect(acc.rows[0]).toEqual({ balance: "60000.00", equity: "61000.00", floating_pl: "1000.00", last_sync_status: "ok" });
  });

  it("warns when the broker's clock offset no longer matches the setting", async () => {
    const result = await ingest(payload({ detectedOffsetMinutes: 120 }));
    expect(result.warnings.some((w) => w.includes("UTC+2h"))).toBe(true);
  });

  it("refuses unknown accounts and server mismatches", async () => {
    await expect(ingest(buildFakePayload({ login: 999, server: SERVER, month: MONTH }))).rejects.toThrow(/isn't registered/);
    await expect(ingest(buildFakePayload({ login: LOGIN, server: "Other-Server", month: MONTH }))).rejects.toThrow(/Server mismatch/);
  });

  it("gives all of a client-linked account's profit to that client", async () => {
    await db.client("B");
    await db.pg.query("UPDATE mt5_accounts SET linked_client_id = 'B' WHERE login = $1", [LOGIN]);
    await ingest(payload());
    const split = (await db.ledger()).monthlySplit(MONTH);
    const b = split.rows.find((r) => r.clientId === "B");
    expect(b?.grossProfit).toBe("1225.80");
    // A is in the pool, but the pool itself made nothing this month.
    expect(split.rows.find((r) => r.clientId === "A")?.grossProfit).toBe("0.00");
  });
});
