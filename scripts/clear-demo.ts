/**
 * Prepare a database for real use.
 *
 *   npm run db:clear-demo                      # remove seeded demo trades only (also happens automatically on the first real sync)
 *   npm run db:clear-demo -- --everything --yes # remove ALL business data: clients, IBs, transactions, months, payouts, trades
 *
 * Users, settings and real MT5 accounts are always kept. To keep a demo to play
 * with, seed a separate Neon branch instead (see README → Demo data).
 */
import { Client } from "pg";
import { monthOf, toISODate } from "../src/lib/dates";
import { recomputeMonths } from "../src/server/allocations";
import { withVerifiedSsl } from "../src/server/connection-string";
import { loadEnv, requireEnv } from "./env";

loadEnv();

async function main() {
  const everything = process.argv.includes("--everything");
  if (everything && !process.argv.includes("--yes")) {
    throw new Error("This deletes every client, IB, transaction, month and payout. Re-run with --everything --yes to confirm.");
  }
  const client = new Client({ connectionString: withVerifiedSsl(requireEnv("DATABASE_URL_UNPOOLED")) });
  await client.connect();
  try {
    await client.query("BEGIN");
    if (everything) {
      await client.query("UPDATE mt5_accounts SET linked_client_id = NULL");
      await client.query(
        "TRUNCATE settlements, daily_allocations, daily_pnl, payouts, months, transactions, clients, ibs, mt5_deals, mt5_positions, account_cash_events, sync_warnings",
      );
      await client.query("DELETE FROM mt5_accounts WHERE is_demo");
      console.log("All business data removed. Users, settings and real MT5 accounts were kept.");
    } else {
      const { rowCount } = await client.query("DELETE FROM mt5_accounts WHERE is_demo");
      const months = await recomputeMonths(client, { today: monthOf(toISODate(new Date())) });
      console.log(rowCount ? `Demo trades removed; recalculated open months ${months.join(", ")}.` : "No demo trades found.");
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
