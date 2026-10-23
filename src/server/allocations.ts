import type { MonthKey } from "@/lib/types";

/** Anything that runs parameterised SQL: a pg Pool/PoolClient, or PGlite in tests. */
export interface Queryable {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Trading deals of active accounts within `month` (business timezone), with
 * their business day. $1 = month, $2 = timezone.
 */
const MONTH_DEALS = `
  SELECT dl.*, (dl.time AT TIME ZONE $2)::date AS day, a.linked_client_id
    FROM mt5_deals dl
    JOIN mt5_accounts a ON a.login = dl.account_login AND a.is_active
   WHERE dl.time >= ((($1 || '-01')::date)::timestamp AT TIME ZONE $2)
     AND dl.time <  (((($1 || '-01')::date) + interval '1 month')::timestamp AT TIME ZONE $2)`;

/**
 * Rebuild `daily_pnl` and `daily_allocations` for one month. Run inside a
 * transaction. Callers decide which months may change (open months only).
 *
 * - Day net = profit + swap + commission + fee of every trading deal that day
 *   (profit only appears on closing deals; entry commissions count on their day).
 * - Lots = volume of opening (IN) deals, so a round trip isn't counted twice.
 * - Pooled accounts: the day's net is shared by each client's active capital.
 *   Capital on day D = deposits dated before D − withdrawals dated on or before D.
 * - An account linked to one client: all of its net goes to that client.
 */
export async function recomputeMonth(db: Queryable, month: MonthKey, timezone: string): Promise<void> {
  await db.query("DELETE FROM daily_pnl WHERE month = $1", [month]); // cascades to daily_allocations

  await db.query(
    `WITH d AS (${MONTH_DEALS})
     INSERT INTO daily_pnl (day, month, net, linked_net, lots, trades)
     SELECT day, $1,
            sum(profit + swap + commission + fee),
            COALESCE(sum(profit + swap + commission + fee) FILTER (WHERE linked_client_id IS NOT NULL), 0),
            COALESCE(sum(volume) FILTER (WHERE entry = 0), 0),
            count(*) FILTER (WHERE entry <> 0)
       FROM d GROUP BY day`,
    [month, timezone],
  );

  await db.query(
    `WITH caps AS (
       SELECT d.day, x.client_id,
              sum(CASE WHEN x.type = 'deposit' THEN x.amount ELSE -x.amount END) AS capital
         FROM daily_pnl d
         JOIN transactions x
           ON (x.type = 'deposit' AND x.date < d.day) OR (x.type = 'withdrawal' AND x.date <= d.day)
        WHERE d.month = $1
        GROUP BY d.day, x.client_id
       HAVING sum(CASE WHEN x.type = 'deposit' THEN x.amount ELSE -x.amount END) > 0
     ), pool AS (
       SELECT day, sum(capital) AS pool_capital FROM caps GROUP BY day
     ), pooled AS (
       SELECT c.day, c.client_id, c.capital,
              round((d.net - d.linked_net)::numeric(40, 20) * c.capital / p.pool_capital, 16) AS gross
         FROM caps c JOIN pool p USING (day) JOIN daily_pnl d USING (day)
     ), linked AS (
       SELECT day, linked_client_id AS client_id, 0::numeric AS capital, sum(profit + swap + commission + fee) AS gross
         FROM (${MONTH_DEALS}) d
        WHERE linked_client_id IS NOT NULL
        GROUP BY day, linked_client_id
     )
     INSERT INTO daily_allocations (day, client_id, month, capital, gross)
     SELECT day, client_id, $1, max(capital), sum(gross)
       FROM (SELECT * FROM pooled UNION ALL SELECT * FROM linked) x
      GROUP BY day, client_id`,
    [month, timezone],
  );

  await db.query(
    `UPDATE daily_pnl d SET pool_capital = s.total
       FROM (SELECT day, sum(capital) AS total FROM daily_allocations WHERE month = $1 GROUP BY day) s
      WHERE d.day = s.day`,
    [month],
  );
}

/** Make sure every month with deals (in the business timezone) has a `months` row. */
export async function ensureMonths(db: Queryable, timezone: string, today: MonthKey): Promise<void> {
  await db.query(
    `INSERT INTO months (month)
     SELECT DISTINCT to_char(time AT TIME ZONE $1, 'YYYY-MM') FROM mt5_deals
     UNION SELECT $2
     ON CONFLICT DO NOTHING`,
    [timezone, today],
  );
}

export async function businessTimezone(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ business_timezone: string }>("SELECT business_timezone FROM settings WHERE id = 1");
  return rows[0]?.business_timezone ?? "Asia/Karachi";
}

/**
 * Recompute the given months, or every open month. Finalized months are never
 * touched unless `includeFinalized` is set (only the first backfill does that).
 */
export async function recomputeMonths(
  db: Queryable,
  options: { today: MonthKey; months?: MonthKey[]; includeFinalized?: boolean },
): Promise<MonthKey[]> {
  const timezone = await businessTimezone(db);
  await ensureMonths(db, timezone, options.today);
  const { rows } = await db.query<{ month: string }>(
    `SELECT month FROM months
      WHERE ($1::boolean OR status = 'open') AND ($2::text[] IS NULL OR month = ANY($2::text[]))
      ORDER BY month`,
    [options.includeFinalized ?? false, options.months ?? null],
  );
  for (const { month } of rows) await recomputeMonth(db, month, timezone);
  return rows.map((r) => r.month);
}
