import Decimal from "decimal.js";
import { percentOf, sum, sumMoney, toDecimal, toMoney } from "@/lib/calculations";
import { monthEnd, monthOf, shiftMonth, toISODate } from "@/lib/dates";
import { accountSyncState, syncHealth, worstHealth } from "@/lib/mt5";
import type {
  Client,
  ClientAccountBrief,
  ClientDetail,
  ClientMonthRecord,
  ClientPage,
  ClientQuery,
  ClientSplitRow,
  ClientStatus,
  ClientSummary,
  DashboardStats,
  DecimalString,
  DirectSummary,
  ISODateTime,
  IB,
  IBClientRow,
  IBCommissionRule,
  IBDetail,
  IBSummary,
  ISODate,
  LossHandling,
  MonthKey,
  MonthlySplit,
  MonthStatus,
  Mt5Summary,
  PartyType,
  Payout,
  PayoutStatus,
  SplitPercent,
  SyncIssue,
  TopClient,
  Trade,
  Transaction,
} from "@/lib/types";
import { nextCarry, settleMonth } from "./settle";

/** A client as stored — IB name and capital are joined in here. */
export interface ClientRecord {
  id: string;
  code: string;
  fullName: string;
  phone: string;
  email: string;
  /** Null = Direct client. */
  ibId: string | null;
  joinedAt: ISODate;
  status: ClientStatus;
  split: SplitPercent;
  notes?: string;
}

/** Month totals frozen when the month was finalized. */
export interface FrozenMonth {
  netProfit: DecimalString;
  totalCapital: DecimalString;
  tradingDays: number;
  lots: DecimalString;
  trades: number;
  companyAdjustment: DecimalString;
  lossHandling: LossHandling;
}

export interface MonthRecord {
  status: MonthStatus;
  finalizedAt?: ISODate;
  frozen?: FrozenMonth;
}

export interface PayoutRecord {
  amount?: DecimalString;
  status: PayoutStatus;
  paidAt?: ISODate;
  /** Fee payouts: fee payments received so far. */
  paidAmount?: DecimalString;
}

/** An MT5 account as the ledger needs it (real accounts only). */
export interface SnapshotAccount {
  id: string;
  login: number;
  server: string;
  label: string;
  clientId: string | null;
  isActive: boolean;
  passwordSet: boolean;
  lastSyncAt: ISODateTime | null;
  lastSyncStatus: "ok" | "error" | null;
  lastError: string | null;
  lastErrorKind: "auth" | "other" | null;
  balance: DecimalString | null;
  equity: DecimalString | null;
  floatingPl: DecimalString | null;
}

/** A month's pool totals, from `daily_pnl`. */
export interface MonthPool {
  net: DecimalString;
  lots: DecimalString;
  trades: number;
  tradingDays: number;
  /** Σ over trading days of the pool's active capital. */
  capitalDays: DecimalString;
}

/** A client's month, from `daily_allocations`. */
export interface MonthClientAllocation {
  clientId: string;
  /** Σ of unrounded daily shares. */
  gross: DecimalString;
  /** Σ over trading days of the client's active capital. */
  capitalDays: DecimalString;
  activeDays: number;
}

/** A client's numbers for a finalized month, from `settlements`. */
export interface SettlementRecord {
  clientId: string;
  ibId: string | null;
  capital: DecimalString;
  poolShare: DecimalString;
  activeDays: number;
  split: SplitPercent;
  ibCommission: IBCommissionRule;
  grossProfit: DecimalString;
  carryIn: DecimalString;
  carryOut: DecimalString;
  trader: DecimalString;
  company: DecimalString;
  client: DecimalString;
  ib: DecimalString;
}

/** What the ledger reads, as loaded from Postgres. Day-level work happens in SQL. */
export interface Snapshot {
  ibs: IB[];
  clients: ClientRecord[];
  transactions: Omit<Transaction, "locked">[];
  months: Record<MonthKey, MonthRecord>;
  /** Keyed by `payoutKey(month, partyType, partyId)`. */
  payouts: Record<string, PayoutRecord>;
  pools: Record<MonthKey, MonthPool>;
  allocations: Record<MonthKey, MonthClientAllocation[]>;
  settlements: Record<MonthKey, SettlementRecord[]>;
  /** Real MT5 accounts (pooled and client-linked). */
  accounts: SnapshotAccount[];
  /** Lots opened per month in each client's own accounts: month → client → lots. */
  clientLots: Record<MonthKey, Record<string, DecimalString>>;
  defaultSplit: SplitPercent;
  lossHandling: LossHandling;
  /** Off: no IB commission is calculated (rules are kept for later). */
  ibCommissionsEnabled: boolean;
  businessTimezone: string;
  mt5: Mt5Summary;
  now: Date;
}

export const TRADER_PARTY_ID = "trader";
/** Shown wherever an IB would be, for clients without one. */
export const DIRECT_LABEL = "Direct";
const NO_COMMISSION: IBCommissionRule = { percent: 0, source: "from_company_share" };

export function payoutKey(month: MonthKey, partyType: PartyType, partyId: string): string {
  return `${month}:${partyType}:${partyId}`;
}

const ZERO_MONEY = "0.00";
const sumOrNull = (values: (DecimalString | null)[]) => {
  const present = values.filter((v): v is DecimalString => v !== null);
  return present.length ? sumMoney(present) : null;
};

const EMPTY_POOL: MonthPool = { net: "0.00", lots: "0.00", trades: 0, tradingDays: 0, capitalDays: "0" };
const nonNegative = (value: Decimal.Value) => toMoney(Decimal.max(toDecimal(value), 0));

/**
 * Business rules for capital, profit allocation, splits and payouts.
 *
 * Daily allocation happens in SQL (allocations.ts). Here months are settled
 * oldest-first so unrecovered losses carry forward. Finalized months are read
 * from their frozen `settlements` rows and never recomputed.
 */
export class Ledger {
  private readonly splits = new Map<MonthKey, MonthlySplit>();
  /** Unrecovered loss per client after the latest month. */
  private readonly carry: Map<string, DecimalString>;

  constructor(private readonly s: Snapshot) {
    const clientSplits = new Map(s.clients.map((c) => [c.id, c.split]));
    const ibRules = new Map(
      s.clients.map((c) => [c.id, (s.ibCommissionsEnabled && this.ibOf(c.ibId)?.commission) || NO_COMMISSION]),
    );

    let carry = new Map<string, DecimalString>();
    for (const month of this.months()) {
      const record = s.months[month];
      const settled = s.settlements[month];
      if (record?.status === "finalized" && record.frozen && settled) {
        carry = nextCarry(carry, { clients: settled });
        this.splits.set(month, this.frozenSplit(month, record, record.frozen, settled));
        continue;
      }
      const pool = s.pools[month] ?? EMPTY_POOL;
      const allocations = s.allocations[month] ?? [];
      const result = settleMonth({
        netProfit: pool.net,
        allocations,
        splits: clientSplits,
        ibRules,
        carryIn: carry,
        lossHandling: s.lossHandling,
      });
      carry = nextCarry(carry, result);

      const byClient = new Map(allocations.map((a) => [a.clientId, a]));
      const avg = (capitalDays: Decimal.Value) =>
        pool.tradingDays ? toMoney(toDecimal(capitalDays).dividedBy(pool.tradingDays)) : toMoney(0);
      const rows: SettlementRecord[] = result.clients.map((c) => {
        const client = this.clientRecord(c.clientId);
        const allocation = byClient.get(c.clientId)!;
        return {
          ...c,
          ibId: client.ibId,
          capital: avg(allocation.capitalDays),
          poolShare: percentOf(allocation.capitalDays, pool.capitalDays),
          activeDays: allocation.activeDays,
          split: client.split,
          ibCommission: ibRules.get(c.clientId)!,
        };
      });
      const totals: FrozenMonth = {
        netProfit: toMoney(pool.net),
        totalCapital: avg(pool.capitalDays),
        tradingDays: pool.tradingDays,
        lots: toDecimal(pool.lots).toFixed(2),
        trades: pool.trades,
        companyAdjustment: result.companyAdjustment,
        lossHandling: s.lossHandling,
      };
      this.splits.set(month, this.frozenSplit(month, record ?? { status: "open" }, totals, rows));
    }
    this.carry = carry;
  }

  /** Build the month view from settlement rows (frozen or freshly computed). */
  private frozenSplit(month: MonthKey, record: MonthRecord, totals: FrozenMonth, settled: SettlementRecord[]): MonthlySplit {
    const finalized = record.status === "finalized";
    const rows: ClientSplitRow[] = settled
      .map((r) => {
        const client = this.clientRecord(r.clientId);
        // Clients with their own accounts keep the profit there and owe the shares ("fee").
        const feeKey = payoutKey(month, "fee", r.clientId);
        const payoutType: "client" | "fee" = this.s.payouts[feeKey] || (!finalized && this.hasOwnAccounts(r.clientId)) ? "fee" : "client";
        const payout = this.s.payouts[payoutKey(month, payoutType, r.clientId)];
        const due = payoutType === "fee" ? sum([r.trader, r.company, r.ib]) : r.client;
        return {
          ...r,
          clientCode: client.code,
          clientName: client.fullName,
          ibName: this.ibName(r.ibId),
          splitBase: nonNegative(toDecimal(r.grossProfit).plus(r.carryIn)),
          payoutType,
          payoutStatus: payout?.status ?? "pending",
          payoutAmount: finalized && payout?.amount ? payout.amount : nonNegative(due),
          paidAmount: payout?.paidAmount ?? ZERO_MONEY,
          paidAt: payout?.paidAt,
        };
      })
      .sort((a, b) => toDecimal(b.capital).comparedTo(toDecimal(a.capital)));

    const party = (partyType: PartyType, partyId: string, name: string, computed: Decimal.Value): Payout => {
      const p = this.s.payouts[payoutKey(month, partyType, partyId)];
      return {
        month,
        partyType,
        partyId,
        name,
        amount: finalized && p?.amount ? p.amount : nonNegative(computed),
        status: p?.status ?? "pending",
        paidAt: p?.paidAt,
      };
    };
    const ibTotals = new Map<string, Decimal>();
    for (const r of rows) if (r.ibId) ibTotals.set(r.ibId, (ibTotals.get(r.ibId) ?? new Decimal(0)).plus(r.ib));
    const partyPayouts = [
      party("trader", TRADER_PARTY_ID, "Trader", sum(rows.map((r) => r.trader))),
      ...[...ibTotals]
        .filter(([, amount]) => amount.greaterThan(0))
        .map(([ibId, amount]) => party("ib", ibId, this.ibOf(ibId)?.name ?? ibId, amount)),
    ];

    return {
      month,
      status: record.status,
      finalizedAt: record.finalizedAt,
      netProfit: totals.netProfit,
      totalCapital: totals.totalCapital,
      tradingDays: totals.tradingDays,
      companyAdjustment: totals.companyAdjustment,
      lossHandling: totals.lossHandling,
      trader: sumMoney(rows.map((r) => r.trader)),
      company: toMoney(sum([...rows.map((r) => r.company), totals.companyAdjustment])),
      client: sumMoney(rows.map((r) => r.client)),
      ib: sumMoney(rows.map((r) => r.ib)),
      rows,
      partyPayouts,
      finalizeBlocker: this.finalizeBlocker(month),
      reopenBlocker: this.reopenBlocker(month),
    };
  }

  /** Month-level numbers to freeze when finalizing (computed rows of an open month). */
  frozenTotals(month: MonthKey): FrozenMonth {
    const split = this.monthlySplit(month);
    const pool = this.s.pools[month] ?? EMPTY_POOL;
    return {
      netProfit: split.netProfit,
      totalCapital: split.totalCapital,
      tradingDays: split.tradingDays,
      lots: toDecimal(pool.lots).toFixed(2),
      trades: pool.trades,
      companyAdjustment: split.companyAdjustment,
      lossHandling: split.lossHandling,
    };
  }

  get currentMonth(): MonthKey {
    return monthOf(toISODate(this.s.now));
  }

  months(): MonthKey[] {
    return Object.keys(this.s.months).sort();
  }

  /** The latest finalized month: transactions dated in or before it are locked. */
  get lastFinalizedMonth(): MonthKey | null {
    return this.months().filter((m) => this.s.months[m].status === "finalized").at(-1) ?? null;
  }

  /** Months must be finalized oldest-first so carried losses never change after locking. */
  finalizeBlocker(month: MonthKey): string | null {
    const record = this.s.months[month];
    if (!record) return "Unknown month";
    if (record.status === "finalized") return "This month is already finalized";
    const earlierOpen = this.months().find((m) => m < month && this.s.months[m].status === "open");
    return earlierOpen ? `Finalize ${earlierOpen} first — months are locked in order` : null;
  }

  /** Months are reopened newest-first, for the same reason. */
  reopenBlocker(month: MonthKey): string | null {
    const record = this.s.months[month];
    if (!record) return "Unknown month";
    if (record.status !== "finalized") return "This month is open";
    const laterFinalized = this.months().find((m) => m > month && this.s.months[m].status === "finalized");
    return laterFinalized ? `Reopen ${laterFinalized} first — months are reopened in order` : null;
  }

  isDateLocked(date: ISODate): boolean {
    const last = this.lastFinalizedMonth;
    return last !== null && monthOf(date) <= last;
  }

  private clientRecord(id: string): ClientRecord {
    const c = this.s.clients.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown client ${id}`);
    return c;
  }

  private ibOf(ibId: string | null): IB | undefined {
    return ibId ? this.s.ibs.find((ib) => ib.id === ibId) : undefined;
  }

  private hasOwnAccounts(clientId: string): boolean {
    return this.s.accounts.some((a) => a.clientId === clientId);
  }

  private accountsOf(clientId: string): SnapshotAccount[] {
    return this.s.accounts.filter((a) => a.clientId === clientId);
  }

  private accountHealth(a: SnapshotAccount) {
    return a.isActive ? syncHealth(a.lastSyncAt, a.lastSyncStatus, this.s.now) : "none";
  }

  private brief(a: SnapshotAccount): ClientAccountBrief {
    return {
      id: a.id,
      login: a.login,
      server: a.server,
      syncState: accountSyncState(a),
      health: this.accountHealth(a),
      balance: a.balance,
      equity: a.equity,
      floatingPl: a.floatingPl,
    };
  }

  private clientMonthLots(clientId: string, month: MonthKey): DecimalString {
    return this.s.clientLots[month]?.[clientId] ?? "0.00";
  }

  private ibName(ibId: string | null): string {
    return ibId ? (this.ibOf(ibId)?.name ?? "—") : DIRECT_LABEL;
  }

  /** Capital after every transaction dated on or before `date`. */
  private capitalAsOf(clientId: string, date: ISODate): Decimal {
    return sum(
      this.s.transactions
        .filter((t) => t.clientId === clientId && t.date <= date)
        .map((t) => (t.type === "deposit" ? t.amount : toDecimal(t.amount).negated())),
    );
  }

  toClient(record: ClientRecord): Client {
    return {
      ...record,
      ibName: this.ibName(record.ibId),
      investedCapital: toMoney(this.capitalAsOf(record.id, "9999-12-31")),
    };
  }

  monthlySplit(month: MonthKey): MonthlySplit {
    return (
      this.splits.get(month) ??
      this.frozenSplit(month, this.s.months[month] ?? { status: "open" }, {
        netProfit: "0.00",
        totalCapital: "0.00",
        tradingDays: 0,
        lots: "0.00",
        trades: 0,
        companyAdjustment: "0.00",
        lossHandling: this.s.lossHandling,
      }, [])
    );
  }

  private clientHistory(clientId: string): (ClientMonthRecord & { month: MonthKey })[] {
    return this.months()
      .flatMap((month) => {
        const split = this.monthlySplit(month);
        const row = split.rows.find((r) => r.clientId === clientId);
        if (!row) return [];
        return [
          {
            month,
            monthStatus: split.status,
            splitBase: row.splitBase,
            payoutType: row.payoutType,
            capital: row.capital,
            grossProfit: row.grossProfit,
            carryIn: row.carryIn,
            carryOut: row.carryOut,
            split: row.split,
            trader: row.trader,
            company: row.company,
            client: row.client,
            ib: row.ib,
            payoutStatus: row.payoutStatus,
            payoutAmount: row.payoutAmount,
            paidAt: row.paidAt,
          },
        ];
      })
      .reverse();
  }

  private toClientSummary(record: ClientRecord, month: MonthKey): ClientSummary {
    const history = this.clientHistory(record.id);
    const current = history.find((h) => h.month === month);
    const accounts = this.accountsOf(record.id);
    return {
      ...this.toClient(record),
      monthProfit: current?.client ?? toMoney(0),
      totalProfit: sumMoney(history.map((h) => h.client)),
      carriedLoss: this.carry.get(record.id) ?? toMoney(0),
      accounts: accounts.map((a) => this.brief(a)),
      balance: sumOrNull(accounts.map((a) => a.balance)),
      equity: sumOrNull(accounts.map((a) => a.equity)),
      floatingPl: sumOrNull(accounts.map((a) => a.floatingPl)),
      monthNetProfit: current?.grossProfit ?? ZERO_MONEY,
      monthLots: this.clientMonthLots(record.id, month),
      syncHealth: worstHealth(accounts.map((a) => this.accountHealth(a))),
    };
  }

  /** Totals for a group of clients (an IB's, or the Direct ones) in `month`. */
  private groupTotals(clients: ClientRecord[], month: MonthKey) {
    const summaries = clients.map((c) => this.toClientSummary(c, month));
    return {
      clientCount: clients.filter((c) => c.status === "active").length,
      totalCapital: sumMoney(summaries.map((c) => c.investedCapital)),
      monthLots: toDecimal(sum(summaries.map((c) => c.monthLots))).toFixed(2),
      monthNetProfit: sumMoney(summaries.map((c) => c.monthNetProfit)),
      monthClientProfit: sumMoney(summaries.map((c) => c.monthProfit)),
    };
  }

  /** Clients without an IB, summarised like an IB. */
  directSummary(month?: MonthKey): DirectSummary {
    return this.groupTotals(
      this.s.clients.filter((c) => c.ibId === null),
      month ?? this.currentMonth,
    );
  }

  private toIBSummary(ib: IB, month: MonthKey): IBSummary {
    const split = this.monthlySplit(month);
    return {
      ...ib,
      ...this.groupTotals(
        this.s.clients.filter((c) => c.ibId === ib.id),
        month,
      ),
      monthCommission: sumMoney(split.rows.filter((r) => r.ibId === ib.id).map((r) => r.ib)),
    };
  }

  // --- Queries ---------------------------------------------------------------

  dashboard(month: MonthKey, recentTrades: Trade[]): DashboardStats {
    const end = monthEnd(month);
    const split = this.monthlySplit(month);
    const record = this.s.months[month];
    const pool = this.s.pools[month] ?? EMPTY_POOL;
    const capitals = this.s.clients.map((c) => this.capitalAsOf(c.id, end));
    const flow = this.s.transactions
      .filter((t) => monthOf(t.date) === month)
      .map((t) => (t.type === "deposit" ? t.amount : toDecimal(t.amount).negated()));
    const previous = this.splits.get(shiftMonth(month, -1));

    return {
      month,
      totalInvestedCapital: toMoney(sum(capitals)),
      capitalFlow: toMoney(sum(flow)),
      netProfit: split.netProfit,
      previousNetProfit: previous?.netProfit ?? "0.00",
      lots: record?.frozen?.lots ?? toDecimal(pool.lots).toFixed(2),
      tradeCount: record?.frozen?.trades ?? pool.trades,
      activeClients: capitals.filter((c) => c.greaterThan(0)).length,
      newClients: this.s.clients.filter((c) => monthOf(c.joinedAt) === month).length,
      activeIbs: this.s.ibs.filter((ib) => ib.status === "active").length,
      totalIbs: this.s.ibs.length,
      distribution: { trader: split.trader, company: split.company, client: split.client, ib: split.ib },
      recentTrades,
      totalBalance: sumMoney(this.s.accounts.map((a) => a.balance ?? 0)),
      totalEquity: sumMoney(this.s.accounts.map((a) => a.equity ?? 0)),
      floatingPl: sumMoney(this.s.accounts.map((a) => a.floatingPl ?? 0)),
      topClients: this.topClients(month),
      syncIssues: this.syncIssues(),
    };
  }

  private topClients(month: MonthKey, limit = 5): TopClient[] {
    return this.s.clients
      .map((c) => this.toClientSummary(c, month))
      .filter((c) => c.accounts.length > 0 || !toDecimal(c.monthNetProfit).isZero())
      .sort((a, b) => toDecimal(b.monthNetProfit).comparedTo(toDecimal(a.monthNetProfit)))
      .slice(0, limit)
      .map((c) => ({
        id: c.id,
        fullName: c.fullName,
        ibName: c.ibName,
        monthNetProfit: c.monthNetProfit,
        monthLots: c.monthLots,
        equity: c.equity,
      }));
  }

  /** Active accounts that need attention: failing, stale (amber/red) or not synced yet. */
  private syncIssues(): SyncIssue[] {
    const rank = { error: 0, no_password: 1, waiting: 2, ok: 3, paused: 4 } as const;
    return this.s.accounts
      .filter((a) => a.isActive)
      .map((a) => ({ a, health: this.accountHealth(a), state: accountSyncState(a) }))
      .filter(({ health, state }) => state !== "ok" || health === "amber" || health === "red")
      .sort((x, y) => rank[x.state] - rank[y.state] || x.a.login - y.a.login)
      .map(({ a, health, state }) => ({
        accountId: a.id,
        login: a.login,
        server: a.server,
        clientId: a.clientId,
        clientName: a.clientId ? (this.s.clients.find((c) => c.id === a.clientId)?.fullName ?? null) : null,
        health,
        syncState: state,
        lastSyncAt: a.lastSyncAt,
        lastError: a.lastError,
        lastErrorKind: a.lastErrorKind,
      }));
  }

  clients(query: ClientQuery): ClientPage {
    const month = query.month ?? this.currentMonth;
    const search = query.search?.trim().toLowerCase();
    const all = this.s.clients
      .filter((c) => !query.ibId || (query.ibId === "direct" ? c.ibId === null : c.ibId === query.ibId))
      .filter((c) => !query.status || c.status === query.status)
      .filter((c) => !search || [c.fullName, c.code, c.phone, c.email].some((v) => v.toLowerCase().includes(search)))
      .map((c) => this.toClientSummary(c, month));

    const key = query.sort ?? "fullName";
    const dir = query.dir === "desc" ? -1 : 1;
    const money = ["investedCapital", "monthProfit", "monthNetProfit", "totalProfit", "carriedLoss"].includes(key);
    all.sort((a, b) => {
      const cmp = money
        ? toDecimal(a[key]).comparedTo(toDecimal(b[key]))
        : String(a[key]).localeCompare(String(b[key]));
      return cmp * dir || a.code.localeCompare(b.code);
    });

    const pageSize = query.pageSize ?? 10;
    const page = query.page ?? 0;
    return {
      rows: all.slice(page * pageSize, (page + 1) * pageSize),
      total: all.length,
      totalCapital: sumMoney(all.map((c) => c.investedCapital)),
    };
  }

  client(id: string, month?: MonthKey): Omit<ClientDetail, "accountDetails"> | null {
    const record = this.s.clients.find((c) => c.id === id);
    if (!record) return null;
    return {
      ...this.toClientSummary(record, month ?? this.currentMonth),
      history: this.clientHistory(id),
      transactions: this.s.transactions
        .filter((t) => t.clientId === id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
        .map((t) => ({ ...t, locked: this.isDateLocked(t.date) })),
    };
  }

  /** The client's transactions, oldest first (for balance checks). */
  transactionsOf(clientId: string): Omit<Transaction, "locked">[] {
    return this.s.transactions
      .filter((t) => t.clientId === clientId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }

  ibs(month?: MonthKey): IBSummary[] {
    return this.s.ibs.map((ib) => this.toIBSummary(ib, month ?? this.currentMonth));
  }

  ib(id: string, month?: MonthKey): IBDetail | null {
    const ib = this.ibOf(id);
    if (!ib) return null;
    const m = month ?? this.currentMonth;
    const commissionFor = (clientId: string, onlyMonth?: MonthKey) =>
      sumMoney(
        this.months()
          .filter((x) => !onlyMonth || x === onlyMonth)
          .flatMap((x) => this.monthlySplit(x).rows.filter((r) => r.clientId === clientId && r.ibId === id).map((r) => r.ib)),
      );
    const clients: IBClientRow[] = this.s.clients
      .filter((c) => c.ibId === id)
      .map((c) => ({ ...this.toClientSummary(c, m), monthCommission: commissionFor(c.id, m), totalCommission: commissionFor(c.id) }))
      .sort((a, b) => toDecimal(b.investedCapital).comparedTo(toDecimal(a.investedCapital)));
    const payouts = this.months()
      .map((x) => this.monthlySplit(x))
      .filter((split) => split.status === "finalized")
      .flatMap((split) => split.partyPayouts.filter((p) => p.partyType === "ib" && p.partyId === id))
      .reverse();
    return {
      ...this.toIBSummary(ib, m),
      totalClientProfit: sumMoney(clients.map((c) => c.totalProfit)),
      totalCommission: sumMoney(this.months().flatMap((x) => this.monthlySplit(x).rows.filter((r) => r.ibId === id).map((r) => r.ib))),
      clients,
      payouts,
    };
  }
}
