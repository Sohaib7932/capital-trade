import { monthOf, monthStart, toISODate } from "@/lib/dates";
import { syncHealth } from "@/lib/mt5";
import type { CashEvent, Mt5Account, Mt5AccountInput, Paged, SyncWarning } from "@/lib/types";
import { recomputeMonths, type Queryable } from "./allocations";
import { audit, diff } from "./audit";
import type { SessionUser } from "./auth";
import { pool, transaction } from "./db";
import { badRequest, conflict, notFound } from "./errors";

const utc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

interface AccountRow extends Omit<Mt5Account, "health" | "login"> {
  login: string;
}

const ACCOUNT_SQL = `
  SELECT a.id, a.label, a.login::text AS login, a.server,
         a.broker_timezone_offset_minutes AS "brokerTimezoneOffsetMinutes",
         a.detected_offset_minutes AS "detectedOffsetMinutes",
         a.is_active AS "isActive", a.is_demo AS "isDemo",
         a.linked_client_id AS "linkedClientId", c.full_name AS "linkedClientName",
         ${utc("a.last_sync_at")} AS "lastSyncAt", a.last_sync_status AS "lastSyncStatus", a.last_error AS "lastError",
         a.balance::text AS balance, a.equity::text AS equity, a.margin::text AS margin, a.floating_pl::text AS "floatingPl",
         (SELECT count(*)::int FROM mt5_positions p WHERE p.account_login = a.login) AS "openPositions"
    FROM mt5_accounts a LEFT JOIN clients c ON c.id = a.linked_client_id`;

function toAccount(row: AccountRow, now: Date): Mt5Account {
  return {
    ...row,
    login: Number(row.login),
    health: row.isDemo ? "none" : syncHealth(row.lastSyncAt, row.lastSyncStatus, now),
  };
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
  const id = await transaction(async (tx) => {
    const taken = await tx.query("SELECT 1 FROM mt5_accounts WHERE login = $1", [input.login]);
    if (taken.rowCount) throw conflict(`An account with login ${input.login} already exists`);
    await assertClient(tx, input.linkedClientId);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO mt5_accounts (label, login, server, broker_timezone_offset_minutes, is_active, linked_client_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.label.trim(), input.login, input.server.trim(), input.brokerTimezoneOffsetMinutes, input.isActive, input.linkedClientId],
    );
    await audit(tx, user, {
      action: "mt5.account.create",
      entityType: "mt5_account",
      entityId: rows[0].id,
      summary: `Added MT5 account ${input.label.trim()} (${input.login} @ ${input.server.trim()})`,
      details: { ...input },
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
  await transaction(async (tx) => {
    const { rows } = await tx.query<{
      login: string;
      label: string;
      server: string;
      broker_timezone_offset_minutes: number;
      is_active: boolean;
      linked_client_id: string | null;
      is_demo: boolean;
    }>("SELECT login::text, label, server, broker_timezone_offset_minutes, is_active, linked_client_id, is_demo FROM mt5_accounts WHERE id = $1 FOR UPDATE", [id]);
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
              linked_client_id = $7
        WHERE id = $1`,
      [id, input.label.trim(), input.login, input.server.trim(), input.brokerTimezoneOffsetMinutes, input.isActive, input.linkedClientId],
    );

    const delta = input.brokerTimezoneOffsetMinutes - before.broker_timezone_offset_minutes;
    let shifted = 0;
    if (delta !== 0) {
      // UTC = server − offset, so a larger offset moves stored UTC times earlier.
      const { rows: last } = await tx.query<{ month: string | null }>("SELECT max(month) AS month FROM months WHERE status = 'finalized'");
      const from = last[0]?.month ? monthStart(nextMonth(last[0].month)) : "0001-01-01";
      const shift = await tx.query(
        `UPDATE mt5_deals SET time = time - make_interval(mins => $2), updated_at = now()
          WHERE account_login = $1 AND time >= $3::date`,
        [input.login, delta, from],
      );
      shifted = shift.rowCount ?? 0;
      await tx.query("UPDATE account_cash_events SET time = time - make_interval(mins => $2) WHERE account_login = $1 AND time >= $3::date", [
        input.login,
        delta,
        from,
      ]);
      await tx.query("UPDATE mt5_positions SET open_time = open_time - make_interval(mins => $2) WHERE account_login = $1", [input.login, delta]);
      await tx.query("UPDATE sync_warnings SET resolved_at = now(), resolved_by = $2 WHERE account_login = $1 AND kind = 'offset_mismatch' AND resolved_at IS NULL", [
        input.login,
        user.email,
      ]);
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
        input,
      ),
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
    const { rows } = await tx.query<{ login: string; label: string; deals: number }>(
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

export async function listCashEvents(query: { page: number; pageSize: number; unreviewed?: boolean }): Promise<Paged<CashEvent>> {
  const { rows } = await pool().query<{ rows: CashEvent[] | null; total: number }>(
    `WITH f AS (SELECT * FROM account_cash_events WHERE NOT $1::boolean OR reviewed_at IS NULL)
     SELECT
       (SELECT json_agg(r) FROM (
          SELECT f.account_login AS "accountLogin", a.label AS "accountLabel", f.deal_ticket AS "dealTicket",
                 ${utc("f.time")} AS time, f.kind, f.amount::text AS amount, f.comment,
                 ${utc("f.reviewed_at")} AS "reviewedAt", f.reviewed_by AS "reviewedBy"
            FROM f JOIN mt5_accounts a ON a.login = f.account_login
           ORDER BY f.time DESC, f.deal_ticket DESC LIMIT $2 OFFSET $3) r) AS rows,
       (SELECT count(*)::int FROM f) AS total`,
    [query.unreviewed ?? false, query.pageSize, query.page * query.pageSize],
  );
  return { rows: rows[0].rows ?? [], total: rows[0].total };
}

export async function reviewCashEvent(user: SessionUser, accountLogin: number, dealTicket: number): Promise<void> {
  await transaction(async (tx) => {
    const { rows } = await tx.query<{ kind: string; amount: string }>(
      `UPDATE account_cash_events SET reviewed_at = now(), reviewed_by = $3
        WHERE account_login = $1 AND deal_ticket = $2 AND reviewed_at IS NULL RETURNING kind, amount::text`,
      [accountLogin, dealTicket, user.email],
    );
    if (!rows[0]) throw notFound("No unreviewed cash event with that ticket");
    await audit(tx, user, {
      action: "mt5.cash.review",
      entityType: "cash_event",
      entityId: `${accountLogin}:${dealTicket}`,
      summary: `Reviewed MT5 ${rows[0].kind} of ${rows[0].amount} (deal ${dealTicket}, account ${accountLogin})`,
    });
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
  return rows.map((r) => ({ ...r, id: Number(r.id), accountLogin: Number(r.accountLogin) }));
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
