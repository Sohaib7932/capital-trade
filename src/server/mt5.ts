import { monthOf, monthStart, toISODate } from "@/lib/dates";
import { syncHealth } from "@/lib/mt5";
import type { CashClass, CashEvent, Mt5Account, Mt5AccountInput, Mt5SyncState, Paged, SyncWarning } from "@/lib/types";
import { recomputeMonths, type Queryable } from "./allocations";
import { audit, diff } from "./audit";
import type { SessionUser } from "./auth";
import { encryptInvestorPassword } from "./credentials";
import { pool, transaction } from "./db";
import { badRequest, conflict, notFound } from "./errors";

const utc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

interface AccountRow extends Omit<Mt5Account, "health" | "login" | "syncState"> {
  login: string;
}

const ACCOUNT_SQL = `
  SELECT a.id, a.label, a.login::text AS login, a.server,
         a.broker_timezone_offset_minutes AS "brokerTimezoneOffsetMinutes",
         a.detected_offset_minutes AS "detectedOffsetMinutes",
         a.is_active AS "isActive", a.is_demo AS "isDemo",
         a.linked_client_id AS "linkedClientId", c.full_name AS "linkedClientName",
         a.environment, a.currency, a.leverage, (a.investor_password_enc IS NOT NULL) AS "passwordSet",
         ${utc("a.last_sync_at")} AS "lastSyncAt", a.last_sync_status AS "lastSyncStatus", a.last_error AS "lastError",
         a.last_error_kind AS "lastErrorKind",
         a.balance::text AS balance, a.equity::text AS equity, a.margin::text AS margin, a.floating_pl::text AS "floatingPl",
         (SELECT count(*)::int FROM mt5_positions p WHERE p.account_login = a.login) AS "openPositions"
    FROM mt5_accounts a LEFT JOIN clients c ON c.id = a.linked_client_id`;

function syncState(row: AccountRow): Mt5SyncState {
  if (!row.isActive) return "paused";
  if (row.lastSyncStatus === "error") return "error";
  if (row.lastSyncAt) return "ok";
  return row.passwordSet || row.isDemo ? "waiting" : "no_password";
}

function toAccount(row: AccountRow, now: Date): Mt5Account {
  return {
    ...row,
    login: Number(row.login),
    syncState: syncState(row),
    health: row.isDemo ? "none" : syncHealth(row.lastSyncAt, row.lastSyncStatus, now),
  };
}

/** Audit details for an account input: never the password, only whether one was given. */
function auditable({ investorPassword, ...input }: Mt5AccountInput) {
  return investorPassword ? { ...input, investorPassword: "(replaced)" } : input;
}

export async function listAccounts(): Promise<Mt5Account[]> {
  const { rows } = await pool().query<AccountRow>(`${ACCOUNT_SQL} ORDER BY a.is_demo, a.label`);
  const now = new Date();
  return rows.map((r) => toAccount(r, now));
}

async function getAccount(id: string): Promise<Mt5Account> {
  const { rows } = await pool().query<AccountRow>(`${ACCOUNT_SQL} WHERE a.id = $1`, [id]);
  if (!rows[0]) throw notFound("MT5 account not found");
  return toAccount(rows[0], new Date());
}

async function assertClient(db: Queryable, clientId: string | null) {
  if (!clientId) return;
  const { rows } = await db.query("SELECT 1 FROM clients WHERE id = $1", [clientId]);
  if (!rows.length) throw badRequest("Unknown client");
}

export async function createAccount(user: SessionUser, input: Mt5AccountInput): Promise<Mt5Account> {
  // Encrypt before touching the database: the plain password is never stored.
  const encrypted = input.investorPassword ? encryptInvestorPassword(input.investorPassword) : null;
  const id = await transaction(async (tx) => {
    const taken = await tx.query("SELECT 1 FROM mt5_accounts WHERE login = $1", [input.login]);
    if (taken.rowCount) throw conflict(`An account with login ${input.login} already exists`);
    await assertClient(tx, input.linkedClientId);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO mt5_accounts (label, login, server, broker_timezone_offset_minutes, is_active, linked_client_id, environment,
                                 investor_password_enc, password_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $3 ILIKE '%demo%' THEN 'demo' ELSE 'live' END, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE now() END)
       RETURNING id`,
      [
        input.label.trim(),
        input.login,
        input.server.trim(),
        input.brokerTimezoneOffsetMinutes,
        input.isActive,
        input.linkedClientId,
        encrypted,
      ],
    );
    await audit(tx, user, {
      action: "mt5.account.create",
      entityType: "mt5_account",
      entityId: rows[0].id,
      summary: `Added MT5 account ${input.label.trim()} (${input.login} @ ${input.server.trim()})`,
      details: auditable(input),
    });
    return rows[0].id;
  });
  return getAccount(id);
}

/**
 * Edit an account. If the timezone offset changes, the account's stored deals
 * in open months are shifted to match (finalized months are never touched), and
 * open months are recalculated. Pausing or linking an account also recalculates.
 */
export async function updateAccount(user: SessionUser, id: string, input: Mt5AccountInput): Promise<Mt5Account> {
  const encrypted = input.investorPassword ? encryptInvestorPassword(input.investorPassword) : null;
  await transaction(async (tx) => {
    const { rows } = await tx.query<{
      login: string;
      label: string;
      server: string;
      broker_timezone_offset_minutes: number;
      is_active: boolean;
      linked_client_id: string | null;
      is_demo: boolean;
    }>(
      "SELECT login::text, label, server, broker_timezone_offset_minutes, is_active, linked_client_id, is_demo FROM mt5_accounts WHERE id = $1 FOR UPDATE",
      [id],
    );
    const before = rows[0];
    if (!before) throw notFound("MT5 account not found");
    if (before.is_demo) throw badRequest("The demo data account can't be edited");
    if (Number(before.login) !== input.login) {
      const { rowCount } = await tx.query("SELECT 1 FROM mt5_deals WHERE account_login = $1 LIMIT 1", [before.login]);
      if (rowCount) throw badRequest("The login can't change once deals have synced. Add a new account instead.");
    }
    await assertClient(tx, input.linkedClientId);

    await tx.query(
      `UPDATE mt5_accounts SET label = $2, login = $3, server = $4, broker_timezone_offset_minutes = $5, is_active = $6,
              linked_client_id = $7,
              investor_password_enc = COALESCE($8, investor_password_enc),
              password_updated_at = CASE WHEN $8::text IS NULL THEN password_updated_at ELSE now() END
        WHERE id = $1`,
      [
        id,
        input.label.trim(),
        input.login,
        input.server.trim(),
        input.brokerTimezoneOffsetMinutes,
        input.isActive,
        input.linkedClientId,
        encrypted,
      ],
    );

    const delta = input.brokerTimezoneOffsetMinutes - before.broker_timezone_offset_minutes;
    let shifted = 0;
    if (delta !== 0) {
      // UTC = server − offset, so a larger offset moves stored UTC times earlier.
      const { rows: last } = await tx.query<{ month: string | null }>(
        "SELECT max(month) AS month FROM months WHERE status = 'finalized'",
      );
      const from = last[0]?.month ? monthStart(nextMonth(last[0].month)) : "0001-01-01";
      const shift = await tx.query(
        `UPDATE mt5_deals SET time = time - make_interval(mins => $2), updated_at = now()
          WHERE account_login = $1 AND time >= $3::date`,
        [input.login, delta, from],
      );
      shifted = shift.rowCount ?? 0;
      await tx.query(
        "UPDATE account_cash_events SET time = time - make_interval(mins => $2) WHERE account_login = $1 AND time >= $3::date",
        [input.login, delta, from],
      );
      await tx.query("UPDATE mt5_positions SET open_time = open_time - make_interval(mins => $2) WHERE account_login = $1", [
        input.login,
        delta,
      ]);
      await tx.query(
        "UPDATE sync_warnings SET resolved_at = now(), resolved_by = $2 WHERE account_login = $1 AND kind = 'offset_mismatch' AND resolved_at IS NULL",
        [input.login, user.email],
      );
    }
    if (delta !== 0 || before.is_active !== input.isActive || before.linked_client_id !== input.linkedClientId) {
      await recomputeMonths(tx, { today: monthOf(toISODate(new Date())) });
    }

    await audit(tx, user, {
      action: "mt5.account.update",
      entityType: "mt5_account",
      entityId: id,
      summary: `Edited MT5 account ${input.label.trim()} (${input.login})${shifted ? `; shifted ${shifted} open-month deals by ${-delta} min` : ""}`,
      details: diff(
        {
          label: before.label,
          login: Number(before.login),
          server: before.server,
          brokerTimezoneOffsetMinutes: before.broker_timezone_offset_minutes,
          isActive: before.is_active,
          linkedClientId: before.linked_client_id,
        },
        auditable(input),
      ),
    });
  });
  return getAccount(id);
}

/** Replace an account's investor password (stored encrypted; the next sync uses it). */
export async function replaceAccountPassword(user: SessionUser, id: string, password: string): Promise<Mt5Account> {
  const encrypted = encryptInvestorPassword(password);
  await transaction(async (tx) => {
    const { rows } = await tx.query<{ login: string; label: string }>(
      `UPDATE mt5_accounts SET investor_password_enc = $2, password_updated_at = now()
        WHERE id = $1 AND NOT is_demo RETURNING login::text, label`,
      [id, encrypted],
    );
    if (!rows[0]) throw notFound("MT5 account not found");
    await audit(tx, user, {
      action: "mt5.account.password",
      entityType: "mt5_account",
      entityId: id,
      summary: `Replaced the investor password of MT5 account ${rows[0].label} (${rows[0].login})`,
    });
  });
  return getAccount(id);
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Delete an account that has never synced a deal (otherwise pause it instead). */
export async function deleteAccount(user: SessionUser, id: string): Promise<void> {
  await transaction(async (tx) => {
    const { rows } = await tx.query<{
      login: string;
      label: string;
      deals: number;
    }>(
      `SELECT a.login::text, a.label, (SELECT count(*)::int FROM mt5_deals d WHERE d.account_login = a.login) AS deals
         FROM mt5_accounts a WHERE a.id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows[0]) throw notFound("MT5 account not found");
    if (rows[0].deals > 0) throw badRequest("This account has synced deals. Pause it instead so its history stays intact.");
    await tx.query("DELETE FROM mt5_accounts WHERE id = $1", [id]);
    await audit(tx, user, {
      action: "mt5.account.delete",
      entityType: "mt5_account",
      entityId: id,
      summary: `Deleted MT5 account ${rows[0].label} (${rows[0].login})`,
    });
  });
}

export interface Mt5PositionRow {
  ticket: number;
  symbol: string;
  type: "buy" | "sell";
  volume: string;
  openTime: string;
  openPrice: string;
  currentPrice: string;
  profit: string;
  swap: string;
}

export async function listPositions(id: string): Promise<Mt5PositionRow[]> {
  const { rows } = await pool().query<Mt5PositionRow>(
    `SELECT p.ticket, p.symbol, p.type, p.volume::text AS volume, ${utc("p.open_time")} AS "openTime",
            p.open_price::text AS "openPrice", p.current_price::text AS "currentPrice", p.profit::text AS profit, p.swap::text AS swap
       FROM mt5_positions p JOIN mt5_accounts a ON a.login = p.account_login
      WHERE a.id = $1 ORDER BY p.open_time DESC`,
    [id],
  );
  return rows.map((r) => ({ ...r, ticket: Number(r.ticket) }));
}

// --- Cash events -------------------------------------------------------------------

export async function listCashEvents(query: {
  page: number;
  pageSize: number;
  /** Only events that still need review. */
  unreviewed?: boolean;
  clientId?: string;
}): Promise<Paged<CashEvent>> {
  const { rows } = await pool().query<{
    rows:
      | (Omit<CashEvent, "accountLogin" | "dealTicket"> & {
          accountLogin: string;
          dealTicket: string;
        })[]
      | null;
    total: number;
  }>(
    `WITH f AS (
       SELECT e.*, a.label, a.linked_client_id
         FROM account_cash_events e JOIN mt5_accounts a ON a.login = e.account_login
        WHERE (NOT $1::boolean OR e.classification IS NULL) AND ($4::text IS NULL OR a.linked_client_id = $4))
     SELECT
       (SELECT json_agg(r) FROM (
          SELECT f.account_login::text AS "accountLogin", f.label AS "accountLabel", f.linked_client_id AS "clientId",
                 c.full_name AS "clientName", f.deal_ticket::text AS "dealTicket", ${utc("f.time")} AS time, f.kind,
                 f.amount::text AS amount, f.comment, f.suggested_class AS "suggestedClass", f.classification,
                 f.fee_month AS "feeMonth", ${utc("f.reviewed_at")} AS "reviewedAt", f.reviewed_by AS "reviewedBy"
            FROM f LEFT JOIN clients c ON c.id = f.linked_client_id
           ORDER BY f.time DESC, f.deal_ticket DESC LIMIT $2 OFFSET $3) r) AS rows,
       (SELECT count(*)::int FROM f) AS total`,
    [query.unreviewed ?? false, query.pageSize, query.page * query.pageSize, query.clientId ?? null],
  );
  return {
    rows: (rows[0].rows ?? []).map((r) => ({
      ...r,
      accountLogin: Number(r.accountLogin),
      dealTicket: Number(r.dealTicket),
    })),
    total: rows[0].total,
  };
}

/**
 * Recalculate a client's fee payout for `month` from the fee-payment events that
 * pay it. Covered in full → paid (via MT5). No longer covered → back to pending,
 * unless an admin marked it paid by hand.
 */
export async function refreshFeePayout(db: Queryable, month: string, clientId: string): Promise<void> {
  await db.query(
    `WITH paid AS (
       SELECT COALESCE(sum(-e.amount), 0) AS total, max(e.time) AS last_at
         FROM account_cash_events e JOIN mt5_accounts a ON a.login = e.account_login
        WHERE a.linked_client_id = $2 AND e.classification = 'fee_payment' AND e.fee_month = $1),
     covered AS (
       SELECT p.month, p.party_type, p.party_id, p.amount IS NOT NULL AND paid.total >= p.amount AS ok, paid.total, paid.last_at
         FROM payouts p, paid
        WHERE p.month = $1 AND p.party_type = 'fee' AND p.party_id = $2)
     UPDATE payouts p SET
       paid_amount = c.total,
       status   = CASE WHEN c.ok THEN 'paid' WHEN p.paid_via = 'mt5' THEN 'pending' ELSE p.status END,
       paid_via = CASE WHEN c.ok THEN 'mt5' WHEN p.paid_via = 'mt5' THEN NULL ELSE p.paid_via END,
       paid_at  = CASE WHEN c.ok THEN (c.last_at AT TIME ZONE (SELECT business_timezone FROM settings WHERE id = 1))::date
                       WHEN p.paid_via = 'mt5' THEN NULL ELSE p.paid_at END
       FROM covered c
      WHERE p.month = c.month AND p.party_type = c.party_type AND p.party_id = c.party_id`,
    [month, clientId],
  );
}

/**
 * Classify a balance operation (or change its classification).
 * - deposit / withdrawal: creates the matching capital transaction for the account's client.
 * - fee_payment: pays the client's fee for `feeMonth` (oldest unpaid fee if omitted).
 * - ignore: counts for nothing.
 * Pooled accounts have no client, so their events can only be ignored.
 */
export interface CashClassificationInput {
  accountLogin: number;
  dealTicket: number;
  classification: CashClass;
  feeMonth?: string;
}

export async function classifyCashEvent(user: SessionUser, input: CashClassificationInput): Promise<void> {
  await transaction((tx) => applyCashClassification(tx, user, input));
}

/** The classification itself, inside the caller's transaction. */
export async function applyCashClassification(tx: Queryable, user: SessionUser, input: CashClassificationInput): Promise<void> {
  const { rows } = await tx.query<{
    amount: string;
    kind: string;
    classification: CashClass | null;
    fee_month: string | null;
    client_id: string | null;
    client_name: string | null;
    day: string;
  }>(
    `SELECT e.amount::text, e.kind, e.classification, e.fee_month, a.linked_client_id AS client_id, c.full_name AS client_name,
            to_char(e.time AT TIME ZONE (SELECT business_timezone FROM settings WHERE id = 1), 'YYYY-MM-DD') AS day
       FROM account_cash_events e JOIN mt5_accounts a ON a.login = e.account_login LEFT JOIN clients c ON c.id = a.linked_client_id
      WHERE e.account_login = $1 AND e.deal_ticket = $2 FOR UPDATE OF e`,
    [input.accountLogin, input.dealTicket],
  );
  const event = rows[0];
  if (!event) throw notFound("Cash event not found");
  const { classification } = input;
  const negative = event.amount.startsWith("-");
  const clientId = event.client_id;

  if (classification !== "ignore") {
    if (!clientId) throw badRequest("This account isn't linked to a client, so its cash events can only be ignored");
    if (classification === "deposit" && negative) throw badRequest("A deposit must be a positive amount");
    if (classification !== "deposit" && !negative) throw badRequest("Withdrawals and fee payments must be negative amounts");
  }

  let feeMonth: string | null = null;
  if (classification === "fee_payment") {
    feeMonth = input.feeMonth ?? null;
    if (!feeMonth) {
      const { rows: due } = await tx.query<{ month: string }>(
        "SELECT month FROM payouts WHERE party_type = 'fee' AND party_id = $1 AND status = 'pending' ORDER BY month LIMIT 1",
        [clientId],
      );
      feeMonth = due[0]?.month ?? null;
      if (!feeMonth) throw badRequest("This client has no unpaid fee. Choose the month this payment is for.");
    }
  }

  // Capital: exactly one generated transaction per deposit/withdrawal event.
  await tx.query("DELETE FROM transactions WHERE account_login = $1 AND deal_ticket = $2", [
    input.accountLogin,
    input.dealTicket,
  ]);
  if (classification === "deposit" || classification === "withdrawal") {
    await tx.query(
      `INSERT INTO transactions (id, client_id, type, amount, date, note, source, account_login, deal_ticket)
       VALUES ('tx-' || gen_random_uuid(), $1, $2, abs($3::numeric), $4, $5, 'mt5', $6, $7)`,
      [
        clientId,
        classification,
        event.amount,
        event.day,
        `MT5 ${input.accountLogin} deal ${input.dealTicket}`,
        input.accountLogin,
        input.dealTicket,
      ],
    );
  }

  await tx.query(
    `UPDATE account_cash_events SET classification = $3, fee_month = $4, reviewed_at = now(), reviewed_by = $5
      WHERE account_login = $1 AND deal_ticket = $2`,
    [input.accountLogin, input.dealTicket, classification, feeMonth, user.email],
  );
  if (clientId) {
    for (const month of new Set([event.fee_month, feeMonth].filter((m): m is string => m !== null))) {
      await refreshFeePayout(tx, month, clientId);
    }
  }

  const label = {
    deposit: "a deposit",
    withdrawal: "a withdrawal",
    fee_payment: `a fee payment for ${feeMonth}`,
    ignore: "ignored",
  }[classification];
  await audit(tx, user, {
    action: "mt5.cash.classify",
    entityType: "cash_event",
    entityId: `${input.accountLogin}:${input.dealTicket}`,
    summary: `Classified MT5 ${event.kind} of ${event.amount} (deal ${input.dealTicket}${event.client_name ? `, ${event.client_name}` : ""}) as ${label}`,
    details: {
      before: event.classification,
      after: classification,
      feeMonth,
    },
  });
}

// --- Sync warnings -------------------------------------------------------------------

export async function listWarnings(): Promise<SyncWarning[]> {
  const { rows } = await pool().query<SyncWarning & { accountLogin: string }>(
    `SELECT w.id, w.account_login::text AS "accountLogin", COALESCE(a.label, w.account_login::text) AS "accountLabel", w.kind,
            w.month, w.message, w.occurrences, ${utc("w.first_seen_at")} AS "firstSeenAt", ${utc("w.last_seen_at")} AS "lastSeenAt"
       FROM sync_warnings w LEFT JOIN mt5_accounts a ON a.login = w.account_login
      WHERE w.resolved_at IS NULL ORDER BY w.last_seen_at DESC`,
  );
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    accountLogin: Number(r.accountLogin),
  }));
}

export async function resolveWarning(user: SessionUser, id: number): Promise<void> {
  await transaction(async (tx) => {
    const { rows } = await tx.query<{ message: string }>(
      "UPDATE sync_warnings SET resolved_at = now(), resolved_by = $2 WHERE id = $1 AND resolved_at IS NULL RETURNING message",
      [id, user.email],
    );
    if (!rows[0]) throw notFound("Warning not found or already dismissed");
    await audit(tx, user, {
      action: "mt5.warning.resolve",
      entityType: "sync_warning",
      entityId: String(id),
      summary: `Dismissed sync warning: ${rows[0].message.slice(0, 160)}`,
    });
  });
}
