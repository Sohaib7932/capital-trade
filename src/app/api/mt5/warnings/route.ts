import { listWarnings } from "@/server/mt5";
import { authed } from "@/server/route";

/** Unresolved sync warnings (deals for finalized months, clock mismatches, …). */
export const GET = authed(async () => listWarnings());
