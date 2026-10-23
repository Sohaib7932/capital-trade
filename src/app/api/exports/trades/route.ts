import { formatDate } from "@/lib/dates";
import { tradeFilterSchema } from "@/lib/validation";
import { tradesWorkbook, xlsxResponse } from "@/server/exports";
import { authed, readQuery } from "@/server/route";
import { getSettings, getTradesPage } from "@/server/store";

/** Every trade matching the filter (up to 50,000), oldest first, with totals. */
export const GET = authed(async (request, user) => {
  const filters = readQuery(request, tradeFilterSchema);
  const [page, settings] = await Promise.all([
    getTradesPage({ ...filters, pageSize: 50_000, sort: "closeTime", dir: "asc" }),
    getSettings(user),
  ]);
  const range = [filters.from && formatDate(filters.from), filters.to && formatDate(filters.to)].filter(Boolean).join(" – ");
  const title = `Trades${range ? ` · ${range}` : ""}${filters.type ? ` · ${filters.type} only` : ""}`;
  const name = `trades${filters.from ? `-${filters.from}` : ""}${filters.to ? `-to-${filters.to}` : ""}.xlsx`;
  return xlsxResponse(await tradesWorkbook(page.rows, page.summary, settings.businessTimezone, title), name);
});
