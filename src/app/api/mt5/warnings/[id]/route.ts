import { resolveWarning } from "@/server/mt5";
import { admin } from "@/server/route";

/** Dismiss a warning once it has been dealt with. */
export const DELETE = admin(async (_request, user, ctx: RouteContext<"/api/mt5/warnings/[id]">) => {
  const id = Number((await ctx.params).id);
  await resolveWarning(user, Number.isInteger(id) ? id : -1);
  return null;
});
