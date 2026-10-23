import { admin, parseMonth } from "@/server/route";
import { finalizeMonth } from "@/server/store";

/** Lock the month: freeze every client's numbers and create payouts. */
export const POST = admin(async (_request, user, ctx: RouteContext<"/api/profit-split/[month]/finalize">) =>
  finalizeMonth(user, parseMonth((await ctx.params).month)),
);
