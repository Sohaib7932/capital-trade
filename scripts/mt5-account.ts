/**
 * Register (or update) an MT5 account, exactly like Settings → MT5 Connection does,
 * including the audit log entry.
 *
 *   npm run mt5:account -- --login 800223736 --server ECMarketsLtd-Demo --label "EC Markets Demo" --offset 180
 *
 * Options: --login (required), --server (required), --label, --offset (broker clock, minutes
 * from UTC; default 180 = UTC+3), --paused, --client <clientId> (default: pool),
 * --as <admin email> (default: the first admin).
 */
import { parseArgs } from "node:util";
import { loadEnv } from "./env";

loadEnv();

const { values } = parseArgs({
  options: {
    login: { type: "string" },
    server: { type: "string" },
    label: { type: "string" },
    offset: { type: "string", default: "180" },
    paused: { type: "boolean", default: false },
    client: { type: "string" },
    as: { type: "string" },
  },
});

async function main() {
  const { pool } = await import("../src/server/db");
  const { createAccount, updateAccount } = await import("../src/server/mt5");
  const { mt5AccountSchema } = await import("../src/lib/validation");
  const db = pool();
  try {
    if (!values.login || !values.server) throw new Error("--login and --server are required");
    const input = mt5AccountSchema.parse({
      label: values.label ?? `MT5 ${values.login}`,
      login: Number(values.login),
      server: values.server,
      brokerTimezoneOffsetMinutes: Number(values.offset),
      isActive: !values.paused,
      linkedClientId: values.client ?? null,
    });

    const { rows: admins } = await db.query<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM admin_users WHERE role = 'admin' AND ($1::text IS NULL OR lower(email) = lower($1))
        ORDER BY created_at LIMIT 1`,
      [values.as ?? null],
    );
    if (!admins[0]) throw new Error("No admin user found (create one with npm run user:create)");
    const user = { ...admins[0], role: "admin" as const };

    const { rows: existing } = await db.query<{ id: string }>("SELECT id FROM mt5_accounts WHERE login = $1", [input.login]);
    const account = existing[0] ? await updateAccount(user, existing[0].id, input) : await createAccount(user, input);
    console.log(`${existing[0] ? "Updated" : "Registered"} MT5 account (as ${user.email}):`);
    console.log(
      JSON.stringify(
        {
          id: account.id,
          label: account.label,
          login: account.login,
          server: account.server,
          brokerTimezoneOffsetMinutes: account.brokerTimezoneOffsetMinutes,
          isActive: account.isActive,
          linkedClientId: account.linkedClientId,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
