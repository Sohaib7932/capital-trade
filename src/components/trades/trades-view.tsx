"use client";

import type { PaginationState, SortingState } from "@tanstack/react-table";
import { CalendarDays, Download, ListChecks, Loader2, Table2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/layout/app-context";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ALL, FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { ProfitText } from "@/components/shared/profit-text";
import { ChartSkeleton, KpiGridSkeleton, TableSkeleton } from "@/components/shared/skeletons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAsync } from "@/hooks/use-async";
import { exportTrades, getTradeDays, getTrades } from "@/lib/api";
import { formatCurrency, formatLots, sumMoney } from "@/lib/calculations";
import { formatDate, monthEnd, monthStart } from "@/lib/dates";
import type { ISODate, MonthKey, TradeFilters, TradeSortKey, TradeSummary, TradeType } from "@/lib/types";
import { tradeColumns } from "./trade-columns";
import { TradesCalendar } from "./trades-calendar";

interface Range {
  /** Month the range was picked in; a new top-bar month resets it. */
  month: MonthKey;
  from: ISODate;
  to: ISODate;
}

const FIRST_PAGE: PaginationState = { pageIndex: 0, pageSize: 25 };

export function TradesView() {
  const { month, dataVersion, timeZone } = useApp();
  const [custom, setCustom] = useState<Range | null>(null);
  const [type, setType] = useState(ALL);
  const [view, setView] = useState<"table" | "calendar">("table");
  const [pagination, setPagination] = useState<PaginationState>(FIRST_PAGE);
  const [sorting, setSorting] = useState<SortingState>([{ id: "closeTime", desc: true }]);
  const [exporting, setExporting] = useState(false);

  const range =
    month === null ? null : custom?.month === month ? custom : { month, from: monthStart(month), to: monthEnd(month) };
  const validRange = range !== null && range.from <= range.to;
  const filters: TradeFilters = {
    from: range?.from,
    to: range?.to,
    type: type === ALL ? undefined : (type as TradeType),
  };
  const sortId = sorting[0]?.id as TradeSortKey | undefined;
  const sortDesc = sorting[0]?.desc ?? true;

  const { data: page, loading } = useAsync(
    () =>
      getTrades({
        ...filters,
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
        sort: sortId,
        dir: sortDesc ? "desc" : "asc",
      }),
    [filters.from, filters.to, filters.type, pagination.pageIndex, pagination.pageSize, sortId, sortDesc, dataVersion],
    { enabled: validRange, keepPreviousData: true },
  );
  const { data: days } = useAsync(() => getTradeDays(filters), [filters.from, filters.to, filters.type, dataVersion], {
    enabled: validRange && view === "calendar",
  });

  function updateRange(patch: Partial<Pick<Range, "from" | "to">>) {
    if (range) setCustom({ ...range, ...patch });
    setPagination(FIRST_PAGE);
  }

  async function onExport() {
    setExporting(true);
    try {
      await exportTrades(filters);
      toast.success("Excel file downloaded");
    } catch (err) {
      toast.error("Couldn't export trades", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trades"
        description={`Closed XAUUSD positions from MT5. Net = profit + swap + commission. Dates and times in ${timeZone}.`}
        actions={
          <Button variant="outline" disabled={!page?.total || exporting} onClick={onExport}>
            {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} Export Excel
          </Button>
        }
      />

      {page ? <TradeSummaryCards summary={page.summary} /> : <KpiGridSkeleton count={5} className="xl:grid-cols-5" />}

      <Card className="gap-0 py-0">
        <FilterBar className="md:flex-wrap">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="trades-from" className="eyebrow">
                From
              </Label>
              <Input
                id="trades-from"
                type="date"
                className="num h-9 w-40"
                value={range?.from ?? ""}
                max={range?.to}
                onChange={(e) => e.target.value && updateRange({ from: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="trades-to" className="eyebrow">
                To
              </Label>
              <Input
                id="trades-to"
                type="date"
                className="num h-9 w-40"
                value={range?.to ?? ""}
                min={range?.from}
                onChange={(e) => e.target.value && updateRange({ to: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <span className="eyebrow" aria-hidden>
                Type
              </span>
              <FilterSelect
                label="Filter by trade type"
                value={type}
                onChange={(v) => {
                  setType(v);
                  setPagination(FIRST_PAGE);
                }}
                className="md:w-32"
                options={[
                  { value: ALL, label: "Buy & Sell" },
                  { value: "buy", label: "Buy only" },
                  { value: "sell", label: "Sell only" },
                ]}
              />
            </div>
          </div>
          <Tabs value={view} onValueChange={(v) => setView(v as "table" | "calendar")} className="md:ml-auto">
            <TabsList aria-label="View">
              <TabsTrigger value="table" className="px-3">
                <Table2 aria-hidden /> Table
              </TabsTrigger>
              <TabsTrigger value="calendar" className="px-3">
                <CalendarDays aria-hidden /> Calendar
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </FilterBar>

        {!validRange && range ? (
          <p className="px-5 py-10 text-center text-sm text-destructive">The start date must be on or before the end date.</p>
        ) : !range ? (
          <TableSkeleton rows={10} columns={10} />
        ) : view === "calendar" ? (
          days ? (
            <TradesCalendar days={days} from={range.from} to={range.to} />
          ) : (
            <ChartSkeleton className="m-5" />
          )
        ) : page ? (
          <DataTable
            columns={tradeColumns}
            data={page.rows}
            getRowId={(t) => String(t.ticket)}
            server={{
              rowCount: page.total,
              pagination,
              onPaginationChange: setPagination,
              sorting,
              onSortingChange: setSorting,
              loading,
            }}
            empty={
              <EmptyState
                icon={ListChecks}
                title="No trades in this range"
                description={`Nothing closed between ${formatDate(range.from)} and ${formatDate(range.to)}.`}
              />
            }
          />
        ) : (
          <TableSkeleton rows={10} columns={10} />
        )}
      </Card>
    </div>
  );
}

function TradeSummaryCards({ summary }: { summary: TradeSummary }) {
  const costs = sumMoney([summary.swap, summary.commission]);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <KpiCard
        label="Total trades"
        value={summary.count}
        footer={
          <>
            <span className="num">{summary.buys}</span> buy · <span className="num">{summary.count - summary.buys}</span> sell
          </>
        }
      />
      <KpiCard label="Total lots" value={formatLots(summary.lots)} unit="lots" footer="100 oz per lot" />
      <KpiCard label="Gross profit" value={<ProfitText value={summary.profit} className="font-bold" />} footer="From price movement" />
      <KpiCard
        label="Swap + commission"
        value={<ProfitText value={costs} className="font-bold" />}
        footer={
          <>
            Swap <span className="num">{formatCurrency(summary.swap)}</span> · Comm.{" "}
            <span className="num">{formatCurrency(summary.commission)}</span>
          </>
        }
      />
      <KpiCard
        label="Net profit"
        value={<ProfitText value={summary.net} className="font-bold" />}
        className="bg-linear-to-br from-card to-gold-soft/50"
        footer="Profit + swap + commission"
      />
    </div>
  );
}
