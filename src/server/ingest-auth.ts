import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { HttpError, unauthorized } from "./errors";

/**
 * The MT5 worker authenticates with `X-Ingest-Key`, compared in constant time
 * to MT5_INGEST_KEY. It never uses an admin session.
 */
export function assertIngestKey(request: NextRequest): void {
  const expected = process.env.MT5_INGEST_KEY;
  if (!expected || expected.length < 32) {
    throw new HttpError(503, "MT5 ingest is not configured: set MT5_INGEST_KEY (32+ characters) on the server");
  }
  const given = request.headers.get("x-ingest-key") ?? "";
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) throw unauthorized("Invalid ingest key");
}
