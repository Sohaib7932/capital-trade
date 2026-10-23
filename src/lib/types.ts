/**
 * Domain types shared by the UI and the API layer.
 *
 * Money and prices are `DecimalString`s ("1480000.00"), read from Postgres
 * NUMERIC as text, so values never pass through JS floats. Do all arithmetic
 * on them with decimal.js (see calculations.ts).
 */

export type DecimalString = string;
/** Calendar date, "2026-10-21". */
export type ISODate = string;
/** UTC timestamp, "2026-10-21T15:42:10Z". Displayed in the business timezone. */
export type ISODateTime = string;
/** Calendar month, "2026-10". */
export type MonthKey = string;

export type ClientStatus = "active" | "inactive";
export type IBStatus = "active" | "inactive";
export type TradeType = "buy" | "sell";
export type PayoutStatus = "pending" | "paid";
export type MonthStatus = "open" | "finalized";
export type TransactionType = "deposit" | "withdrawal";
/** What happens to a client's losing month: carry it until recovered, or start fresh each month. */
export type LossHandling = "carry_forward" | "reset_monthly";
export type Role = "admin" | "viewer";
export type PartyType = "client" | "trader" | "ib";
export type SortDirection = "asc" | "desc";

/** Percentages of net profit. Must add up to exactly 100. */
export interface SplitPercent {
  trader: number;
  company: number;
  client: number;
}

/** How a profit is divided. `ib` is the introducing broker's commission. */
export interface SplitAmounts {
  trader: DecimalString;
  company: DecimalString;
  client: DecimalString;
  ib: DecimalString;
}

export interface Paged<T> {
  rows: T[];
  total: number;
}

// ---------------------------------------------------------------------------
// IBs (Introducing Brokers)
// ---------------------------------------------------------------------------

/**
 * - `from_company_share`: the commission is paid out of the company's share.
 * - `additional`: the commission is taken off the client's profit before the
 *   trader/company/client split, so all three share its cost.
 */
export type IBCommissionSource = "from_company_share" | "additional";

/** Commission = `percent` of each client's splittable profit (after recovering losses). */
export interface IBCommissionRule {
  percent: number;
  source: IBCommissionSource;
}

export interface IB {
  id: string;
  /** Human-facing code, e.g. "IB-01". */
  code: string;
  name: string;
  phone: string;
  email: string;
  status: IBStatus;
  joinedAt: ISODate;
  commission: IBCommissionRule;
  notes?: string;
}

/** IB plus aggregates for list views. */
export interface IBSummary extends IB {
  clientCount: number;
  totalCapital: DecimalString;
  /** Client results this month for this IB's clients. */
  monthClientProfit: DecimalString;
  monthCommission: DecimalString;
}

export interface IBClientRow extends ClientSummary {
  monthCommission: DecimalString;
  totalCommission: DecimalString;
}

export interface IBDetail extends IBSummary {
  totalClientProfit: DecimalString;
  totalCommission: DecimalString;
  clients: IBClientRow[];
  /** This IB's commission payout per finalized month, newest first. */
  payouts: Payout[];
}

export interface IBInput {
  name: string;
  phone: string;
  email: string;
  commission: IBCommissionRule;
  notes?: string;
}

export interface UpdateIBInput extends IBInput {
  status: IBStatus;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export interface Client {
  id: string;
  /** Human-facing code, e.g. "CL-0012". */
  code: string;
  fullName: string;
  phone: string;
  email: string;
  /** The introducing broker, or null for a Direct (company) client. */
  ibId: string | null;
  /** IB name, or "Direct". */
  ibName: string;
  /** Current capital: always derived from deposits minus withdrawals. */
  investedCapital: DecimalString;
  joinedAt: ISODate;
  status: ClientStatus;
  split: SplitPercent;
  notes?: string;
}

/** Client plus profit aggregates for list views. */
export interface ClientSummary extends Client {
  /** Client result for the requested month. */
  monthProfit: DecimalString;
  /** Client result across all months, including the current open one. */
  totalProfit: DecimalString;
  /** Loss not yet recovered (≤ 0), carried into the next month. "0.00" if none. */
  carriedLoss: DecimalString;
}

export interface Transaction {
  id: string;
  clientId: string;
  type: TransactionType;
  amount: DecimalString;
  /** Effective date. A deposit earns from the next day; a withdrawal stops earning on this day. */
  date: ISODate;
  note?: string;
  /** True when the date falls in or before a finalized month — it can no longer change. */
  locked: boolean;
}

export interface TransactionInput {
  type: TransactionType;
  amount: DecimalString;
  date: ISODate;
  note?: string;
}

/** One month of a client's profit history. */
export interface ClientMonthRecord extends SplitAmounts {
  month: MonthKey;
  monthStatus: MonthStatus;
  /** Average active capital across the month's trading days. */
  capital: DecimalString;
  /** Client's portion of the pool's net profit, before the split. */
  grossProfit: DecimalString;
  /** Unrecovered loss brought in (≤ 0). */
  carryIn: DecimalString;
  /** Unrecovered loss carried out (≤ 0). */
  carryOut: DecimalString;
  split: SplitPercent;
  payoutStatus: PayoutStatus;
  /** Amount due/paid to the client (never negative). */
  payoutAmount: DecimalString;
  paidAt?: ISODate;
}

export interface ClientDetail extends ClientSummary {
  history: ClientMonthRecord[];
  transactions: Transaction[];
}

export interface CreateClientInput {
  fullName: string;
  phone: string;
  email: string;
  /** Null = Direct client. */
  ibId: string | null;
  investedAmount: DecimalString;
  investmentDate: ISODate;
  split: SplitPercent;
  notes?: string;
}

export interface UpdateClientInput {
  fullName: string;
  phone: string;
  email: string;
  /** Null = Direct client. */
  ibId: string | null;
  status: ClientStatus;
  split: SplitPercent;
  notes?: string;
}

export type ClientSortKey = "fullName" | "ibName" | "investedCapital" | "joinedAt" | "monthProfit" | "totalProfit";

export interface ClientQuery {
  search?: string;
  /** An IB id, or "direct" for clients without an IB. */
  ibId?: string;
  status?: ClientStatus;
  /** Month used for `monthProfit`. Defaults to the latest month. */
  month?: MonthKey;
  page?: number;
  pageSize?: number;
  sort?: ClientSortKey;
  dir?: SortDirection;
}

export interface ClientPage extends Paged<ClientSummary> {
  /** Sum of invested capital across every matching client, not just this page. */
  totalCapital: DecimalString;
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

export interface Trade {
  ticket: number;
  symbol: string;
  type: TradeType;
  lots: DecimalString;
  openTime: ISODateTime;
  closeTime: ISODateTime;
  openPrice: DecimalString;
  closePrice: DecimalString;
  /** Gross P/L from price movement. */
  profit: DecimalString;
  swap: DecimalString;
  /** Negative: a cost. */
  commission: DecimalString;
}

export type TradeSortKey =
  | "ticket"
  | "openTime"
  | "closeTime"
  | "type"
  | "lots"
  | "openPrice"
  | "closePrice"
  | "profit"
  | "swap"
  | "commission"
  | "net";

export interface TradeFilters {
  /** Inclusive, by close date in the business timezone. */
  from?: ISODate;
  /** Inclusive, by close date in the business timezone. */
  to?: ISODate;
  type?: TradeType;
}

export interface TradeQuery extends TradeFilters {
  page?: number;
  pageSize?: number;
  sort?: TradeSortKey;
  dir?: SortDirection;
}

export interface TradeSummary {
  count: number;
  buys: number;
  lots: DecimalString;
  profit: DecimalString;
  swap: DecimalString;
  commission: DecimalString;
  net: DecimalString;
}

export interface TradePage extends Paged<Trade> {
  /** Totals across every matching trade, not just this page. */
  summary: TradeSummary;
}

export interface DailyPerformance {
  /** Business-timezone calendar day. */
  date: ISODate;
  netProfit: DecimalString;
  cumulative: DecimalString;
  lots: DecimalString;
  trades: number;
}

// ---------------------------------------------------------------------------
// Profit split and payouts
// ---------------------------------------------------------------------------

export interface ClientSplitRow extends SplitAmounts {
  clientId: string;
  clientCode: string;
  clientName: string;
  ibId: string | null;
  ibName: string;
  /** Average active capital across the month's trading days. */
  capital: DecimalString;
  /** Time-weighted share of the pool, as a percentage string ("6.7568"). */
  poolShare: DecimalString;
  /** Trading days this client had capital in the pool. */
  activeDays: number;
  split: SplitPercent;
  ibCommission: IBCommissionRule;
  /** Client's portion of the pool's net profit, before the split. */
  grossProfit: DecimalString;
  /** Unrecovered loss brought in (≤ 0). */
  carryIn: DecimalString;
  /** Unrecovered loss carried out (≤ 0). */
  carryOut: DecimalString;
  payoutStatus: PayoutStatus;
  /** Amount due/paid to the client (never negative). */
  payoutAmount: DecimalString;
  paidAt?: ISODate;
}

export interface Payout {
  month: MonthKey;
  partyType: PartyType;
  /** Client or IB id; "trader" for the trader. */
  partyId: string;
  name: string;
  amount: DecimalString;
  status: PayoutStatus;
  paidAt?: ISODate;
}

export interface MonthlySplit extends SplitAmounts {
  month: MonthKey;
  status: MonthStatus;
  finalizedAt?: ISODate;
  netProfit: DecimalString;
  /** Average pool capital across trading days. */
  totalCapital: DecimalString;
  tradingDays: number;
  /** Rounding cents and profit from days with no invested client; included in `company`. */
  companyAdjustment: DecimalString;
  lossHandling: LossHandling;
  rows: ClientSplitRow[];
  /** Trader and IB payouts for the month. */
  partyPayouts: Payout[];
  /** Why this month can't be finalized/reopened right now, or null if it can. */
  finalizeBlocker: string | null;
  reopenBlocker: string | null;
}

// ---------------------------------------------------------------------------
// Settings, users and audit
// ---------------------------------------------------------------------------

/** Sync freshness: green < 5 min, amber < 30 min, red otherwise (or the last sync failed). */
export type SyncHealth = "green" | "amber" | "red" | "none";

/** Overall MT5 state, for the top bar and the admin alert banner. */
export interface Mt5Summary {
  /** Active, non-demo accounts. */
  accounts: number;
  /** Most recent successful sync across active accounts. */
  lastSyncAt: ISODateTime | null;
  health: SyncHealth;
  /** Unresolved sync warnings (e.g. deals that arrived for a finalized month). */
  openWarnings: number;
  /** True while seeded demo trades are still in the database. */
  demoData: boolean;
}

export interface Mt5Account {
  id: string;
  label: string;
  login: number;
  server: string;
  /** UTC = broker server time − this offset. */
  brokerTimezoneOffsetMinutes: number;
  /** Offset the worker measured on its last sync; null if the market was closed. */
  detectedOffsetMinutes: number | null;
  isActive: boolean;
  isDemo: boolean;
  /** Null = the pooled account shared by all clients. */
  linkedClientId: string | null;
  linkedClientName: string | null;
  /** The broker server type, as MT5 reports it once synced. */
  environment: "live" | "demo";
  currency: string | null;
  leverage: number | null;
  /** An investor password is stored (encrypted). The password itself is never sent to the UI. */
  passwordSet: boolean;
  syncState: Mt5SyncState;
  lastSyncAt: ISODateTime | null;
  lastSyncStatus: "ok" | "error" | null;
  lastError: string | null;
  /** "auth" = MT5 rejected the investor password or server. */
  lastErrorKind: "auth" | "other" | null;
  balance: DecimalString | null;
  equity: DecimalString | null;
  margin: DecimalString | null;
  floatingPl: DecimalString | null;
  openPositions: number;
  health: SyncHealth;
}

/**
 * - `paused`: not synced (inactive).
 * - `no_password`: no investor password stored yet.
 * - `waiting`: never synced yet ("Waiting for first sync").
 * - `ok` / `error`: result of the last attempt.
 */
export type Mt5SyncState = "paused" | "no_password" | "waiting" | "ok" | "error";

export interface Mt5AccountInput {
  label: string;
  login: number;
  server: string;
  brokerTimezoneOffsetMinutes: number;
  isActive: boolean;
  linkedClientId: string | null;
  /** Write-only. Omit to keep the stored one. */
  investorPassword?: string;
}

/**
 * How a balance operation counts:
 * - `deposit` / `withdrawal`: changes the client's capital.
 * - `fee_payment`: the client paying the trader/company share of a month; not capital.
 * - `ignore`: counts for nothing (credit, bonus, broker corrections, …).
 */
export type CashClass = "deposit" | "withdrawal" | "fee_payment" | "ignore";

/** A balance operation from MT5 (deposit, credit, bonus, charge, …). Never trading profit. */
export interface CashEvent {
  accountLogin: number;
  accountLabel: string;
  /** The account's client; null for a pooled account. */
  clientId: string | null;
  clientName: string | null;
  dealTicket: number;
  time: ISODateTime;
  kind: string;
  amount: DecimalString;
  comment: string | null;
  /** Suggested from the deal type and sign until an admin confirms. */
  suggestedClass: CashClass;
  /** Null = needs review. */
  classification: CashClass | null;
  /** For a fee payment: the month whose fee it pays. */
  feeMonth: MonthKey | null;
  reviewedAt: ISODateTime | null;
  reviewedBy: string | null;
}

export interface SyncWarning {
  id: number;
  accountLogin: number;
  accountLabel: string;
  kind: string;
  month: string;
  message: string;
  occurrences: number;
  firstSeenAt: ISODateTime;
  lastSeenAt: ISODateTime;
}

export interface IngestCounts {
  inserted: number;
  updated: number;
  ignored: number;
}

export interface IngestResult extends IngestCounts {
  cashEvents: IngestCounts;
  positions: number;
  recomputedMonths: MonthKey[];
  warnings: string[];
}

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Settings {
  defaultSplit: SplitPercent;
  lossHandling: LossHandling;
  /** IB commissions are calculated and shown only when on (off until the rule is decided). */
  ibCommissionsEnabled: boolean;
  /** How often the worker syncs every account. */
  syncIntervalSeconds: number;
  /** IANA zone that defines a business "day", e.g. "Asia/Karachi". */
  businessTimezone: string;
  /** MT5 symbols that count as pool (gold) trading; matched ignoring case and broker suffixes. */
  goldSymbols: string[];
  mt5: Mt5Summary;
  profile: AdminProfile;
}

export interface SettingsUpdate {
  defaultSplit?: SplitPercent;
  lossHandling?: LossHandling;
  businessTimezone?: string;
  goldSymbols?: string[];
  ibCommissionsEnabled?: boolean;
  syncIntervalSeconds?: number;
  profile?: Pick<AdminProfile, "name" | "email">;
}

export interface AdminUser extends AdminProfile {
  createdAt: ISODateTime;
}

export interface CreateUserInput {
  name: string;
  email: string;
  role: Role;
  password: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  /** Set a new password for the user. */
  password?: string;
}

export interface AuditEntry {
  id: number;
  at: ISODateTime;
  userEmail: string;
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface AuditQuery {
  action?: string;
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardStats {
  month: MonthKey;
  totalInvestedCapital: DecimalString;
  /** Net deposits minus withdrawals during the month. */
  capitalFlow: DecimalString;
  netProfit: DecimalString;
  /** Net profit of the previous month, for comparison. */
  previousNetProfit: DecimalString;
  lots: DecimalString;
  tradeCount: number;
  activeClients: number;
  newClients: number;
  activeIbs: number;
  totalIbs: number;
  distribution: SplitAmounts;
  recentTrades: Trade[];
}

export interface GoldSpot {
  price: DecimalString;
  changePct: DecimalString;
  asOf: ISODateTime;
}
