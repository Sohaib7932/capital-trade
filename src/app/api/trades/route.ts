import { z } from "zod";
import { tradeFilterSchema } from "@/lib/validation";
import { authed, pageSchema, readQuery } from "@/server/route";
import { getTradesPage } from "@/server/store";

const querySchema = tradeFilterSchema.extend({
  ...pageSchema,
  sort: z
    .enum(["ticket", "openTime", "closeTime", "type", "lots", "openPrice", "closePrice", "profit", "swap", "commission", "net"])
    .optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

/** A page of trades plus totals for the whole filter. */
export const GET = authed(async (request) => getTradesPage(readQuery(request, querySchema)));
