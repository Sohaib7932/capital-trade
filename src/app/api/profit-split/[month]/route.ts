import { authed, parseMonth } from "@/server/route";
import { loadLedger } from "@/server/store";

export const GET = authed(async (_request, _user, ctx: RouteContext<"/api/profit-split/[month]">) => {
  const month = parseMonth((await ctx.params).month);
  return (await loadLedger()).monthlySplit(month);
});
