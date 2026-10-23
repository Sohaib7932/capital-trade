import { z } from "zod";
import { admin, parseMonth, readJson } from "@/server/route";
import { reopenMonth } from "@/server/store";

const schema = z.object({ reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500) });

/** Unlock a finalized month. The reason is written to the audit log. */
export const POST = admin(async (request, user, ctx: RouteContext<"/api/profit-split/[month]/reopen">) => {
  const { reason } = await readJson(request, schema);
  return reopenMonth(user, parseMonth((await ctx.params).month), reason);
});
