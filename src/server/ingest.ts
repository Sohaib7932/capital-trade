import Decimal from "decimal.js";
import { z } from "zod";
import { monthOf, toISODate } from "@/lib/dates";
import { cashKind, DEAL_TYPE } from "@/lib/mt5";
import { isGoldSymbol, normalizeSymbol } from "@/lib/symbols";
import type { IngestCounts, IngestResult, MonthKey } from "@/lib/types";
import { recomputeMonths, type Queryable } from "./allocations";
import { badRequest, conflict, notFound } from "./errors";

// --- Payload --------------------------------------------------------------------

/** MT5 sends doubles; parse them as exact decimals at a fixed scale. */
const decimal = (places: number) =>
  z
    .union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/)])
    .transform((v) => new Decimal(String(v)).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places));
const money = decimal(2);
const ticket = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Seconds since 1970 in *broker server time* (as MT5 reports it). */
const serverSeconds = z.number().int().nonnegative();

const dealSchema = z.object({
  ticket,
  order: ticket.optional(),
  position_id: ticket.default(0),
  time: serverSeconds,
  time_msc: z.number().int().nonnegative().optional(),
  type: z.number().int().min(0).max(30),
  entry: z.number().int().min(0).max(3),
  symbol: z.string().max(64).default(""),
  volume: decimal(2).default("0.00"),
  price: decimal(5).default("0.00000"),
  profit: money.default("0.00"),
  swap: money.default("0.00"),
  commission: money.default("0.00"),
  fee: money.default("0.00"),
  magic: z.number().int().optional(),
  comment: z.string().max(255).optional(),
});

const positionSchema = z.object({
  ticket,
  symbol: z.string().min(1).max(64),
  type: z.union([z.literal(0), z.literal(1)]),
  volume: decimal(2),
  time: serverSeconds,
  price_open: decimal(5),
  price_current: decimal(5),
  profit: money,
  swap: money.default("0.00"),
});

export const ingestSchema = z.object({
  account_login: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  server: z.string().trim().min(1).max(100),
  account: z.object({ balance: money, equity: money, margin: money, profit: money }),
  positions: z.array(positionSchema).max(10_000),
  deals: z.array(dealSchema).max(200_000),
  /** Broker offset from UTC the worker measured from a fresh tick; null when the market is closed. */
  detected_utc_offset_minutes: z.number().int().min(-720).max(840).nullable().optional(),
  worker_version: z.string().max(40).optional(),
});

export type IngestPayload = z.infer<typeof ingestSchema>;

// --- Helpers -----------------------------------------------------------------------

/** Broker server time → UTC ISO, using the account's offset. Millisecond precision when available. */
export function serverTimeToUtc(seconds: number, millis: number | undefined, offsetMinutes: number): string {
  const ms = (millis ?? seconds * 1000) - offsetMinutes * 60_000;
  return new Date(ms).toISOString();
}

interface AccountRow {
  login: string;
  server: string;
  broker_timezone_offset_minutes: number;
  is_active: boolean;
  is_demo: boolean;
  label: string;
}

async function upsertWarning(db: Queryable, login: number, kind: string, month: string, message: string, occurrences: number) {
  await db.query(
    `INSERT INTO sync_warnings (account_login, kind, month, message, occurrences) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (account_login, kind, month) WHERE resolved_at IS NULL
     DO UPDATE SET occurrences = sync_warnings.occurrences + EXCLUDED.occurrences, last_seen_at = now(), message = EXCLUDED.message`,
    [login, kind, month, message, occurrences],
  );
}

function counts(total: number, returned: { inserted: boolean }[]): IngestCounts {
  const inserted = returned.filter((r) => r.inserted).length;
  return { inserted, updated: returned.length - inserted, ignored: total - returned.length };
}

// --- Ingest ------------------------------------------------------------------------

/**
 * Save one account's MT5 snapshot. Idempotent: deals are upserted by
 * (account_login, deal_ticket) and unchanged deals are ignored, so the worker
 * can safely resend overlapping windows. Run inside a transaction.
 *
 * - BUY/SELL deals → `mt5_deals` (trading P/L). Symbols are stored upper-case; only
 *   gold symbols (Settings → MT5 Connection) count as profit, others raise a warning.
 * - Balance operations (deposits, credit, bonus, charges, …) → `account_cash_events`,
 *   never trading profit, never client transactions.
 * - Open positions replace the account's previous snapshot.
 * - Open months touched by new/changed deals are recalculated. Deals that land
 *   in a finalized month are stored but change nothing; a warning is raised.
 */
export async function ingestMt5(db: Queryable, payload: IngestPayload, now: Date = new Date()): Promise<IngestResult> {
  const { rows: accounts } = await db.query<AccountRow>(
    `SELECT login::text, server, broker_timezone_offset_minutes, is_active, is_demo, label
       FROM mt5_accounts WHERE login = $1 FOR UPDATE`,
    [payload.account_login],
  );
  const account = accounts[0];
  if (!account) {
    throw notFound(`MT5 account ${payload.account_login} isn't registered. Add it in Settings → MT5 Connection first.`);
  }
  if (account.is_demo) throw badRequest("That login belongs to the demo data account");
  if (!account.is_active) throw conflict(`MT5 account ${payload.account_login} is paused in Settings`);
  if (account.server.trim().toLowerCase() !== payload.server.trim().toLowerCase()) {
    throw badRequest(`Server mismatch: the worker sent "${payload.server}", Settings has "${account.server}"`);
  }
  const offset = account.broker_timezone_offset_minutes;
  const login = payload.account_login;
  const warnings: string[] = [];

  // Split deals into trading deals, cash events and ignored (cancelled) ones.
  const trading = payload.deals.filter((d) => d.type === DEAL_TYPE.BUY || d.type === DEAL_TYPE.SELL);
  const cash = payload.deals.filter((d) => d.type > DEAL_TYPE.SELL && cashKind(d.type) !== null);
  const skipped = payload.deals.length - trading.length - cash.length;

  // 1. Trading deals. Only new or changed rows come back from RETURNING.
  const { rows: dealRows } = await db.query<{ inserted: boolean; month: string; symbol: string }>(
    `INSERT INTO mt5_deals AS d (account_login, deal_ticket, order_ticket, position_id, time, type, entry, symbol, volume,
                                 price, profit, swap, commission, fee, magic, comment)
     SELECT $1, ticket, order_ticket, position_id, time, type, entry, symbol, volume, price, profit, swap, commission, fee, magic, comment
       FROM jsonb_to_recordset($2::jsonb) AS t(ticket bigint, order_ticket bigint, position_id bigint, time timestamptz,
            type smallint, entry smallint, symbol text, volume numeric, price numeric, profit numeric, swap numeric,
            commission numeric, fee numeric, magic bigint, comment text)
     ON CONFLICT (account_login, deal_ticket) DO UPDATE SET
       order_ticket = EXCLUDED.order_ticket, position_id = EXCLUDED.position_id, time = EXCLUDED.time, type = EXCLUDED.type,
       entry = EXCLUDED.entry, symbol = EXCLUDED.symbol, volume = EXCLUDED.volume, price = EXCLUDED.price,
       profit = EXCLUDED.profit, swap = EXCLUDED.swap, commission = EXCLUDED.commission, fee = EXCLUDED.fee,
       magic = EXCLUDED.magic, comment = EXCLUDED.comment, updated_at = now()
     WHERE (d.position_id, d.time, d.type, d.entry, d.symbol, d.volume, d.price, d.profit, d.swap, d.commission, d.fee)
           IS DISTINCT FROM
           (EXCLUDED.position_id, EXCLUDED.time, EXCLUDED.type, EXCLUDED.entry, EXCLUDED.symbol, EXCLUDED.volume,
            EXCLUDED.price, EXCLUDED.profit, EXCLUDED.swap, EXCLUDED.commission, EXCLUDED.fee)
     RETURNING (xmax = 0) AS inserted, d.symbol,
               to_char(d.time AT TIME ZONE (SELECT business_timezone FROM settings WHERE id = 1), 'YYYY-MM') AS month`,
    [
      login,
      JSON.stringify(
        trading.map((d) => ({
          ticket: d.ticket,
          order_ticket: d.order ?? null,
          position_id: d.position_id,
          time: serverTimeToUtc(d.time, d.time_msc, offset),
          type: d.type,
          entry: d.entry,
          symbol: normalizeSymbol(d.symbol),
          volume: d.volume,
          price: d.price,
          profit: d.profit,
          swap: d.swap,
          commission: d.commission,
          fee: d.fee,
          magic: d.magic ?? null,
          comment: d.comment ?? null,
        })),
      ),
    ],
  );
  const dealCounts = counts(trading.length, dealRows);

  // 2. Balance operations, kept apart from trading profit for review.
  const { rows: cashRows } = await db.query<{ inserted: boolean }>(
    `INSERT INTO account_cash_events AS c (account_login, deal_ticket, time, deal_type, kind, amount, comment)
     SELECT $1, ticket, time, deal_type, kind, amount, comment
       FROM jsonb_to_recordset($2::jsonb) AS t(ticket bigint, time timestamptz, deal_type smallint, kind text, amount numeric, comment text)
     ON CONFLICT (account_login, deal_ticket) DO UPDATE SET
       time = EXCLUDED.time, deal_type = EXCLUDED.deal_type, kind = EXCLUDED.kind, amount = EXCLUDED.amount, comment = EXCLUDED.comment
     WHERE (c.time, c.deal_type, c.amount, c.comment) IS DISTINCT FROM (EXCLUDED.time, EXCLUDED.deal_type, EXCLUDED.amount, EXCLUDED.comment)
     RETURNING (xmax = 0) AS inserted`,
    [
      login,
      JSON.stringify(
        cash.map((d) => ({
          ticket: d.ticket,
          time: serverTimeToUtc(d.time, d.time_msc, offset),
          deal_type: d.type,
          kind: cashKind(d.type),
          // A balance deal's amount is in `profit`; costs may also show in commission/fee.
          amount: new Decimal(d.profit).plus(d.commission).plus(d.fee).plus(d.swap).toFixed(2),
          comment: d.comment ?? null,
        })),
      ),
    ],
  );

  // 3. Open positions: replace the snapshot.
  await db.query("DELETE FROM mt5_positions WHERE account_login = $1", [login]);
  if (payload.positions.length) {
    await db.query(
      `INSERT INTO mt5_positions (account_login, ticket, symbol, type, volume, open_time, open_price, current_price, profit, swap)
       SELECT $1, ticket, symbol, type, volume, open_time, open_price, current_price, profit, swap
         FROM jsonb_to_recordset($2::jsonb) AS t(ticket bigint, symbol text, type text, volume numeric, open_time timestamptz,
              open_price numeric, current_price numeric, profit numeric, swap numeric)`,
      [
        login,
        JSON.stringify(
          payload.positions.map((p) => ({
            ticket: p.ticket,
            symbol: normalizeSymbol(p.symbol),
            type: p.type === 0 ? "buy" : "sell",
            volume: p.volume,
            open_time: serverTimeToUtc(p.time, undefined, offset),
            open_price: p.price_open,
            current_price: p.price_current,
            profit: p.profit,
            swap: p.swap,
          })),
        ),
      ],
    );
  }

  // 4. Deals on other symbols are stored but never count as pool profit.
  const { rows: goldRows } = await db.query<{ gold: string[] }>("SELECT gold_symbols() AS gold");
  const other = dealRows.filter((r) => !isGoldSymbol(r.symbol, goldRows[0].gold));
  if (other.length) {
    const symbols = [...new Set(other.map((r) => r.symbol || "(none)"))].sort().join(", ");
    const message = `${other.length} deal${other.length === 1 ? "" : "s"} on ${symbols} didn't count as pool profit: not a gold symbol. Add it under Gold symbols in Settings → MT5 Connection if it should count.`;
    warnings.push(message);
    await upsertWarning(db, login, "non_gold_symbols", "", message, other.length);
  }

  // 5. Recalculate open months touched by new/changed deals; never touch finalized ones.
  const touched = new Map<MonthKey, number>();
  for (const r of dealRows) touched.set(r.month, (touched.get(r.month) ?? 0) + 1);
  const { rows: statuses } = await db.query<{ month: string; status: string }>(
    "SELECT month, status FROM months WHERE month = ANY($1::text[])",
    [[...touched.keys()]],
  );
  const finalized = new Set(statuses.filter((s) => s.status === "finalized").map((s) => s.month));
  for (const month of finalized) {
    const n = touched.get(month)!;
    const message = `${n} new or changed deal${n === 1 ? "" : "s"} arrived for ${month}, which is finalized. Its totals were not changed — reopen the month if they should count.`;
    warnings.push(message);
    await upsertWarning(db, login, "finalized_month_deals", month, message, n);
  }
  const today = monthOf(toISODate(now));
  const openMonths = [...touched.keys()].filter((m) => !finalized.has(m));
  const recomputedMonths = openMonths.length ? await recomputeMonths(db, { today, months: openMonths }) : [];

  // 6. Clock check: brokers shift with daylight saving.
  const detected = payload.detected_utc_offset_minutes;
  if (detected !== undefined && detected !== null && detected !== offset) {
    const message = `The broker clock is UTC${detected >= 0 ? "+" : ""}${detected / 60}h but this account is set to UTC${offset >= 0 ? "+" : ""}${offset / 60}h. Update the offset in Settings → MT5 Connection (daylight saving?).`;
    warnings.push(message);
    await upsertWarning(db, login, "offset_mismatch", "", message, 1);
  }

  // 7. Account status.
  await db.query(
    `UPDATE mt5_accounts SET balance = $2, equity = $3, margin = $4, floating_pl = $5, last_sync_at = $6,
            last_sync_status = 'ok', last_error = NULL, detected_offset_minutes = $7
      WHERE login = $1`,
    [
      login,
      payload.account.balance,
      payload.account.equity,
      payload.account.margin,
      payload.account.profit,
      now.toISOString(),
      detected ?? null,
    ],
  );

  return {
    ...dealCounts,
    ignored: dealCounts.ignored + skipped,
    cashEvents: counts(cash.length, cashRows),
    positions: payload.positions.length,
    recomputedMonths,
    warnings,
  };
}

/** Record a failed sync reported by the worker (e.g. MT5 login failed). */
export async function recordSyncError(db: Queryable, login: number, message: string): Promise<boolean> {
  const { rows } = await db.query<{ login: string }>(
    "UPDATE mt5_accounts SET last_sync_status = 'error', last_error = $2 WHERE login = $1 RETURNING login::text",
    [login, message.slice(0, 1000)],
  );
  return rows.length > 0;
}
