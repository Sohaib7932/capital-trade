import { attachDatabasePool } from "@vercel/functions";
import { Pool, types, type PoolClient } from "pg";
import { withVerifiedSsl } from "./connection-string";

/**
 * Postgres access for route handlers.
 *
 * Uses node-postgres with Neon's pooled connection string (DATABASE_URL), the
 * recommended setup for a long-running Node server. The pool is created once
 * per process and reused across requests (and across dev hot reloads).
 */

// Keep NUMERIC as strings (exact money), DATE as "YYYY-MM-DD", and timestamps
// as UTC ISO strings, so rows map straight onto the app's types.
types.setTypeParser(types.builtins.NUMERIC, (v) => v);
types.setTypeParser(types.builtins.DATE, (v) => v);
types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString().slice(0, 19) + "Z");
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

const globalForPool = globalThis as unknown as { pgPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Run `neon deploy` (or `neon env pull`) to write .env.local.");
  }
  const created = new Pool({ connectionString: withVerifiedSsl(connectionString), max: 10, idleTimeoutMillis: 30_000 });
  // On Vercel (Fluid compute), close idle connections before an instance is suspended.
  if (process.env.VERCEL) attachDatabasePool(created);
  return created;
}

export function pool(): Pool {
  globalForPool.pgPool ??= createPool();
  return globalForPool.pgPool;
}

/** Run `fn` inside a transaction; rolls back if it throws. */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
