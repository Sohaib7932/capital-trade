import { updateIBSchema } from "@/lib/validation";
import { notFound } from "@/server/errors";
import { admin, authed, parseMonth, readJson } from "@/server/route";
import { loadLedger, updateIB } from "@/server/store";

export const GET = authed(async (request, _user, ctx: RouteContext<"/api/ibs/[id]">) => {
  const { id } = await ctx.params;
  const ib = (await loadLedger()).ib(id, parseMonth(request.nextUrl.searchParams.get("month"), true));
  if (!ib) throw notFound("IB not found");
  return ib;
});

/** Edit an IB, including its commission rule (applies to open months; finalized months keep theirs). */
export const PATCH = admin(async (request, user, ctx: RouteContext<"/api/ibs/[id]">) => {
  const { id } = await ctx.params;
  return updateIB(user, id, await readJson(request, updateIBSchema));
});
