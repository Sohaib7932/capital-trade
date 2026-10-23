import { listPositions } from "@/server/mt5";
import { authed } from "@/server/route";

/** The account's open positions, as of its last sync. */
export const GET = authed(async (_request, _user, ctx: RouteContext<"/api/mt5/accounts/[id]/positions">) => {
  const { id } = await ctx.params;
  return listPositions(id);
});
