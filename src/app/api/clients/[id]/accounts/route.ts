import { clientAccountSchema } from "@/lib/validation";
import { addClientAccount } from "@/server/mt5";
import { admin, readJson } from "@/server/route";

/** Add an MT5 account to a client (or link an existing pooled one). The password is encrypted at once. */
export const POST = admin(async (request, user, ctx: RouteContext<"/api/clients/[id]/accounts">) => {
  const { id } = await ctx.params;
  return addClientAccount(user, id, await readJson(request, clientAccountSchema));
});
