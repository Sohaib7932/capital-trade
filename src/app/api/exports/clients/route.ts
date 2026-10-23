import { z } from "zod";
import { clientsWorkbook, xlsxResponse } from "@/server/exports";
import { authed, monthSchema, readQuery } from "@/server/route";
import { loadLedger } from "@/server/store";

const schema = z.object({
  month: monthSchema.optional(),
  ibId: z.string().max(40).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(["fullName", "ibName", "investedCapital", "joinedAt", "monthProfit", "totalProfit"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

/** Every client matching the filters, in the table's sort order. */
export const GET = authed(async (request) => {
  const query = readQuery(request, schema);
  const ledger = await loadLedger();
  const month = query.month ?? ledger.currentMonth;
  const { rows } = ledger.clients({ ...query, month, page: 0, pageSize: 100_000 });
  return xlsxResponse(await clientsWorkbook(rows, month), `clients-${month}.xlsx`);
});
