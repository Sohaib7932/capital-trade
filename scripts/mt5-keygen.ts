/**
 * Generate the key pair that protects MT5 investor passwords.
 *
 *   npm run mt5:keygen            # refuses if keys already exist
 *   npm run mt5:keygen -- --force # replace them (every saved investor password must then be re-entered)
 *
 * - PUBLIC key  → MT5_CREDENTIALS_PUBLIC_KEY in .env.local (and in Vercel). The app only encrypts.
 * - PRIVATE key → MT5_CREDENTIALS_PRIVATE_KEY in mt5-worker/.env. Only the worker decrypts.
 *
 * The private key is written straight to mt5-worker/.env and never printed.
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { keyId, parsePublicKey } from "../src/server/credentials";

const APP_ENV = path.join(process.cwd(), ".env.local");
const WORKER_ENV = path.join(process.cwd(), "mt5-worker", ".env");
const PUBLIC_NAME = "MT5_CREDENTIALS_PUBLIC_KEY";
const PRIVATE_NAME = "MT5_CREDENTIALS_PRIVATE_KEY";

function readEnv(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function hasVar(text: string, name: string): boolean {
  return new RegExp(`^${name}=.+`, "m").test(text);
}

/** Set NAME=value in an env file, replacing an existing line or appending. */
function setVar(file: string, text: string, name: string, value: string): void {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const next = pattern.test(text) ? text.replace(pattern, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  writeFileSync(file, next, { encoding: "utf8", mode: 0o600 });
}

function main() {
  const force = process.argv.includes("--force");
  const app = readEnv(APP_ENV);
  const worker = readEnv(WORKER_ENV);
  if (!force && (hasVar(app, PUBLIC_NAME) || hasVar(worker, PRIVATE_NAME))) {
    throw new Error(
      "Keys already exist. Replacing them makes every saved investor password unreadable (each must be re-entered).\n" +
        "Run `npm run mt5:keygen -- --force` if that's what you want.",
    );
  }
  if (!existsSync(path.dirname(WORKER_ENV))) throw new Error("mt5-worker/ not found — run this from the project folder");

  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const publicB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const privateB64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const id = keyId(parsePublicKey(publicB64));

  setVar(APP_ENV, app, PUBLIC_NAME, publicB64);
  setVar(WORKER_ENV, worker, PRIVATE_NAME, privateB64);

  console.log(`New key pair (key id ${id}).`);
  console.log(`  ${PUBLIC_NAME}  -> written to .env.local`);
  console.log(`  ${PRIVATE_NAME} -> written to mt5-worker/.env (not shown; keep it only on the worker machine)`);
  console.log("");
  console.log(`Add this to Vercel -> Project -> Settings -> Environment Variables (Production) as ${PUBLIC_NAME},`);
  console.log("then redeploy. It is a public key, so it is safe to copy:");
  console.log("");
  console.log(publicB64);
  if (force) console.log("\nKeys were replaced: re-enter every client's investor password in the app.");
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
