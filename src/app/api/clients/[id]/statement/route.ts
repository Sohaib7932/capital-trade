import { notFound } from "@/server/errors";
import { authed, parseMonth } from "@/server/route";
import { renderStatement } from "@/server/statement";
import { getSettings, loadLedger } from "@/server/store";

/** The client's monthly statement as a PDF. */
export const GET = authed(async (request, user, ctx: RouteContext<"/api/clients/[id]/statement">) => {
  const { id } = await ctx.params;
  const month = parseMonth(request.nextUrl.searchParams.get("month"));
  const [ledger, settings] = await Promise.all([loadLedger(), getSettings(user)]);
  const client = ledger.client(id, month);
  if (!client) throw notFound("Client not found");

  const pdf = await renderStatement({ client, month, timeZone: settings.businessTimezone, generatedAt: new Date() });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="statement-${client.code}-${month}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
