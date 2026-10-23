import { mt5AccountSchema } from "@/lib/validation";
import { deleteAccount, updateAccount } from "@/server/mt5";
import { admin, readJson } from "@/server/route";

export const PATCH = admin(async (request, user, ctx: RouteContext<"/api/mt5/accounts/[id]">) => {
  const { id } = await ctx.params;
  return updateAccount(user, id, await readJson(request, mt5AccountSchema));
});

/** Only accounts that never synced a deal can be deleted; otherwise pause them. */
export const DELETE = admin(async (_request, user, ctx: RouteContext<"/api/mt5/accounts/[id]">) => {
  const { id } = await ctx.params;
  await deleteAccount(user, id);
  return null;
});
