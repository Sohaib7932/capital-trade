import { z } from "zod";
import { listCashEvents } from "@/server/mt5";
import { authed, pageSchema, readQuery } from "@/server/route";

const schema = z.object({ ...pageSchema, unreviewed: z.enum(["true", "false"]).optional() });

/** Balance operations from MT5 (deposits, credit, bonus, …) — for review, never trading profit. */
export const GET = authed(async (request) => {
  const { unreviewed, ...query } = readQuery(request, schema);
  return listCashEvents({ ...query, unreviewed: unreviewed === "true" });
});
