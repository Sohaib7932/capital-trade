import { z } from "zod";
import { admin, parseMonth, readJson } from "@/server/route";
import { markPaid } from "@/server/store";

const schema = z.object({
  partyType: z.enum(["client", "trader", "ib"]),
  partyId: z.string().min(1).max(40),
});

/** Mark a client, trader or IB payout for the month as paid. The amount comes from the frozen month. */
export const POST = admin(async (request, user, ctx: RouteContext<"/api/profit-split/[month]/payouts">) => {
  const { partyType, partyId } = await readJson(request, schema);
  return markPaid(user, parseMonth((await ctx.params).month), partyType, partyId);
});
