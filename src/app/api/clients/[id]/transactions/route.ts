import { transactionSchema } from "@/lib/validation";
import { admin, readJson } from "@/server/route";
import { addTransaction } from "@/server/store";

/** Record a deposit or withdrawal. Returns the updated client. */
export const POST = admin(async (request, user, ctx: RouteContext<"/api/clients/[id]/transactions">) => {
  const { id } = await ctx.params;
  return addTransaction(user, id, await readJson(request, transactionSchema));
});
