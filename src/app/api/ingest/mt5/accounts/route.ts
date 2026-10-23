import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/server/db";
import { listSyncAccounts } from "@/server/ingest";
import { assertIngestKey } from "@/server/ingest-auth";
import { errorResponse } from "@/server/route";

/**
 * The worker's account list (X-Ingest-Key). Investor passwords are returned
 * only as ciphertext; the app has no way to decrypt them.
 */
export async function GET(request: NextRequest) {
  try {
    assertIngestKey(request);
    return NextResponse.json(await listSyncAccounts(pool()), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
