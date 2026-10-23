import { NextResponse, type NextRequest } from "next/server";
import { pool, transaction } from "@/server/db";
import { HttpError } from "@/server/errors";
import { ingestMt5, ingestSchema, recordSyncError } from "@/server/ingest";
import { assertIngestKey } from "@/server/ingest-auth";
import { errorResponse, readJson } from "@/server/route";

/**
 * Receive one account's MT5 snapshot from the sync worker.
 * Auth: `X-Ingest-Key` header. Idempotent — overlapping windows are safe to resend.
 * Returns { inserted, updated, ignored, cashEvents, positions, recomputedMonths, warnings }.
 */
export async function POST(request: NextRequest) {
  let login: number | null = null;
  try {
    assertIngestKey(request);
    const payload = await readJson(request, ingestSchema);
    login = payload.account_login;
    const result = await transaction((tx) => ingestMt5(tx, payload));
    return NextResponse.json(result);
  } catch (err) {
    // Show data problems on the account's status in Settings (auth/config failures aren't the account's fault).
    if (login !== null && !(err instanceof HttpError && [401, 404, 503].includes(err.status))) {
      const message = err instanceof Error ? err.message : String(err);
      await recordSyncError(pool(), login, `Ingest failed: ${message}`).catch(() => undefined);
    }
    return errorResponse(err);
  }
}
