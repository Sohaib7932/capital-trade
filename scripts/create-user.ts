/**
 * Create a login, or reset an existing user's password.
 *
 *   npm run user:create -- --email owner@example.com --name "Owner" [--role admin|viewer]
 *
 * The password comes from USER_PASSWORD, or a strong one is generated and printed once.
 * If the email already exists, its password (and role, if given) is reset.
 */
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { hashPassword } from "../src/server/auth";
import { withVerifiedSsl } from "../src/server/connection-string";
import { loadEnv, requireEnv } from "./env";

loadEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const name = arg("name") ?? email?.split("@")[0];
  const role = arg("role") ?? "admin";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Pass --email you@example.com");
  if (role !== "admin" && role !== "viewer") throw new Error("--role must be admin or viewer");
  const password = process.env.USER_PASSWORD ?? randomBytes(12).toString("base64url");
  if (password.length < 8) throw new Error("USER_PASSWORD must be at least 8 characters");

  const client = new Client({ connectionString: withVerifiedSsl(requireEnv("DATABASE_URL_UNPOOLED")) });
  await client.connect();
  try {
    const hash = await hashPassword(password);
    const { rows } = await client.query<{ created: boolean }>(
      `INSERT INTO admin_users (name, email, role, password_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
       RETURNING (xmax = 0) AS created`,
      [name, email, role, hash],
    );
    // A reset password signs the user out everywhere.
    await client.query("DELETE FROM sessions WHERE user_id = (SELECT id FROM admin_users WHERE lower(email) = lower($1))", [email]);
    console.log(`${rows[0].created ? "Created" : "Updated"} ${role} ${email}`);
    console.log(`Password: ${process.env.USER_PASSWORD ? "(from USER_PASSWORD)" : password}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
