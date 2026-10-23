import { z } from "zod";
import { investorPasswordSchema } from "@/lib/validation";
import { replaceAccountPassword } from "@/server/mt5";
import { admin, readJson } from "@/server/route";

const schema = z.object({ investorPassword: investorPasswordSchema });

/** Replace the investor password. It is encrypted immediately and never returned. */
export const PUT = admin(async (request, user, ctx: RouteContext<"/api/mt5/accounts/[id]/password">) => {
  const { id } = await ctx.params;
  const { investorPassword } = await readJson(request, schema);
  return replaceAccountPassword(user, id, investorPassword);
});
