import { profitSplitWorkbook, xlsxResponse } from "@/server/exports";
import { authed, parseMonth } from "@/server/route";
import { loadLedger } from "@/server/store";

export const GET = authed(async (request) => {
  const month = parseMonth(request.nextUrl.searchParams.get("month"));
  const split = (await loadLedger()).monthlySplit(month);
  return xlsxResponse(await profitSplitWorkbook(split), `profit-split-${month}.xlsx`);
});
