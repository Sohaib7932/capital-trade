import { z } from "zod";
import { listCashEvents } from "@/server/mt5";
import { authed, pageSchema, readQuery } from "@/server/route";

const schema = z.object({
  ...pageSchema,
  unreviewed: z.enum(["true", "false"]).optional(),
  clientId: z.string().max(40).optional(),
});

/** Balance operations from MT5 (deposits, withdrawals, fees, credit, bonus, …) — never trading profit. */
export const GET = authed(async (request) => {
  const { unreviewed, ...query } = readQuery(request, schema);
  return listCashEvents({ ...query, unreviewed: unreviewed === "true" });
});
