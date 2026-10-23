import { authed, parseMonth } from "@/server/route";
import { getRecentTrades, loadLedger } from "@/server/store";

export const GET = authed(async (request) => {
  const month = parseMonth(request.nextUrl.searchParams.get("month"));
  const [ledger, recentTrades] = await Promise.all([loadLedger(), getRecentTrades(month)]);
  return ledger.dashboard(month, recentTrades);
});
