import { tradeFilterSchema } from "@/lib/validation";
import { authed, readQuery } from "@/server/route";
import { getTradeDays } from "@/server/store";

/** Net profit and lots per business day, for the Trades calendar. */
export const GET = authed(async (request) => getTradeDays(readQuery(request, tradeFilterSchema)));
