/**
 * Rebuild daily_pnl / daily_allocations.
 *
 *   npm run db:recompute           # open months only (what the app does after changes)
 *   npm run db:recompute -- --all  # every month, including finalized (first-time backfill)
 */
import { Client } from "pg";
import { monthOf, toISODate } from "../src/lib/dates";
import { recomputeMonths } from "../src/server/allocations";
import { withVerifiedSsl } from "../src/server/connection-string";
import { loadEnv, requireEnv } from "./env";

loadEnv();

async function main() {
  const all = process.argv.includes("--all");
  const client = new Client({ connectionString: withVerifiedSsl(requireEnv("DATABASE_URL_UNPOOLED")) });
  await client.connect();
  try {
    await client.query("BEGIN");
    const months = await recomputeMonths(client, { today: monthOf(toISODate(new Date())), includeFinalized: all });
    await client.query("COMMIT");
    console.log(`Recomputed ${months.length} month(s): ${months.join(", ") || "none"}`);
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
