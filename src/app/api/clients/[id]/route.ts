import { updateClientSchema } from "@/lib/validation";
import { notFound } from "@/server/errors";
import { admin, authed, parseMonth, readJson } from "@/server/route";
import { loadLedger, updateClient } from "@/server/store";

export const GET = authed(async (request, _user, ctx: RouteContext<"/api/clients/[id]">) => {
  const { id } = await ctx.params;
  const client = (await loadLedger()).client(id, parseMonth(request.nextUrl.searchParams.get("month"), true));
  if (!client) throw notFound("Client not found");
  return client;
});

export const PATCH = admin(async (request, user, ctx: RouteContext<"/api/clients/[id]">) => {
  const { id } = await ctx.params;
  return updateClient(user, id, await readJson(request, updateClientSchema));
});
