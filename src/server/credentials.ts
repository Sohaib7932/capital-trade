import { createHash, createPublicKey, constants, publicEncrypt, type KeyObject } from "node:crypto";
import { HttpError } from "./errors";

/**
 * Investor passwords are encrypted with the worker's RSA public key
 * (MT5_CREDENTIALS_PUBLIC_KEY) and stored only as ciphertext. The matching
 * private key lives only in mt5-worker/.env, so the app can encrypt but never
 * decrypt. RSA-OAEP with SHA-256 (MGF1 SHA-256), 3072-bit keys.
 *
 * Stored format: "v1.<key id>.<base64 ciphertext>", where the key id is the
 * first 16 hex chars of SHA-256 over the public key (SPKI DER). The worker
 * checks it to report "encrypted with a different key" instead of garbage.
 */

export const CIPHER_VERSION = "v1";
const MIN_KEY_BITS = 3072;
/** RSA-OAEP-SHA256 with a 3072-bit key fits 318 bytes; MT5 passwords are far shorter. */
const MAX_PASSWORD_BYTES = 256;

/** Accepts the key as PEM or as one-line base64 of the SPKI DER (easier in Vercel's env UI). */
export function parsePublicKey(value: string): KeyObject {
  const text = value.trim();
  const key = text.includes("-----BEGIN")
    ? createPublicKey(text.replace(/\\n/g, "\n"))
    : createPublicKey({ key: Buffer.from(text, "base64"), format: "der", type: "spki" });
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (key.asymmetricKeyType !== "rsa" || bits < MIN_KEY_BITS) {
    throw new Error(`MT5_CREDENTIALS_PUBLIC_KEY must be an RSA key of at least ${MIN_KEY_BITS} bits`);
  }
  return key;
}

export function keyId(key: KeyObject): string {
  const der = key.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

function configuredKey(): KeyObject {
  const value = process.env.MT5_CREDENTIALS_PUBLIC_KEY;
  if (!value) {
    throw new HttpError(503, "Saving investor passwords isn't configured: set MT5_CREDENTIALS_PUBLIC_KEY (run npm run mt5:keygen)");
  }
  try {
    return parsePublicKey(value);
  } catch {
    throw new HttpError(503, "MT5_CREDENTIALS_PUBLIC_KEY is not a valid RSA public key (run npm run mt5:keygen)");
  }
}

/** Encrypt an investor password for storage. Never log the input. */
export function encryptInvestorPassword(password: string, key: KeyObject = configuredKey()): string {
  const plain = Buffer.from(password, "utf8");
  if (plain.length === 0 || plain.length > MAX_PASSWORD_BYTES) throw new HttpError(400, "Enter the investor password");
  const cipher = publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, plain);
  plain.fill(0);
  return `${CIPHER_VERSION}.${keyId(key)}.${cipher.toString("base64")}`;
}
