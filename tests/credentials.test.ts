import { execFileSync } from "node:child_process";
import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptInvestorPassword, keyId, parsePublicKey } from "@/server/credentials";
import { listSyncAccounts } from "@/server/ingest";
import { createTestDb, type TestDb } from "./helpers/db";

const PASSWORD = "Inv3stor-Pässwörd!";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
const publicB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const privateB64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const key = parsePublicKey(publicB64);

const WORKER_PYTHON = path.join(process.cwd(), "mt5-worker", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** Decrypt with the worker's own code (mt5-worker/credentials.py). Secrets go through env, not argv. */
function pythonDecrypt(token: string, privateKeyB64 = privateB64): string {
  const script = [
    "import os, sys",
    "sys.path.insert(0, os.path.join(os.getcwd(), 'mt5-worker'))",
    "from credentials import load_private_key, decrypt_password, CredentialError",
    "key = load_private_key(os.environ['TEST_PRIVATE_KEY'])",
    "try:",
    "    sys.stdout.buffer.write(decrypt_password(os.environ['TEST_TOKEN'], key).encode('utf-8'))",
    "except CredentialError as exc:",
    "    sys.stdout.write('ERR:' + str(exc))",
  ].join("\n");
  return execFileSync(WORKER_PYTHON, ["-c", script], {
    env: { ...process.env, TEST_PRIVATE_KEY: privateKeyB64, TEST_TOKEN: token },
    encoding: "utf8",
  });
}

describe("investor password encryption", () => {
  it("stores only versioned RSA-OAEP ciphertext tagged with the key id", () => {
    const token = encryptInvestorPassword(PASSWORD, key);
    const [version, id, b64] = token.split(".");
    expect(version).toBe("v1");
    expect(id).toBe(keyId(key));
    expect(token).not.toContain(PASSWORD);
    expect(Buffer.from(b64, "base64")).toHaveLength(384); // 3072-bit key
    expect(encryptInvestorPassword(PASSWORD, key)).not.toBe(token); // OAEP is randomised
  });

  it("round-trips with the private key (OAEP, SHA-256)", () => {
    const b64 = encryptInvestorPassword(PASSWORD, key).split(".")[2];
    const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(b64, "base64"));
    expect(plain.toString("utf8")).toBe(PASSWORD);
  });

  it.skipIf(!existsSync(WORKER_PYTHON))("round-trips through the worker's Python decryption", () => {
    expect(pythonDecrypt(encryptInvestorPassword(PASSWORD, key))).toBe(PASSWORD);
  });

  it.skipIf(!existsSync(WORKER_PYTHON))("the worker rejects a password encrypted for another key", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 3072 });
    const token = encryptInvestorPassword(PASSWORD, parsePublicKey(other.publicKey.export({ format: "pem", type: "spki" }).toString()));
    expect(pythonDecrypt(token)).toMatch(/^ERR:.*different key/);
  });

  it("rejects weak or non-RSA keys", () => {
    const small = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(() => parsePublicKey(small)).toThrow(/at least 3072/);
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(() => parsePublicKey(ec)).toThrow(/RSA/);
  });

  it("refuses to save without a configured public key", () => {
    const saved = process.env.MT5_CREDENTIALS_PUBLIC_KEY;
    delete process.env.MT5_CREDENTIALS_PUBLIC_KEY;
    try {
      expect(() => encryptInvestorPassword(PASSWORD)).toThrow(/MT5_CREDENTIALS_PUBLIC_KEY/);
    } finally {
      if (saved !== undefined) process.env.MT5_CREDENTIALS_PUBLIC_KEY = saved;
    }
  });
});

describe("worker account list", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(() => db.close());

  it("returns active real accounts with a password, as ciphertext only", async () => {
    const token = encryptInvestorPassword(PASSWORD, key);
    await db.pg.query(
      `INSERT INTO mt5_accounts (label, login, server, investor_password_enc, is_active, is_demo) VALUES
         ('With password', 2001, 'ECMarketsLtd-Live', $1, true, false),
         ('No password', 2002, 'ECMarketsLtd-Live', NULL, true, false),
         ('Paused', 2003, 'ECMarketsLtd-Live', $1, false, false),
         ('Seed data', 0, 'demo', $1, true, true)`,
      [token],
    );
    const list = await listSyncAccounts(db.db);
    expect(list).toEqual({
      sync_interval_seconds: 300,
      accounts: [{ login: 2001, server: "ECMarketsLtd-Live", label: "With password", encrypted_password: token }],
    });
    expect(JSON.stringify(list)).not.toContain(PASSWORD);
  });
});
