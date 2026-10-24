import { authed, parseMonth } from "@/server/route";
import { loadLedger } from "@/server/store";

/** Clients without an IB (the company's own), summarised like an IB. */
export const GET = authed(async (request) =>
  (await loadLedger()).directSummary(parseMonth(request.nextUrl.searchParams.get("month"), true)),
);
