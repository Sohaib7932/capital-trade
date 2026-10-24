/**
 * API client — the only way pages and components get data.
 *
 * Calls this app's route handlers under `/api` (backed by Neon Postgres).
 * Errors come back as `{ detail }` and are thrown as `ApiError`.
 */
import type {
  AdminProfile,
  CashClass,
  CashEvent,
  DirectSummary,
  NewClientAccount,
  DecimalString,
  ISODateTime,
  Mt5Account,
  Mt5AccountInput,
  SyncWarning,
  AdminUser,
  AuditEntry,
  AuditQuery,
  ClientDetail,
  ClientPage,
  ClientQuery,
  CreateClientInput,
  CreateUserInput,
  DailyPerformance,
  DashboardStats,
  GoldSpot,
  IB,
  IBDetail,
  IBInput,
  IBSummary,
  MonthKey,
  MonthlySplit,
  Paged,
  PartyType,
  Payout,
  Settings,
  SettingsUpdate,
  TradeFilters,
  TradePage,
  TradeQuery,
  TransactionInput,
  UpdateClientInput,
  UpdateIBInput,
  UpdateUserInput,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 = no response (network), 408 = timed out. */
    readonly status: number,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ApiError";
  }
}

const API_URL = "/api";

type Query = Record<string, string | number | undefined>;

function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function redirectToLogin(path: string, status: number): void {
  // Session missing or expired: go to sign-in (except for the sign-in call itself).
  if (status === 401 && path !== "/auth/login" && typeof window !== "undefined") {
    // A full page load (not router.push) drops every page kept alive in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
}

/** A request that gets no answer within this time fails (and reads are retried). */
const TIMEOUT_MS = 20_000;
/** Reads are retried after these delays on network errors, timeouts and 502/503/504 (cold starts, deploys). */
const RETRY_DELAYS_MS = [600, 2_000];
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new ApiError("The server took too long to answer. Please try again.", 408);
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, err);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchApi(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  const requestInit: RequestInit = {
    ...rest,
    credentials: "include",
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  };
  // Only reads are retried: repeating a write could apply it twice.
  const retries = (rest.method ?? "GET").toUpperCase() === "GET" ? RETRY_DELAYS_MS : [];
  let res: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchOnce(`${API_URL}${path}`, requestInit);
      if (!RETRYABLE_STATUS.has(res.status) || attempt >= retries.length) break;
    } catch (err) {
      if (attempt >= retries.length) throw err;
    }
    await sleep(retries[attempt]);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    redirectToLogin(path, res.status);
    throw new ApiError(body?.detail ?? res.statusText, res.status);
  }
  return res;
}

export async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await fetchApi(path, init);
  return (await res.json()) as T;
}

/** Like `request`, but resolves to null on 404. */
async function requestOrNull<T>(path: string): Promise<T | null> {
  try {
    return await request<T>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Download a file (PDF, Excel) from the API and save it with the server's filename. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetchApi(path);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

// --- Auth and the signed-in user ----------------------------------------------

export function login(email: string, password: string, remember: boolean): Promise<AdminProfile> {
  return request("/auth/login", { method: "POST", json: { email, password, remember } });
}

export function logout(): Promise<void> {
  return request("/auth/logout", { method: "POST" });
}

export function getMe(): Promise<AdminProfile> {
  return request("/me");
}

export function updateProfile(profile: Pick<AdminProfile, "name" | "email">): Promise<AdminProfile> {
  return request("/me", { method: "PATCH", json: profile });
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return request("/me/password", { method: "POST", json: { currentPassword, newPassword } });
}

// --- Dashboard ---------------------------------------------------------------

/** Months that have data, newest first. */
export function getAvailableMonths(): Promise<MonthKey[]> {
  return request("/months");
}

export function getDashboardStats(month: MonthKey): Promise<DashboardStats> {
  return request(withQuery("/dashboard", { month }));
}

export function getDailyPerformance(month: MonthKey): Promise<DailyPerformance[]> {
  return request(withQuery("/daily", { month }));
}

export function getGoldSpot(): Promise<GoldSpot> {
  return request("/gold-spot");
}

// --- Clients and transactions --------------------------------------------------

export function getClients(query: ClientQuery = {}): Promise<ClientPage> {
  return request(withQuery("/clients", { ...query }));
}

export function getClient(id: string, month?: MonthKey): Promise<ClientDetail | null> {
  return requestOrNull(withQuery(`/clients/${encodeURIComponent(id)}`, { month }));
}

export function createClient(input: CreateClientInput): Promise<ClientDetail> {
  return request("/clients", { method: "POST", json: input });
}

export function updateClient(id: string, input: UpdateClientInput): Promise<ClientDetail> {
  return request(`/clients/${encodeURIComponent(id)}`, { method: "PATCH", json: input });
}

export function addTransaction(clientId: string, input: TransactionInput): Promise<ClientDetail> {
  return request(`/clients/${encodeURIComponent(clientId)}/transactions`, { method: "POST", json: input });
}

export function updateTransaction(id: string, input: TransactionInput): Promise<ClientDetail> {
  return request(`/transactions/${encodeURIComponent(id)}`, { method: "PATCH", json: input });
}

export function deleteTransaction(id: string): Promise<ClientDetail> {
  return request(`/transactions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function downloadStatement(clientId: string, month: MonthKey): Promise<void> {
  return download(withQuery(`/clients/${encodeURIComponent(clientId)}/statement`, { month }), `statement-${month}.pdf`);
}

// --- IBs ---------------------------------------------------------------------

export function getIBs(month?: MonthKey): Promise<IBSummary[]> {
  return request(withQuery("/ibs", { month }));
}

export function getIB(id: string, month?: MonthKey): Promise<IBDetail | null> {
  return requestOrNull(withQuery(`/ibs/${encodeURIComponent(id)}`, { month }));
}

export function createIB(input: IBInput): Promise<IB> {
  return request("/ibs", { method: "POST", json: input });
}

export function updateIB(id: string, input: UpdateIBInput): Promise<IB> {
  return request(`/ibs/${encodeURIComponent(id)}`, { method: "PATCH", json: input });
}

// --- Trades ------------------------------------------------------------------

/** A page of trades (sorted, filtered and paged on the server) plus totals for the filter. */
export function getTrades(query: TradeQuery = {}): Promise<TradePage> {
  return request(withQuery("/trades", { ...query }));
}

/** Per-day totals for the Trades calendar. */
export function getTradeDays(filters: TradeFilters): Promise<DailyPerformance[]> {
  return request(withQuery("/trades/days", { ...filters }));
}

// --- Profit split and payouts ------------------------------------------------------

export function getMonthlySplit(month: MonthKey): Promise<MonthlySplit> {
  return request(`/profit-split/${month}`);
}

/** Lock a month: freeze every client's numbers and create payouts. */
export function finalizeMonth(month: MonthKey): Promise<MonthlySplit> {
  return request(`/profit-split/${month}/finalize`, { method: "POST" });
}

export function reopenMonth(month: MonthKey, reason: string): Promise<MonthlySplit> {
  return request(`/profit-split/${month}/reopen`, { method: "POST", json: { reason } });
}

export function markPaid(month: MonthKey, partyType: PartyType, partyId: string): Promise<Payout> {
  return request(`/profit-split/${month}/payouts`, { method: "POST", json: { partyType, partyId } });
}

// --- Exports -------------------------------------------------------------------

export function exportProfitSplit(month: MonthKey): Promise<void> {
  return download(`/exports/profit-split?month=${month}`, `profit-split-${month}.xlsx`);
}

export function exportTrades(filters: TradeFilters): Promise<void> {
  return download(withQuery("/exports/trades", { ...filters }), "trades.xlsx");
}

export function exportClients(query: Omit<ClientQuery, "page" | "pageSize">): Promise<void> {
  return download(withQuery("/exports/clients", { ...query }), "clients.xlsx");
}

// --- Settings, users and audit -------------------------------------------------------

export function getSettings(): Promise<Settings> {
  return request("/settings");
}

export function updateSettings(update: Omit<SettingsUpdate, "profile">): Promise<Settings> {
  return request("/settings", { method: "PATCH", json: update });
}

export function getUsers(): Promise<AdminUser[]> {
  return request("/users");
}

export function createUser(input: CreateUserInput): Promise<AdminUser> {
  return request("/users", { method: "POST", json: input });
}

export function updateUser(id: string, input: UpdateUserInput): Promise<AdminUser> {
  return request(`/users/${encodeURIComponent(id)}`, { method: "PATCH", json: input });
}

export function deleteUser(id: string): Promise<void> {
  return request(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getAuditLog(query: AuditQuery = {}): Promise<Paged<AuditEntry>> {
  return request(withQuery("/audit", { ...query }));
}

// --- MT5 ---------------------------------------------------------------------------

export interface Mt5Position {
  ticket: number;
  symbol: string;
  type: "buy" | "sell";
  volume: DecimalString;
  openTime: ISODateTime;
  openPrice: DecimalString;
  currentPrice: DecimalString;
  profit: DecimalString;
  swap: DecimalString;
}

export function getMt5Accounts(): Promise<Mt5Account[]> {
  return request("/mt5/accounts");
}

export function createMt5Account(input: Mt5AccountInput): Promise<Mt5Account> {
  return request("/mt5/accounts", { method: "POST", json: input });
}

export function updateMt5Account(id: string, input: Mt5AccountInput): Promise<Mt5Account> {
  return request(`/mt5/accounts/${encodeURIComponent(id)}`, { method: "PATCH", json: input });
}

export function deleteMt5Account(id: string): Promise<void> {
  return request(`/mt5/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getMt5Positions(id: string): Promise<Mt5Position[]> {
  return request(`/mt5/accounts/${encodeURIComponent(id)}/positions`);
}

export function getCashEvents(
  query: { page?: number; pageSize?: number; unreviewed?: boolean; clientId?: string } = {},
): Promise<Paged<CashEvent>> {
  return request(
    withQuery("/mt5/cash-events", {
      page: query.page,
      pageSize: query.pageSize,
      unreviewed: query.unreviewed ? "true" : undefined,
      clientId: query.clientId,
    }),
  );
}

/** Add an MT5 account to a client (or link an existing pooled one). */
export function addClientAccount(clientId: string, input: NewClientAccount): Promise<Mt5Account[]> {
  return request(`/clients/${encodeURIComponent(clientId)}/accounts`, { method: "POST", json: input });
}

/** Replace an account's investor password. It is encrypted on the server and never returned. */
export function replaceAccountPassword(accountId: string, investorPassword: string): Promise<Mt5Account> {
  return request(`/mt5/accounts/${encodeURIComponent(accountId)}/password`, { method: "PUT", json: { investorPassword } });
}

export function getDirectSummary(month?: MonthKey): Promise<DirectSummary> {
  return request(withQuery("/ibs/direct", { month }));
}

export function classifyCashEvent(input: {
  accountLogin: number;
  dealTicket: number;
  classification: CashClass;
  feeMonth?: MonthKey;
}): Promise<void> {
  return request("/mt5/cash-events/review", { method: "POST", json: input });
}

export function getSyncWarnings(): Promise<SyncWarning[]> {
  return request("/mt5/warnings");
}

export function resolveSyncWarning(id: number): Promise<void> {
  return request(`/mt5/warnings/${id}`, { method: "DELETE" });
}
