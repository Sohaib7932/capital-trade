import { transactionSchema } from "@/lib/validation";
import { admin, readJson } from "@/server/route";
import { deleteTransaction, updateTransaction } from "@/server/store";

/** Edit a transaction (open months only). Returns the updated client. */
export const PATCH = admin(async (request, user, ctx: RouteContext<"/api/transactions/[id]">) => {
  const { id } = await ctx.params;
  return updateTransaction(user, id, await readJson(request, transactionSchema));
});

/** Delete a transaction (open months only). Returns the updated client. */
export const DELETE = admin(async (_request, user, ctx: RouteContext<"/api/transactions/[id]">) => {
  const { id } = await ctx.params;
  return deleteTransaction(user, id);
});
