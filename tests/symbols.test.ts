import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GOLD_SYMBOLS, isGoldSymbol, normalizeSymbol } from "@/lib/symbols";
import { recomputeMonths } from "@/server/allocations";
import { ingestMt5, ingestSchema } from "@/server/ingest";
import { buildFakePayload, FAKE_BROKER_OFFSET_MINUTES } from "./fixtures/mt5-deals";
import { createTestDb, type TestDb } from "./helpers/db";

describe("gold symbol matching", () => {
  it.each([
    "XAUUSD",
    "xauusd",
    " XauUsd ",
    "XAUUSDm",
    "xauusdm",
    "XAUUSDc",
    "XAUUSD.r",
    "xauusd.pro",
    "XAUUSD-ECN",
    "XAUUSD_i",
    "XAUUSD#",
    "GOLD",
    "gold",
    "GOLD.pro",
    "GOLDm",
  ])("%s is gold", (symbol) => expect(isGoldSymbol(symbol)).toBe(true));

  it.each(["EURUSD", "XAGUSD", "XAUEUR", "GOLDEUR", "XAUUSDPRO", "", "XAU", "US30"])("%s is not gold", (symbol) =>
    expect(isGoldSymbol(symbol)).toBe(false),
  );

  it("uses the configured list, case-insensitively", () => {
    expect(isGoldSymbol("xauusd", ["xauusd"])).toBe(true);
    expect(isGoldSymbol("XAUEUR.r", ["XAUEUR"])).toBe(true);
    expect(isGoldSymbol("GOLD", ["XAUUSD"])).toBe(false);
    expect(DEFAULT_GOLD_SYMBOLS).toEqual(["XAUUSD", "GOLD"]);
  });

  it("normalizes to upper case", () => expect(normalizeSymbol(" xauusd.r ")).toBe("XAUUSD.R"));
});

const LOGIN = 800223736;
const SERVER = "ECMarketsLtd-Demo";
const MONTH = "2026-11";
const NOW = new Date("2026-11-20T12:00:00Z");

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
  await db.pg.query(
    "INSERT INTO mt5_accounts (label, login, server, broker_timezone_offset_minutes) VALUES ('EC Markets', $1, $2, $3)",
    [LOGIN, SERVER, FAKE_BROKER_OFFSET_MINUTES],
  );
  await db.client("A");
  await db.deposit("A", "10000.00", "2026-09-01");
});
afterEach(() => db.close());

function ingest(payload: unknown) {
  const parsed = ingestSchema.parse(payload);
  return db.pg.transaction((tx) => ingestMt5({ query: (text, params) => tx.query(text, params) }, parsed, NOW));
}

/** The fixture month (+1,225.80 net, 4.00 lots), with every symbol replaced. */
function payloadWith(symbol: (position: number) => string) {
  const p = buildFakePayload({ login: LOGIN, server: SERVER, month: MONTH });
  p.deals = p.deals.map((d) => (d.symbol ? { ...d, symbol: symbol(d.position_id) } : d));
  p.positions = p.positions.map((x) => ({ ...x, symbol: symbol(x.ticket) }));
  return p;
}

async function symbolsStored() {
  const { rows } = await db.pg.query<{ symbol: string }>("SELECT DISTINCT symbol FROM mt5_deals WHERE account_login = $1 ORDER BY 1", [LOGIN]);
  return rows.map((r) => r.symbol);
}

async function tradesView() {
  const { rows } = await db.pg.query<{ ticket: string; symbol: string; lots: string }>(
    "SELECT ticket::text, symbol, lots::text FROM trades WHERE account_login = $1 ORDER BY ticket",
    [LOGIN],
  );
  return rows;
}

describe("symbols in ingest and profit", () => {
  it("accepts a broker's lower-case gold symbol, stores and shows it upper-case, and counts it", async () => {
    const result = await ingest(payloadWith(() => "xauusd"));
    expect(result.warnings).toEqual([]);
    expect(await symbolsStored()).toEqual(["XAUUSD"]);
    expect((await tradesView()).map((t) => t.symbol)).toEqual(["XAUUSD", "XAUUSD", "XAUUSD"]);
    const { rows } = await db.pg.query<{ symbol: string }>("SELECT symbol FROM mt5_positions WHERE account_login = $1", [LOGIN]);
    expect(rows.map((r) => r.symbol)).toEqual(["XAUUSD"]);

    const split = (await db.ledger()).monthlySplit(MONTH);
    expect(split.netProfit).toBe("1225.80");
  });

  it("is idempotent across case: resending as upper-case changes nothing", async () => {
    await ingest(payloadWith(() => "xauusd"));
    const again = await ingest(payloadWith(() => "XAUUSD"));
    expect(again).toMatchObject({ inserted: 0, updated: 0 });
  });

  it("matches broker suffixes", async () => {
    await ingest(payloadWith((pos) => (pos === 501 ? "XAUUSDm" : pos === 502 ? "xauusd.r" : "GOLD.pro")));
    expect(await symbolsStored()).toEqual(["GOLD.PRO", "XAUUSD.R", "XAUUSDM"]);
    expect((await db.ledger()).monthlySplit(MONTH).netProfit).toBe("1225.80");
  });

  it("stores other symbols but never counts them, and warns", async () => {
    // Position 501 (+982.80, 2 lots) on EURUSD; the rest gold.
    const result = await ingest(payloadWith((pos) => (pos === 501 ? "eurusd" : "xauusd")));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("EURUSD");

    expect(await symbolsStored()).toEqual(["EURUSD", "XAUUSD"]);
    expect((await tradesView()).map((t) => t.ticket)).toEqual(["502", "503"]);
    const split = (await db.ledger()).monthlySplit(MONTH);
    expect(split.netProfit).toBe("243.00"); // 1,225.80 − 982.80
    const { rows } = await db.pg.query<{ lots: string }>("SELECT sum(lots)::text AS lots FROM daily_pnl WHERE month = $1", [MONTH]);
    expect(rows[0].lots).toBe("2.00");

    const warnings = await db.pg.query<{ kind: string; occurrences: number }>("SELECT kind, occurrences FROM sync_warnings");
    expect(warnings.rows).toEqual([{ kind: "non_gold_symbols", occurrences: 2 }]);
  });

  it("counts a symbol once it's added to the gold symbols setting", async () => {
    await ingest(payloadWith((pos) => (pos === 501 ? "XAUEUR" : "xauusd")));
    expect((await db.ledger()).monthlySplit(MONTH).netProfit).toBe("243.00");

    await db.pg.query("UPDATE settings SET gold_symbols = ARRAY['XAUUSD', 'GOLD', 'XAUEUR'] WHERE id = 1");
    await recomputeMonths(db.db, { today: MONTH });
    expect((await db.ledger()).monthlySplit(MONTH).netProfit).toBe("1225.80");
    expect(await tradesView()).toHaveLength(3);
  });

  it("matches in SQL exactly as in TypeScript", async () => {
    const samples = ["XAUUSD", "xauusd", "XAUUSDm", "XAUUSD.r", "xauusd.pro", "GOLD", "GOLDm", "EURUSD", "XAUEUR", "GOLDEUR", "XAUUSDPRO", ""];
    const { rows } = await db.pg.query<{ symbol: string; gold: boolean }>(
      "SELECT s AS symbol, is_gold_symbol(s, gold_symbols()) AS gold FROM unnest($1::text[]) s",
      [samples],
    );
    expect(rows).toEqual(samples.map((symbol) => ({ symbol, gold: isGoldSymbol(symbol) })));
  });

  it("keeps seeded demo trades when a real account syncs", async () => {
    await db.pg.query("INSERT INTO mt5_accounts (id, label, login, server, is_demo) VALUES ('mt5-demo', 'Demo data', 0, 'demo', true)");
    await ingest(payloadWith(() => "xauusd"));
    const { rows } = await db.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM mt5_accounts WHERE is_demo");
    expect(rows[0].n).toBe(1);
  });
});
