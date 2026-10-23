/**
 * Test the MT5 pipeline without a real MT5 account: POST the fake-deals fixture
 * to the ingest endpoint, exactly as the Python worker would.
 *
 *   npm run mt5:send-fake -- --register                 # create the fake account (login 7001234) first
 *   npm run mt5:send-fake                               # send current-month deals
 *   npm run mt5:send-fake -- --locked-month 2026-09     # also send deals for a (finalized) month
 *   npm run mt5:send-fake -- --url https://your-app.vercel.app
 *
 * Needs MT5_INGEST_KEY (and DATABASE_URL_UNPOOLED for --register).
 */
import { Client } from "pg";
import { monthOf, toISODate } from "../src/lib/dates";
import { withVerifiedSsl } from "../src/server/connection-string";
import { buildFakePayload, FAKE_BROKER_OFFSET_MINUTES } from "../tests/fixtures/mt5-deals";
import { loadEnv, requireEnv } from "./env";

loadEnv();

const LOGIN = 7001234;
const SERVER = "Fake-Broker-Live";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function register() {
  const client = new Client({ connectionString: withVerifiedSsl(requireEnv("DATABASE_URL_UNPOOLED")) });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO mt5_accounts (label, login, server, broker_timezone_offset_minutes) VALUES ('Fake test account', $1, $2, $3)
       ON CONFLICT (login) DO NOTHING`,
      [LOGIN, SERVER, FAKE_BROKER_OFFSET_MINUTES],
    );
    console.log(`Registered fake account ${LOGIN} @ ${SERVER} (broker clock UTC+3).`);
  } finally {
    await client.end();
  }
}

async function main() {
  if (process.argv.includes("--register")) await register();
  const url = (arg("url") ?? "http://localhost:3000").replace(/\/$/, "");
  const month = arg("month") ?? monthOf(toISODate(new Date()));
  const payload = buildFakePayload({ login: LOGIN, server: SERVER, month, lockedMonth: arg("locked-month") });

  const res = await fetch(`${url}/api/ingest/mt5`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ingest-Key": requireEnv("MT5_INGEST_KEY") },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
