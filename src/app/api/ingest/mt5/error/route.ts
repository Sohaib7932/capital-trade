import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { pool } from "@/server/db";
import { notFound } from "@/server/errors";
import { recordSyncError } from "@/server/ingest";
import { assertIngestKey } from "@/server/ingest-auth";
import { errorResponse, readJson } from "@/server/route";

const schema = z.object({
  account_login: z.number().int().positive(),
  error: z.string().trim().min(1).max(1000),
});

/** The worker reports a failed cycle (e.g. MT5 login failed) so Settings can show it. */
export async function POST(request: NextRequest) {
  try {
    assertIngestKey(request);
    const { account_login, error } = await readJson(request, schema);
    if (!(await recordSyncError(pool(), account_login, error))) throw notFound(`MT5 account ${account_login} isn't registered`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
