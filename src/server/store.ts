import Decimal from "decimal.js";
import { formatCurrency, isValidSplit, percentChange, toDecimal, toMoney } from "@/lib/calculations";
import { formatMonth, monthOf, toISODate } from "@/lib/dates";
import { syncHealth } from "@/lib/mt5";
import { normalizeSymbol } from "@/lib/symbols";
import type {
  ClientDetail,
  CreateClientInput,
  DailyPerformance,
  GoldSpot,
  IB,
  IBCommissionSource,
  IBInput,
  LossHandling,
  MonthKey,
  MonthlySplit,
  PartyType,
  Payout,
  Settings,
  SettingsUpdate,
  SplitPercent,
  Trade,
  TradeFilters,
  TradePage,
  TradeQuery,
  TradeSortKey,
  TradeSummary,
  Transaction,
  TransactionInput,
  UpdateClientInput,
  UpdateIBInput,
} from "@/lib/types";
import { recomputeMonths, type Queryable } from "./allocations";
import { audit, diff } from "./audit";
import { hashPassword, verifyPassword, type SessionUser } from "./auth";
import { pool, transaction } from "./db";
import { badRequest, conflict, notFound } from "./errors";
import {
  Ledger,
  payoutKey,
  type ClientRecord,
  type FrozenMonth,
  type MonthClientAllocation,
  type MonthPool,
  type MonthRecord,
  type PayoutRecord,
  type SettlementRecord,
  type Snapshot,
} from "./ledger";

// --- Row mapping -------------------------------------------------------------

/** JSON can't carry NUMERIC exactly, so money is sent as text; timestamps as UTC ISO strings. */
const utc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const TZ = "(SELECT business_timezone FROM settings WHERE id = 1)";

const TRADE_JSON = `ticket, symbol, type, lots::text AS lots, ${utc("open_time")} AS "openTime",
  ${utc("close_time")} AS "closeTime", open_price::text AS "openPrice", close_price::text AS "closePrice",
  profit::text AS profit, swap::text AS swap, commission::text AS commission`;

interface SplitColumns {
  split_trader: string;
  split_company: string;
  split_client: string;
}

function toSplit(row: SplitColumns): SplitPercent {
  return { trader: Number(row.split_trader), company: Number(row.split_company), client: Number(row.split_client) };
}

const orUndefined = <T>(v: T | null): T | undefined => v ?? undefined;
const thisMonth = () => monthOf(toISODate(new Date()));

// --- Snapshot ----------------------------------------------------------------

/** Overall MT5 state from `mt5_accounts` (real accounts only). */
const MT5_SUMMARY_SQL = `(SELECT row_to_json(r) FROM (
     SELECT count(*) FILTER (WHERE is_active AND NOT is_demo)::int AS accounts,
            to_char(max(last_sync_at) FILTER (WHERE is_active AND NOT is_demo) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_sync_at,
            COALESCE(bool_or(is_active AND NOT is_demo AND last_sync_status = 'error'), false) AS any_error,
            COALESCE(bool_or(is_demo), false) AS demo,
            (SELECT count(*)::int FROM sync_warnings WHERE resolved_at IS NULL) AS open_warnings
       FROM mt5_accounts) r)`;

/**
 * Everything the ledger needs, in one round-trip. Day-level work is already
 * done in SQL (daily_pnl / daily_allocations); this reads per-month sums, plus
 * the frozen settlement rows of finalized months.
 */
const SNAPSHOT_SQL = `
SELECT
  (SELECT COALESCE(json_agg(r ORDER BY r.code), '[]') FROM (
     SELECT id, code, name, phone, email, status, joined_at AS "joinedAt", notes,
            commission_percent::text, commission_source FROM ibs) r) AS ibs,
  (SELECT COALESCE(json_agg(r ORDER BY r.code), '[]') FROM (
     SELECT id, code, full_name AS "fullName", phone, email, ib_id AS "ibId", joined_at AS "joinedAt", status,
            split_trader::text, split_company::text, split_client::text, notes FROM clients) r) AS clients,
  (SELECT COALESCE(json_agg(r ORDER BY r.date, r.id), '[]') FROM (
     SELECT id, client_id AS "clientId", type, amount::text AS amount, date, note FROM transactions) r) AS transactions,
  (SELECT COALESCE(json_agg(r), '[]') FROM (
     SELECT month, status, finalized_at, net_profit::text, total_capital::text, trading_days, lots::text, trades,
            company_adjustment::text, loss_handling FROM months) r) AS months,
  (SELECT COALESCE(json_agg(r), '[]') FROM (
     SELECT month, party_type, party_id, amount::text, status, paid_at FROM payouts) r) AS payouts,
  (SELECT COALESCE(json_agg(r), '[]') FROM (
     SELECT month, sum(net)::text AS net, sum(lots)::text AS lots, sum(trades)::int AS trades,
            count(*)::int AS "tradingDays", sum(pool_capital)::text AS "capitalDays"
       FROM daily_pnl GROUP BY month) r) AS pools,
  (SELECT COALESCE(json_agg(r), '[]') FROM (
     SELECT month, client_id AS "clientId", sum(gross)::text AS gross, sum(capital)::text AS "capitalDays",
            count(*)::int AS "activeDays"
       FROM daily_allocations GROUP BY month, client_id) r) AS allocations,
  (SELECT COALESCE(json_agg(r), '[]') FROM (
     SELECT month, client_id, ib_id, capital::text, pool_share::text, active_days, split_trader::text,
            split_company::text, split_client::text, ib_percent::text, ib_source, gross::text, carry_in::text,
            carry_out::text, trader::text, company::text, client::text, ib::text FROM settlements) r) AS settlements,
  (SELECT row_to_json(r) FROM (
     SELECT split_trader::text, split_company::text, split_client::text, loss_handling, business_timezone, gold_symbols,
            ib_commissions_enabled, sync_interval_seconds
       FROM settings WHERE id = 1) r) AS settings,
  ${MT5_SUMMARY_SQL} AS mt5`;

type IBRow = Omit<IB, "commission" | "notes"> & { notes: string | null; commission_percent: string; commission_source: IBCommissionSource };

function toIB({ commission_percent, commission_source, notes, ...r }: IBRow): IB {
  return { ...r, notes: orUndefined(notes), commission: { percent: Number(commission_percent), source: commission_source } };
}

interface SnapshotRow {
  ibs: IBRow[];
  clients: (Omit<ClientRecord, "split" | "notes"> & SplitColumns & { notes: string | null })[];
  transactions: (Omit<Transaction, "locked" | "note"> & { note: string | null })[];
  months: {
    month: string;
    status: MonthRecord["status"];
    finalized_at: string | null;
    net_profit: string | null;
    total_capital: string | null;
    trading_days: number | null;
    lots: string | null;
    trades: number | null;
    company_adjustment: string | null;
    loss_handling: LossHandling | null;
  }[];
  payouts: { month: string; party_type: PartyType; party_id: string; amount: string | null; status: PayoutRecord["status"]; paid_at: string | null }[];
  pools: (MonthPool & { month: string })[];
  allocations: (MonthClientAllocation & { month: string })[];
  settlements: ({
    month: string;
    client_id: string;
    ib_id: string | null;
    capital: string;
    pool_share: string;
    active_days: number;
    ib_percent: string;
    ib_source: IBCommissionSource;
    gross: string;
    carry_in: string;
    carry_out: string;
    trader: string;
    company: string;
    client: string;
    ib: string;
  } & SplitColumns)[];
  settings: SettingsRow | null;
  mt5: Mt5SummaryRow;
}

export async function loadLedger(db: Queryable = pool()): Promise<Ledger> {
  const now = new Date();
  const currentMonth = monthOf(toISODate(now));
  const { rows } = await db.query<SnapshotRow>(SNAPSHOT_SQL);
  const data = rows[0];
  const settings = toSettings(data.settings, data.mt5, now);

  const months: Snapshot["months"] = {};
  for (const r of data.months) {
    const frozen: FrozenMonth | undefined =
      r.status === "finalized" && r.net_profit !== null
        ? {
            netProfit: r.net_profit,
            totalCapital: r.total_capital ?? "0.00",
            tradingDays: r.trading_days ?? 0,
            lots: r.lots ?? "0.00",
            trades: r.trades ?? 0,
            companyAdjustment: r.company_adjustment ?? "0.00",
            lossHandling: r.loss_handling ?? settings.lossHandling,
          }
        : undefined;
    months[r.month] = { status: r.status, finalizedAt: orUndefined(r.finalized_at), frozen };
  }
  // The current month is always there, even before it has a row (rows are created on write).
  months[currentMonth] ??= { status: "open" };

  const allocations: Snapshot["allocations"] = {};
  for (const { month, ...a } of data.allocations) (allocations[month] ??= []).push(a);

  const settlements: Snapshot["settlements"] = {};
  for (const r of data.settlements) {
    const record: SettlementRecord = {
      clientId: r.client_id,
      ibId: r.ib_id,
      capital: r.capital,
      poolShare: r.pool_share,
      activeDays: r.active_days,
      split: toSplit(r),
      ibCommission: { percent: Number(r.ib_percent), source: r.ib_source },
      grossProfit: r.gross,
      carryIn: r.carry_in,
      carryOut: r.carry_out,
      trader: r.trader,
      company: r.company,
      client: r.client,
      ib: r.ib,
    };
    (settlements[r.month] ??= []).push(record);
  }

  return new Ledger({
    ibs: data.ibs.map(toIB),
    clients: data.clients.map(({ split_trader, split_company, split_client, notes, ...r }) => ({
      ...r,
      split: toSplit({ split_trader, split_company, split_client }),
      notes: orUndefined(notes),
    })),
    transactions: data.transactions.map((r) => ({ ...r, note: orUndefined(r.note) })),
    months,
    payouts: Object.fromEntries(
      data.payouts.map((r) => [
        payoutKey(r.month, r.party_type, r.party_id),
        { amount: orUndefined(r.amount), status: r.status, paidAt: orUndefined(r.paid_at) },
      ]),
    ),
    pools: Object.fromEntries(data.pools.map(({ month, ...p }) => [month, p])),
    allocations,
    settlements,
    ...settings,
    now,
  });
}

// --- Reads -------------------------------------------------------------------

/** Months that have data, newest first (creating the current month if needed). */
export async function getMonths(): Promise<MonthKey[]> {
  // Read-only: the current month is always listed, even before it has a row.
  const { rows } = await pool().query<{ month: string }>("SELECT month FROM months");
  return [...new Set([thisMonth(), ...rows.map((r) => r.month)])].sort().reverse();
}

function withCumulative(rows: Omit<DailyPerformance, "cumulative">[]): DailyPerformance[] {
  let cumulative = toDecimal(0);
  return rows.map((r) => {
    cumulative = cumulative.plus(r.netProfit);
    return { ...r, cumulative: toMoney(cumulative) };
  });
}

/** Daily pool performance for a month, from `daily_pnl` (frozen for finalized months). */
export async function getDailyPerformance(month: MonthKey): Promise<DailyPerformance[]> {
  const { rows } = await pool().query<Omit<DailyPerformance, "cumulative">>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS date, net::text AS "netProfit", lots::text AS lots, trades
       FROM daily_pnl WHERE month = $1 ORDER BY day`,
    [month],
  );
  return withCumulative(rows);
}

/** Build a WHERE clause for trade filters (close date in the business timezone). */
function tradeWhere(filters: TradeFilters, params: unknown[]): string {
  const where: string[] = [];
  if (filters.type) {
    params.push(filters.type);
    where.push(`type = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    where.push(`close_time >= $${params.length}::date::timestamp AT TIME ZONE ${TZ}`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`close_time < ($${params.length}::date + 1)::timestamp AT TIME ZONE ${TZ}`);
  }
  return where.length ? `WHERE ${where.join(" AND ")}` : "";
}

/** Per-day totals for any trade filter — the Trades calendar view. */
export async function getTradeDays(filters: TradeFilters): Promise<DailyPerformance[]> {
  const params: unknown[] = [];
  const where = tradeWhere(filters, params);
  const { rows } = await pool().query<Omit<DailyPerformance, "cumulative">>(
    `SELECT to_char((close_time AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS date,
            sum(profit + swap + commission)::text AS "netProfit", sum(lots)::text AS lots, count(*)::int AS trades
       FROM trades ${where} GROUP BY 1 ORDER BY 1`,
    params,
  );
  return withCumulative(rows);
}

const TRADE_SORT: Record<TradeSortKey, string> = {
  ticket: "ticket",
  openTime: "open_time",
  closeTime: "close_time",
  type: "type",
  lots: "lots",
  openPrice: "open_price",
  closePrice: "close_price",
  profit: "profit",
  swap: "swap",
  commission: "commission",
  net: "(profit + swap + commission)",
};

/** One page of trades plus totals for the whole filter — sorted, filtered and paged in SQL. */
export async function getTradesPage(query: TradeQuery): Promise<TradePage> {
  const params: unknown[] = [];
  const where = tradeWhere(query, params);
  const order = `${TRADE_SORT[query.sort ?? "closeTime"]} ${query.dir === "asc" ? "ASC" : "DESC"}, ticket DESC`;
  const pageSize = query.pageSize ?? 25;
  params.push(pageSize, (query.page ?? 0) * pageSize);
  const { rows } = await pool().query<{ rows: Trade[] | null; summary: TradeSummary }>(
    `WITH f AS (SELECT * FROM trades ${where})
     SELECT
       (SELECT json_agg(r) FROM (SELECT ${TRADE_JSON} FROM f ORDER BY ${order}
          LIMIT $${params.length - 1} OFFSET $${params.length}) r) AS rows,
       (SELECT row_to_json(s) FROM (
          SELECT count(*)::int AS count, (count(*) FILTER (WHERE type = 'buy'))::int AS buys,
                 COALESCE(sum(lots), 0)::text AS lots, COALESCE(sum(profit), 0)::text AS profit,
                 COALESCE(sum(swap), 0)::text AS swap, COALESCE(sum(commission), 0)::text AS commission,
                 COALESCE(sum(profit + swap + commission), 0)::text AS net
            FROM f) s) AS summary`,
    params,
  );
  return { rows: rows[0].rows ?? [], total: rows[0].summary.count, summary: rows[0].summary };
}

/** The month's last closed trades, newest first. */
export async function getRecentTrades(month: MonthKey, limit = 5): Promise<Trade[]> {
  const { rows } = await pool().query<{ rows: Trade[] | null }>(
    `SELECT json_agg(r) AS rows FROM (
       SELECT ${TRADE_JSON} FROM trades
        WHERE to_char(close_time AT TIME ZONE ${TZ}, 'YYYY-MM') = $1
        ORDER BY close_time DESC LIMIT $2) r`,
    [month, limit],
  );
  return rows[0].rows ?? [];
}

/** Last fill price, and its change against the previous business day's last fill. */
export async function getGoldSpot(): Promise<GoldSpot> {
  const { rows } = await pool().query<{ price: string; previous: string | null; as_of: string }>(
    `WITH last AS (SELECT close_price, close_time FROM trades ORDER BY close_time DESC LIMIT 1)
     SELECT l.close_price::text AS price, l.close_time AS as_of,
            (SELECT t.close_price::text FROM trades t
              WHERE (t.close_time AT TIME ZONE ${TZ})::date < (l.close_time AT TIME ZONE ${TZ})::date
              ORDER BY t.close_time DESC LIMIT 1) AS previous
       FROM last l`,
  );
  const row = rows[0];
  if (!row) return { price: "0.00", changePct: "0.00", asOf: new Date().toISOString() };
  return {
    price: row.price,
    changePct: row.previous ? (percentChange(row.price, row.previous) ?? "0.00") : "0.00",
    asOf: row.as_of,
  };
}

type SettingsRow = SplitColumns & {
  loss_handling: LossHandling;
  business_timezone: string;
  gold_symbols: string[];
  ib_commissions_enabled: boolean;
  sync_interval_seconds: number;
};

interface Mt5SummaryRow {
  accounts: number;
  last_sync_at: string | null;
  any_error: boolean;
  demo: boolean;
  open_warnings: number;
}



function toSettings(row: SettingsRow | null | undefined, mt5: Mt5SummaryRow, now: Date): Omit<Settings, "profile"> {
  if (!row) throw new Error("Settings row missing — run `npm run db:seed`.");
  return {
    defaultSplit: toSplit(row),
    lossHandling: row.loss_handling,
    businessTimezone: row.business_timezone,
    goldSymbols: row.gold_symbols,
    ibCommissionsEnabled: row.ib_commissions_enabled,
    syncIntervalSeconds: row.sync_interval_seconds,
    mt5: {
      accounts: mt5.accounts,
      lastSyncAt: mt5.last_sync_at,
      health: mt5.accounts ? syncHealth(mt5.last_sync_at, mt5.any_error ? "error" : "ok", now) : "none",
      openWarnings: mt5.open_warnings,
      demoData: mt5.demo,
    },
  };
}

async function loadSettingsRow(db: Queryable = pool()): Promise<Omit<Settings, "profile">> {
  const { rows } = await db.query<{ settings: SettingsRow | null; mt5: Mt5SummaryRow }>(
    `SELECT (SELECT row_to_json(r) FROM (
               SELECT split_trader::text, split_company::text, split_client::text, loss_handling, business_timezone, gold_symbols,
                      ib_commissions_enabled, sync_interval_seconds
                 FROM settings WHERE id = 1) r) AS settings,
            ${MT5_SUMMARY_SQL} AS mt5`,
  );
  return toSettings(rows[0].settings, rows[0].mt5, new Date());
}

export async function getSettings(user: SessionUser): Promise<Settings> {
  return { ...(await loadSettingsRow()), profile: user };
}

// --- Writes: helpers -----------------------------------------------------------

/** Rebuild daily allocations for open months after trades or transactions change. */
async function recomputeOpenMonths(db: Queryable): Promise<void> {
  await recomputeMonths(db, { today: thisMonth() });
}

/** Next sequential number for ids like "cl-021" / codes like "CL-0021". */
async function nextNumber(db: Queryable, table: "clients" | "ibs"): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT COALESCE(MAX(substring(id FROM 4)::int), 0) + 1 AS n FROM ${table}`);
  return rows[0].n;
}

async function lastFinalizedMonth(db: Queryable): Promise<MonthKey | null> {
  const { rows } = await db.query<{ month: string | null }>("SELECT max(month) AS month FROM months WHERE status = 'finalized'");
  return rows[0]?.month ?? null;
}

/** Transactions dated in or before a finalized month would change locked numbers. */
async function assertDateOpen(db: Queryable, date: string, what = "This date"): Promise<void> {
  const last = await lastFinalizedMonth(db);
  if (last && monthOf(date) <= last) {
    throw badRequest(`${what} falls in ${formatMonth(monthOf(date))}, which is finalized. Reopen the month to change it.`);
  }
}

type TxnLike = Pick<Transaction, "type" | "amount" | "date">;

/**
 * Capital may never go below zero on any day. Same-day withdrawals are applied
 * before deposits (a deposit only counts from the next day).
 */
export function assertBalanceNeverNegative(transactions: TxnLike[]): void {
  const ordered = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === "withdrawal" ? -1 : 1),
  );
  let balance = new Decimal(0);
  for (const t of ordered) {
    balance = t.type === "deposit" ? balance.plus(t.amount) : balance.minus(t.amount);
    if (balance.isNegative()) {
      throw badRequest(`A withdrawal on ${t.date} would take capital below zero (short by ${formatCurrency(balance.negated())}).`);
    }
  }
}

function validateSplit(split: SplitPercent): void {
  if (!isValidSplit(split)) throw badRequest("Split percentages must total 100");
}

// --- Writes: clients and transactions ----------------------------------------

export async function createClient(user: SessionUser, input: CreateClientInput): Promise<ClientDetail> {
  validateSplit(input.split);
  if (toDecimal(input.investedAmount).lessThanOrEqualTo(0)) throw badRequest("Invested amount must be greater than zero");

  const id = await transaction(async (tx) => {
    await assertDateOpen(tx, input.investmentDate, "The investment date");
    if (input.ibId) {
      const ib = await tx.query("SELECT 1 FROM ibs WHERE id = $1 AND status = 'active'", [input.ibId]);
      if (!ib.rowCount) throw badRequest("Choose an active IB, or Direct");
    }
    // Serialise id allocation so two simultaneous adds can't collide.
    await tx.query("LOCK TABLE clients IN SHARE ROW EXCLUSIVE MODE");
    const n = await nextNumber(tx, "clients");
    const id = `cl-${String(n).padStart(3, "0")}`;
    const code = `CL-${String(n).padStart(4, "0")}`;
    await tx.query(
      `INSERT INTO clients (id, code, full_name, phone, email, ib_id, joined_at, split_trader, split_company, split_client, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        code,
        input.fullName.trim(),
        input.phone.trim(),
        input.email.trim(),
        input.ibId,
        input.investmentDate,
        input.split.trader,
        input.split.company,
        input.split.client,
        input.notes?.trim() || null,
      ],
    );
    await tx.query(
      `INSERT INTO transactions (id, client_id, type, amount, date, note)
       VALUES ('tx-' || gen_random_uuid(), $1, 'deposit', $2, $3, 'Initial investment')`,
      [id, toMoney(input.investedAmount), input.investmentDate],
    );
    await recomputeOpenMonths(tx);
    await audit(tx, user, {
      action: "client.create",
      entityType: "client",
      entityId: id,
      summary: `Added client ${input.fullName.trim()} (${code}) with ${formatCurrency(input.investedAmount)}`,
      details: { ...input },
    });
    return id;
  });

  return (await loadLedger()).client(id)!;
}

export async function updateClient(user: SessionUser, id: string, input: UpdateClientInput): Promise<ClientDetail> {
  validateSplit(input.split);
  await transaction(async (tx) => {
    const before = (await loadLedger(tx)).client(id);
    if (!before) throw notFound("Client not found");
    if (input.ibId) {
      const ib = await tx.query("SELECT 1 FROM ibs WHERE id = $1", [input.ibId]);
      if (!ib.rowCount) throw badRequest("Unknown IB");
    }
    await tx.query(
      `UPDATE clients SET full_name = $2, phone = $3, email = $4, ib_id = $5, status = $6,
              split_trader = $7, split_company = $8, split_client = $9, notes = $10
        WHERE id = $1`,
      [
        id,
        input.fullName.trim(),
        input.phone.trim(),
        input.email.trim(),
        input.ibId,
        input.status,
        input.split.trader,
        input.split.company,
        input.split.client,
        input.notes?.trim() || null,
      ],
    );
    await audit(tx, user, {
      action: "client.update",
      entityType: "client",
      entityId: id,
      summary: `Edited client ${before.fullName} (${before.code})`,
      details: diff(
        {
          fullName: before.fullName,
          phone: before.phone,
          email: before.email,
          ibId: before.ibId,
          status: before.status,
          split: before.split,
          notes: before.notes,
        },
        { ...input, notes: input.notes?.trim() || undefined },
      ),
    });
  });
  return (await loadLedger()).client(id)!;
}

async function clientTransactions(db: Queryable, clientId: string): Promise<(TxnLike & { id: string })[]> {
  const { rows } = await db.query<TxnLike & { id: string }>(
    "SELECT id, type, amount::text AS amount, to_char(date, 'YYYY-MM-DD') AS date FROM transactions WHERE client_id = $1",
    [clientId],
  );
  return rows;
}

export async function addTransaction(user: SessionUser, clientId: string, input: TransactionInput): Promise<ClientDetail> {
  await transaction(async (tx) => {
    const client = await tx.query<{ full_name: string; code: string }>(
      "SELECT full_name, code FROM clients WHERE id = $1 FOR UPDATE",
      [clientId],
    );
    if (!client.rows[0]) throw notFound("Client not found");
    await assertDateOpen(tx, input.date);
    assertBalanceNeverNegative([...(await clientTransactions(tx, clientId)), input]);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO transactions (id, client_id, type, amount, date, note)
       VALUES ('tx-' || gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id`,
      [clientId, input.type, toMoney(input.amount), input.date, input.note?.trim() || null],
    );
    await recomputeOpenMonths(tx);
    await audit(tx, user, {
      action: "transaction.create",
      entityType: "transaction",
      entityId: rows[0].id,
      summary: `Recorded ${input.type} of ${formatCurrency(input.amount)} for ${client.rows[0].full_name} (${client.rows[0].code}), effective ${input.date}`,
      details: { clientId, ...input },
    });
  });
  return (await loadLedger()).client(clientId)!;
}

async function loadTransaction(db: Queryable, id: string) {
  const { rows } = await db.query<TxnLike & { id: string; client_id: string; note: string | null; full_name: string }>(
    `SELECT t.id, t.client_id, t.type, t.amount::text AS amount, to_char(t.date, 'YYYY-MM-DD') AS date, t.note, c.full_name
       FROM transactions t JOIN clients c ON c.id = t.client_id WHERE t.id = $1 FOR UPDATE OF t`,
    [id],
  );
  if (!rows[0]) throw notFound("Transaction not found");
  return rows[0];
}

export async function updateTransaction(user: SessionUser, id: string, input: TransactionInput): Promise<ClientDetail> {
  const clientId = await transaction(async (tx) => {
    const before = await loadTransaction(tx, id);
    await assertDateOpen(tx, before.date, "This transaction");
    await assertDateOpen(tx, input.date, "The new date");
    const others = (await clientTransactions(tx, before.client_id)).filter((t) => t.id !== id);
    assertBalanceNeverNegative([...others, input]);
    await tx.query("UPDATE transactions SET type = $2, amount = $3, date = $4, note = $5, updated_at = now() WHERE id = $1", [
      id,
      input.type,
      toMoney(input.amount),
      input.date,
      input.note?.trim() || null,
    ]);
    await recomputeOpenMonths(tx);
    await audit(tx, user, {
      action: "transaction.update",
      entityType: "transaction",
      entityId: id,
      summary: `Edited a ${before.type} for ${before.full_name}`,
      details: diff(
        { type: before.type, amount: before.amount, date: before.date, note: before.note ?? undefined },
        { ...input, amount: toMoney(input.amount), note: input.note?.trim() || undefined },
      ),
    });
    return before.client_id;
  });
  return (await loadLedger()).client(clientId)!;
}

export async function deleteTransaction(user: SessionUser, id: string): Promise<ClientDetail> {
  const clientId = await transaction(async (tx) => {
    const before = await loadTransaction(tx, id);
    await assertDateOpen(tx, before.date, "This transaction");
    assertBalanceNeverNegative((await clientTransactions(tx, before.client_id)).filter((t) => t.id !== id));
    await tx.query("DELETE FROM transactions WHERE id = $1", [id]);
    await recomputeOpenMonths(tx);
    await audit(tx, user, {
      action: "transaction.delete",
      entityType: "transaction",
      entityId: id,
      summary: `Deleted a ${before.type} of ${formatCurrency(before.amount)} (effective ${before.date}) for ${before.full_name}`,
      details: { ...before },
    });
    return before.client_id;
  });
  return (await loadLedger()).client(clientId)!;
}

// --- Writes: IBs ---------------------------------------------------------------

const IB_RETURNING = `id, code, name, phone, email, status, joined_at AS "joinedAt", notes,
  commission_percent::text, commission_source`;

export async function createIB(user: SessionUser, input: IBInput): Promise<IB> {
  return transaction(async (tx) => {
    await tx.query("LOCK TABLE ibs IN SHARE ROW EXCLUSIVE MODE");
    const n = await nextNumber(tx, "ibs");
    const { rows } = await tx.query<IBRow>(
      `INSERT INTO ibs (id, code, name, phone, email, joined_at, notes, commission_percent, commission_source)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8)
       RETURNING ${IB_RETURNING}`,
      [
        `ib-${String(n).padStart(2, "0")}`,
        `IB-${String(n).padStart(2, "0")}`,
        input.name.trim(),
        input.phone.trim(),
        input.email.trim(),
        input.notes?.trim() || null,
        input.commission.percent,
        input.commission.source,
      ],
    );
    const ib = toIB(rows[0]);
    await audit(tx, user, {
      action: "ib.create",
      entityType: "ib",
      entityId: ib.id,
      summary: `Added IB ${ib.name} (${ib.code}), commission ${ib.commission.percent}% ${ib.commission.source.replaceAll("_", " ")}`,
      details: { ...input },
    });
    return ib;
  });
}

export async function updateIB(user: SessionUser, id: string, input: UpdateIBInput): Promise<IB> {
  return transaction(async (tx) => {
    const before = await tx.query<IBRow>(`SELECT ${IB_RETURNING} FROM ibs WHERE id = $1 FOR UPDATE`, [id]);
    if (!before.rows[0]) throw notFound("IB not found");
    const { rows } = await tx.query<IBRow>(
      `UPDATE ibs SET name = $2, phone = $3, email = $4, status = $5, notes = $6,
              commission_percent = $7, commission_source = $8
        WHERE id = $1 RETURNING ${IB_RETURNING}`,
      [
        id,
        input.name.trim(),
        input.phone.trim(),
        input.email.trim(),
        input.status,
        input.notes?.trim() || null,
        input.commission.percent,
        input.commission.source,
      ],
    );
    const prev = toIB(before.rows[0]);
    const ib = toIB(rows[0]);
    await audit(tx, user, {
      action: "ib.update",
      entityType: "ib",
      entityId: id,
      summary: `Edited IB ${ib.name} (${ib.code})`,
      details: diff(prev, ib),
    });
    return ib;
  });
}

// --- Writes: months and payouts ------------------------------------------------

/**
 * Freeze every client's numbers for an open month and create the payouts.
 * Run inside a transaction. Used by Finalize Month and by the seed.
 */
export async function freezeMonth(tx: Queryable, month: MonthKey): Promise<MonthlySplit> {
  // A month with no trades yet may not have a row (reads never create one).
  await tx.query("INSERT INTO months (month) VALUES ($1) ON CONFLICT DO NOTHING", [month]);
  await tx.query("SELECT 1 FROM months WHERE month = $1 FOR UPDATE", [month]);
  const ledger = await loadLedger(tx);
  const blocker = ledger.finalizeBlocker(month);
  if (blocker) throw conflict(blocker);
  const split = ledger.monthlySplit(month);
  const totals = ledger.frozenTotals(month);

  await tx.query(
    `INSERT INTO settlements (month, client_id, ib_id, capital, pool_share, active_days, split_trader, split_company,
                              split_client, ib_percent, ib_source, gross, carry_in, carry_out, trader, company, client, ib)
     SELECT $1, client_id, ib_id, capital, pool_share, active_days, split_trader, split_company, split_client,
            ib_percent, ib_source, gross, carry_in, carry_out, trader, company, client, ib
       FROM jsonb_to_recordset($2::jsonb) AS t(client_id text, ib_id text, capital numeric, pool_share numeric,
            active_days int, split_trader numeric, split_company numeric, split_client numeric, ib_percent numeric,
            ib_source text, gross numeric, carry_in numeric, carry_out numeric, trader numeric, company numeric,
            client numeric, ib numeric)`,
    [
      month,
      JSON.stringify(
        split.rows.map((r) => ({
          client_id: r.clientId,
          ib_id: r.ibId,
          capital: r.capital,
          pool_share: r.poolShare,
          active_days: r.activeDays,
          split_trader: r.split.trader,
          split_company: r.split.company,
          split_client: r.split.client,
          ib_percent: r.ibCommission.percent,
          ib_source: r.ibCommission.source,
          gross: r.grossProfit,
          carry_in: r.carryIn,
          carry_out: r.carryOut,
          trader: r.trader,
          company: r.company,
          client: r.client,
          ib: r.ib,
        })),
      ),
    ],
  );
  await tx.query(
    `UPDATE months SET status = 'finalized', finalized_at = CURRENT_DATE, net_profit = $2, total_capital = $3,
            trading_days = $4, lots = $5, trades = $6, company_adjustment = $7, loss_handling = $8
      WHERE month = $1`,
    [month, totals.netProfit, totals.totalCapital, totals.tradingDays, totals.lots, totals.trades, totals.companyAdjustment, totals.lossHandling],
  );

  const payouts = [
    ...split.rows.map((r) => ({ party_type: "client", party_id: r.clientId, amount: r.payoutAmount })),
    ...split.partyPayouts.map((p) => ({ party_type: p.partyType, party_id: p.partyId, amount: p.amount })),
  ].filter((p) => toDecimal(p.amount).greaterThan(0));
  // A payout already marked paid (before a reopen) keeps its paid amount.
  await tx.query(
    `INSERT INTO payouts (month, party_type, party_id, amount)
     SELECT $1, party_type, party_id, amount FROM jsonb_to_recordset($2::jsonb) AS t(party_type text, party_id text, amount numeric)
     ON CONFLICT (month, party_type, party_id) DO UPDATE SET amount = EXCLUDED.amount WHERE payouts.status = 'pending'`,
    [month, JSON.stringify(payouts)],
  );
  return split;
}

/** Lock the month: freeze every client's numbers and create the payouts. */
export async function finalizeMonth(user: SessionUser, month: MonthKey): Promise<MonthlySplit> {
  await transaction(async (tx) => {
    const split = await freezeMonth(tx, month);
    await audit(tx, user, {
      action: "month.finalize",
      entityType: "month",
      entityId: month,
      summary: `Finalized ${formatMonth(month)}: net ${formatCurrency(split.netProfit, { signed: true })} across ${split.rows.length} clients`,
      details: { netProfit: split.netProfit, trader: split.trader, company: split.company, client: split.client, ib: split.ib },
    });
  });
  return (await loadLedger()).monthlySplit(month);
}

/** Unlock a finalized month (admin only, with a reason). Paid payouts are kept as paid. */
export async function reopenMonth(user: SessionUser, month: MonthKey, reason: string): Promise<MonthlySplit> {
  await transaction(async (tx) => {
    await tx.query("SELECT 1 FROM months WHERE month = $1 FOR UPDATE", [month]);
    const ledger = await loadLedger(tx);
    const blocker = ledger.reopenBlocker(month);
    if (blocker) throw conflict(blocker);

    await tx.query("DELETE FROM settlements WHERE month = $1", [month]);
    const { rows: paid } = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM payouts WHERE month = $1 AND status = 'paid'", [month]);
    await tx.query("DELETE FROM payouts WHERE month = $1 AND status = 'pending'", [month]);
    await tx.query(
      `UPDATE months SET status = 'open', finalized_at = NULL, net_profit = NULL, total_capital = NULL,
              trading_days = NULL, lots = NULL, trades = NULL, company_adjustment = NULL, loss_handling = NULL
        WHERE month = $1`,
      [month],
    );
    // Trades or transactions may have changed while it was locked.
    await recomputeMonths(tx, { today: thisMonth(), months: [month] });
    await audit(tx, user, {
      action: "month.reopen",
      entityType: "month",
      entityId: month,
      summary: `Reopened ${formatMonth(month)}: ${reason}`,
      details: { reason, paidPayoutsKept: paid[0].n },
    });
  });
  return (await loadLedger()).monthlySplit(month);
}

export async function markPaid(user: SessionUser, month: MonthKey, partyType: PartyType, partyId: string): Promise<Payout> {
  return transaction(async (tx) => {
    const { rows: m } = await tx.query<{ status: string }>("SELECT status FROM months WHERE month = $1", [month]);
    if (m[0]?.status !== "finalized") throw badRequest("Finalize the month before marking payouts as paid");
    const { rows } = await tx.query<{ amount: string | null; paid_at: string }>(
      `UPDATE payouts SET status = 'paid', paid_at = CURRENT_DATE, paid_via = 'manual'
        WHERE month = $1 AND party_type = $2 AND party_id = $3 AND status = 'pending'
        RETURNING amount::text, to_char(paid_at, 'YYYY-MM-DD') AS paid_at`,
      [month, partyType, partyId],
    );
    if (!rows[0]) throw notFound("No pending payout for this party in this month");
    const name = await partyName(tx, partyType, partyId);
    await audit(tx, user, {
      action: "payout.paid",
      entityType: "payout",
      entityId: payoutKey(month, partyType, partyId),
      summary: `Marked ${formatCurrency(rows[0].amount ?? 0)} paid to ${name} for ${formatMonth(month)}`,
      details: { month, partyType, partyId, amount: rows[0].amount },
    });
    return { month, partyType, partyId, name, amount: rows[0].amount ?? "0.00", status: "paid", paidAt: rows[0].paid_at };
  });
}

async function partyName(db: Queryable, partyType: PartyType, partyId: string): Promise<string> {
  if (partyType === "trader") return "the trader";
  const table = partyType === "client" ? "clients" : "ibs";
  const column = partyType === "client" ? "full_name" : "name";
  const { rows } = await db.query<{ name: string }>(`SELECT ${column} AS name FROM ${table} WHERE id = $1`, [partyId]);
  return rows[0]?.name ?? partyId;
}

// --- Writes: settings ----------------------------------------------------------

export async function updateSettings(user: SessionUser, update: SettingsUpdate): Promise<Settings> {
  await transaction(async (tx) => {
    const before = await loadSettingsRow(tx);
    if (update.defaultSplit) {
      validateSplit(update.defaultSplit);
      const { trader, company, client } = update.defaultSplit;
      await tx.query("UPDATE settings SET split_trader = $1, split_company = $2, split_client = $3 WHERE id = 1", [trader, company, client]);
    }
    if (update.lossHandling && update.lossHandling !== "carry_forward") {
      throw badRequest("Losses always carry forward per client");
    }
    if (update.ibCommissionsEnabled !== undefined && update.ibCommissionsEnabled !== before.ibCommissionsEnabled) {
      await tx.query("UPDATE settings SET ib_commissions_enabled = $1 WHERE id = 1", [update.ibCommissionsEnabled]);
    }
    if (update.syncIntervalSeconds !== undefined) {
      await tx.query("UPDATE settings SET sync_interval_seconds = $1 WHERE id = 1", [update.syncIntervalSeconds]);
    }
    if (update.businessTimezone && update.businessTimezone !== before.businessTimezone) {
      await tx.query("UPDATE settings SET business_timezone = $1 WHERE id = 1", [update.businessTimezone]);
      // Day boundaries moved: rebuild the open months' daily rows.
      await recomputeOpenMonths(tx);
    }
    if (update.goldSymbols) {
      const gold = [...new Set(update.goldSymbols.map(normalizeSymbol).filter(Boolean))];
      if (!gold.length) throw badRequest("Keep at least one gold symbol");
      if (gold.join() !== before.goldSymbols.join()) {
        await tx.query("UPDATE settings SET gold_symbols = $1 WHERE id = 1", [gold]);
        // Which deals count as profit changed: rebuild the open months.
        await recomputeOpenMonths(tx);
      }
    }
    if (update.profile) {
      const taken = await tx.query("SELECT 1 FROM admin_users WHERE lower(email) = lower($1) AND id <> $2", [update.profile.email, user.id]);
      if (taken.rowCount) throw badRequest("That email is already used by another user");
      await tx.query("UPDATE admin_users SET name = $1, email = $2 WHERE id = $3", [
        update.profile.name.trim(),
        update.profile.email.trim(),
        user.id,
      ]);
    }
    const { profile, ...business } = update;
    if (Object.keys(business).length) {
      await audit(tx, user, {
        action: "settings.update",
        entityType: "settings",
        summary: `Changed settings: ${Object.keys(business).join(", ")}`,
        details: diff(before as Record<string, unknown>, business as Record<string, unknown>),
      });
    }
    if (profile) {
      await audit(tx, user, {
        action: "user.profile",
        entityType: "user",
        entityId: user.id,
        summary: "Updated own profile",
        details: diff(user, profile),
      });
    }
  });
  const profile = update.profile ? { ...user, name: update.profile.name.trim(), email: update.profile.email.trim() } : user;
  return getSettings(profile);
}

export async function changePassword(user: SessionUser, currentPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw badRequest("New password must be at least 8 characters");
  const { rows } = await pool().query<{ password_hash: string }>("SELECT password_hash FROM admin_users WHERE id = $1", [user.id]);
  if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].password_hash))) {
    throw badRequest("Current password is incorrect");
  }
  await transaction(async (tx) => {
    await tx.query("UPDATE admin_users SET password_hash = $1 WHERE id = $2", [await hashPassword(newPassword), user.id]);
    await audit(tx, user, { action: "user.password", entityType: "user", entityId: user.id, summary: "Changed own password" });
  });
}
