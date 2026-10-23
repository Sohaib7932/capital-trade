"use client";

import { columnHelper, type DataTableColumn } from "@/components/shared/data-table";
import { DateTime } from "@/components/shared/date-time";
import { ProfitText } from "@/components/shared/profit-text";
import { TradeTypeBadge } from "@/components/shared/status-badge";
import { formatCurrency, formatLots, formatPrice, netProfit } from "@/lib/calculations";
import type { Trade } from "@/lib/types";

const helper = columnHelper<Trade>();

function SymbolCell({ symbol }: { symbol: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold">
      <span className="size-2 rounded-full bg-gold" aria-hidden />
      {symbol}
    </span>
  );
}

const ticket = helper.accessor("ticket", {
  header: "Ticket",
  cell: (info) => <span className="num font-semibold">#{info.getValue()}</span>,
});
const symbol = helper.accessor("symbol", { header: "Symbol", enableSorting: false, cell: (info) => <SymbolCell symbol={info.getValue()} /> });
const type = helper.accessor("type", { header: "Type", cell: (info) => <TradeTypeBadge type={info.getValue()} /> });
const lots = helper.accessor("lots", {
  header: "Lots",
  sortFn: "decimal",
  meta: { align: "right" },
  cell: (info) => <span className="num">{formatLots(info.getValue())}</span>,
});
const openPrice = helper.accessor("openPrice", {
  header: "Open price",
  sortFn: "decimal",
  meta: { align: "right" },
  cell: (info) => <span className="num text-muted-foreground">{formatPrice(info.getValue())}</span>,
});
const closePrice = helper.accessor("closePrice", {
  header: "Close price",
  sortFn: "decimal",
  meta: { align: "right" },
  cell: (info) => <span className="num font-medium">{formatPrice(info.getValue())}</span>,
});
const net = helper.accessor((t) => netProfit(t), {
  id: "net",
  header: "Net profit",
  sortFn: "decimal",
  meta: { align: "right" },
  cell: (info) => <ProfitText value={info.getValue()} />,
});

function money(key: "profit" | "swap" | "commission", header: string) {
  return helper.accessor(key, {
    header,
    sortFn: "decimal",
    meta: { align: "right" },
    cell: (info) => <span className="num text-muted-foreground">{formatCurrency(info.getValue())}</span>,
  });
}

/** Compact columns for the dashboard: ticket with close time underneath. */
export const recentTradeColumns: DataTableColumn<Trade>[] = [
  helper.accessor("ticket", {
    header: "Ticket / Closed",
    enableSorting: false,
    cell: (info) => (
      <div className="leading-tight">
        <p className="num font-semibold">#{info.getValue()}</p>
        <DateTime value={info.row.original.closeTime} className="mt-0.5 block text-xs text-muted-foreground" />
      </div>
    ),
  }),
  { ...symbol, enableSorting: false },
  { ...type, enableSorting: false },
  { ...lots, enableSorting: false },
  { ...openPrice, enableSorting: false },
  { ...closePrice, enableSorting: false },
  { ...net, enableSorting: false },
];

export const tradeColumns: DataTableColumn<Trade>[] = [
  ticket,
  helper.accessor("openTime", {
    header: "Open time",
    cell: (info) => <DateTime value={info.getValue()} className="text-xs text-muted-foreground" />,
  }),
  helper.accessor("closeTime", {
    header: "Close time",
    cell: (info) => <DateTime value={info.getValue()} className="text-xs" />,
  }),
  symbol,
  type,
  lots,
  openPrice,
  closePrice,
  money("profit", "Profit"),
  money("swap", "Swap"),
  money("commission", "Commission"),
  net,
];
