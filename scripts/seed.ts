/**
 * Load demo data and create the first admin login.
 *
 *   npm run db:seed            # refuses if data already exists
 *   npm run db:seed -- --reset # wipes business data first (admin logins are kept)
 *
 * Refuses to run on the Neon `production` branch unless --allow-production is passed.
 *
 * Admin credentials come from ADMIN_EMAIL / ADMIN_PASSWORD, or a strong
 * password is generated and printed once. An existing admin is never changed.
 */
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { hashPassword } from "../src/server/auth";
import { monthOf, toISODate } from "../src/lib/dates";
import { recomputeMonths } from "../src/server/allocations";
import { createSeedData } from "../src/server/seed-data";
import { freezeMonth } from "../src/server/store";
import { withVerifiedSsl } from "../src/server/connection-string";
import { loadEnv, requireEnv } from "./env";

loadEnv();

async function main() {
  const reset = process.argv.includes("--reset");
  // Demo data belongs on its own Neon branch once real MT5 data flows into production.
  if (process.env.NEON_BRANCH === "production" && !process.argv.includes("--allow-production")) {
    throw new Error(
      "Refusing to seed demo data on the production branch. Use a demo branch (`neon checkout demo --create`, then `npm run db:migrate && npm run db:seed`), or pass --allow-production.",
    );
  }
  const client = new Client({ connectionString: withVerifiedSsl(requireEnv("DATABASE_URL_UNPOOLED")) });
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM ibs LIMIT 1");
    if (existing.rowCount && !reset) {
      console.log("Data already present — nothing seeded. Use `npm run db:seed -- --reset` to start over.");
    } else {
      await seedData(client, reset);
    }
    await ensureAdmin(client);
  } finally {
    await client.end();
  }
}

async function bulkInsert(client: Client, table: string, columns: Record<string, string>, rows: object[]) {
  const names = Object.keys(columns);
  const defs = names.map((n) => `${n} ${columns[n]}`).join(", ");
  await client.query(
    `INSERT INTO ${table} (${names.join(", ")}) SELECT ${names.join(", ")} FROM jsonb_to_recordset($1::jsonb) AS t(${defs})`,
    [JSON.stringify(rows)],
  );
}

async function seedData(client: Client, reset: boolean) {
  const data = createSeedData(new Date());
  await client.query("BEGIN");
  try {
    if (reset) {
      // Demo trades only; real MT5 accounts and their synced deals are kept.
      await client.query("DELETE FROM mt5_accounts WHERE is_demo");
      await client.query("UPDATE mt5_accounts SET linked_client_id = NULL");
      await client.query(
        "TRUNCATE settlements, daily_allocations, daily_pnl, payouts, months, transactions, clients, ibs, settings",
      );
    }
    await bulkInsert(
      client,
      "ibs",
      {
        id: "text", code: "text", name: "text", phone: "text", email: "text", status: "text", joined_at: "date", notes: "text",
        commission_percent: "numeric", commission_source: "text",
      },
      data.ibs.map((ib) => ({
        ...ib, joined_at: ib.joinedAt, notes: ib.notes ?? null,
        commission_percent: ib.commission.percent, commission_source: ib.commission.source,
      })),
    );
    await bulkInsert(
      client,
      "clients",
      {
        id: "text", code: "text", full_name: "text", phone: "text", email: "text", ib_id: "text", joined_at: "date",
        status: "text", split_trader: "numeric", split_company: "numeric", split_client: "numeric",
      },
      data.clients.map((c) => ({
        id: c.id, code: c.code, full_name: c.fullName, phone: c.phone, email: c.email, ib_id: c.ibId,
        joined_at: c.joinedAt, status: c.status, split_trader: c.split.trader, split_company: c.split.company,
        split_client: c.split.client,
      })),
    );
    await bulkInsert(
      client,
      "transactions",
      { id: "text", client_id: "text", type: "text", amount: "numeric", date: "date", note: "text" },
      data.transactions.map((t) => ({ ...t, client_id: t.clientId })),
    );
    // Demo trades are stored as MT5 deals (an opening and a closing deal each) under a demo account,
    // exactly like synced data. Remove them with `npm run db:clear-demo`.
    await client.query(
      `INSERT INTO mt5_accounts (id, label, login, server, is_demo, last_sync_at, last_sync_status)
       VALUES ('mt5-demo', 'Demo data', 0, 'demo', true, now(), 'ok')`,
    );
    await bulkInsert(
      client,
      "mt5_deals",
      {
        account_login: "bigint", deal_ticket: "bigint", order_ticket: "bigint", position_id: "bigint", time: "timestamptz",
        type: "smallint", entry: "smallint", symbol: "text", volume: "numeric", price: "numeric", profit: "numeric",
        swap: "numeric", commission: "numeric",
      },
      data.trades.flatMap((t) => [
        {
          account_login: 0, deal_ticket: t.ticket * 2, order_ticket: t.ticket * 2, position_id: t.ticket, time: t.openTime,
          type: t.type === "buy" ? 0 : 1, entry: 0, symbol: t.symbol, volume: t.lots, price: t.openPrice, profit: 0, swap: 0,
          commission: 0,
        },
        {
          account_login: 0, deal_ticket: t.ticket * 2 + 1, order_ticket: t.ticket * 2 + 1, position_id: t.ticket, time: t.closeTime,
          type: t.type === "buy" ? 1 : 0, entry: 1, symbol: t.symbol, volume: t.lots, price: t.closePrice, profit: t.profit,
          swap: t.swap, commission: t.commission,
        },
      ]),
    );
    // Every month starts open; past months are frozen below, oldest first, exactly as Finalize Month does.
    await bulkInsert(
      client,
      "months",
      { month: "text" },
      Object.keys(data.months).map((month) => ({ month })),
    );
    await client.query(
      "INSERT INTO settings (id, split_trader, split_company, split_client) VALUES (1, $1, $2, $3)",
      [data.defaultSplit.trader, data.defaultSplit.company, data.defaultSplit.client],
    );
    const months = await recomputeMonths(client, { today: monthOf(toISODate(new Date())) });

    const finalized = Object.entries(data.months)
      .filter(([, m]) => m.status === "finalized")
      .map(([month, m]) => ({ month, finalizedAt: m.finalizedAt! }))
      .sort((a, b) => a.month.localeCompare(b.month));
    for (const { month, finalizedAt } of finalized) {
      await freezeMonth(client, month);
      await client.query("UPDATE months SET finalized_at = $2 WHERE month = $1", [month, finalizedAt]);
    }

    // Demo payout history: clients as generated; trader and IBs paid for all but the latest locked month.
    for (const [key, p] of Object.entries(data.payouts)) {
      if (p.status !== "paid") continue;
      const [month, partyType, partyId] = key.split(":");
      await client.query(
        "UPDATE payouts SET status = 'paid', paid_at = $4 WHERE month = $1 AND party_type = $2 AND party_id = $3",
        [month, partyType, partyId, p.paidAt],
      );
    }
    for (const { month, finalizedAt } of finalized.slice(0, -1)) {
      await client.query(
        "UPDATE payouts SET status = 'paid', paid_at = $2::date + 1 WHERE month = $1 AND party_type IN ('trader', 'ib')",
        [month, finalizedAt],
      );
    }
    await client.query("COMMIT");
    console.log(`Built daily allocations for ${months.length} months; locked ${finalized.length}.`);
    console.log(
      `Seeded ${data.ibs.length} IBs, ${data.clients.length} clients, ${data.transactions.length} transactions, ` +
        `${data.trades.length} trades, ${Object.keys(data.months).length} months.`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function ensureAdmin(client: Client) {
  const email = process.env.ADMIN_EMAIL ?? "admin@capitaltrade.com";
  const found = await client.query("SELECT 1 FROM admin_users WHERE lower(email) = lower($1)", [email]);
  if (found.rowCount) {
    console.log(`Admin ${email} already exists — password unchanged.`);
    return;
  }
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
  await client.query("INSERT INTO admin_users (name, email, role, password_hash) VALUES ($1, $2, $3, $4)", [
    process.env.ADMIN_NAME ?? "Admin",
    email,
    "admin",
    await hashPassword(password),
  ]);
  console.log("\nAdmin login created:");
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${process.env.ADMIN_PASSWORD ? "(from ADMIN_PASSWORD)" : password}`);
  console.log("  Change it after signing in: Settings → Profile.\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
