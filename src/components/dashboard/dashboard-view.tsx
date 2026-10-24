"use client";

import { Activity, ArrowRight, Download, LineChart, ListChecks, Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/layout/app-context";
import { AccountStatus } from "@/components/shared/account-status";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadError } from "@/components/shared/load-error";
import { ProfitText } from "@/components/shared/profit-text";
import { ChartSkeleton, KpiGridSkeleton, TableSkeleton } from "@/components/shared/skeletons";
import { Pill } from "@/components/shared/status-badge";
import { recentTradeColumns } from "@/components/trades/trade-columns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAsync } from "@/hooks/use-async";
import { getDailyPerformance, getDashboardStats } from "@/lib/api";
import {
  formatCurrency,
  formatLots,
  formatPercent,
  netProfit,
  percentChange,
  signOf,
  sumMoney,
  toDecimal,
} from "@/lib/calculations";
import { downloadCsv } from "@/lib/csv";
import { formatDayShort, formatMonth, shiftMonth } from "@/lib/dates";
import type { DailyPerformance, DashboardStats, MonthKey } from "@/lib/types";
import { ProfitDistribution } from "./profit-distribution";
import { ProfitPerformanceChart } from "./profit-performance-chart";

export function DashboardView() {
  const { month, dataVersion } = useApp();
  const {
    data: stats,
    error,
    reload,
  } = useAsync(() => getDashboardStats(month ?? ""), [month, dataVersion], {
    enabled: month !== null,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {month ? `Overview for ${formatMonth(month)}` : "Overview"} · all client accounts · XAUUSD
        </p>
      </div>

      {stats ? (
        <KpiRow stats={stats} />
      ) : error ? (
        <LoadError error={error} onRetry={reload} />
      ) : (
        <KpiGridSkeleton count={5} className="xl:grid-cols-5" />
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="gap-0 py-0 xl:col-span-2">
          {month ? <PerformancePanel month={month} dataVersion={dataVersion} /> : <ChartSkeleton className="m-6" />}
        </Card>
        <Card className="gap-0 px-5 py-5">
          <div className="mb-4">
            <h2 className="text-base font-bold">Profit Distribution</h2>
            <p className="eyebrow mt-0.5">Split of this month&apos;s net profit</p>
          </div>
          {stats ? (
            <ProfitDistribution distribution={stats.distribution} />
          ) : error ? (
            <LoadError error={error} onRetry={reload} className="border-0" />
          ) : (
            <div className="space-y-4" aria-hidden>
              <Skeleton className="mx-auto size-48 rounded-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          )}
        </Card>
      </div>

      {stats ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TopClients stats={stats} />
          <SyncHealthCard stats={stats} />
        </div>
      ) : null}

      <RecentTrades stats={stats} />
    </div>
  );
}

function KpiRow({ stats }: { stats: DashboardStats }) {
  const change = percentChange(stats.netProfit, stats.previousNetProfit);
  const avgInvestment =
    stats.activeClients > 0 ? toDecimal(stats.totalInvestedCapital).dividedBy(stats.activeClients) : toDecimal(0);
  const flowSign = signOf(stats.capitalFlow);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <KpiCard
        label="Client capital"
        value={formatCurrency(stats.totalInvestedCapital)}
        valueClassName="text-[22px]"
        badge={
          flowSign !== 0 ? (
            <Pill tone={flowSign > 0 ? "gold" : "red"}>{formatCurrency(stats.capitalFlow, { signed: true, compact: true })}</Pill>
          ) : null
        }
        footer="Deposits − withdrawals · never split"
      />
      <KpiCard
        label="Total equity"
        value={formatCurrency(stats.totalEquity)}
        valueClassName="text-[22px]"
        footer={
          <>
            Balance <span className="num font-semibold text-foreground">{formatCurrency(stats.totalBalance)}</span> · floating{" "}
            <ProfitText value={stats.floatingPl} className="font-semibold" />
          </>
        }
      />
      <KpiCard
        label="This month net profit"
        value={<ProfitText value={stats.netProfit} className="font-bold" />}
        valueClassName="text-[22px]"
        badge={
          change !== null ? (
            <Pill tone={signOf(change) >= 0 ? "green" : "red"}>{formatPercent(change, { signed: true, places: 2 })}</Pill>
          ) : null
        }
        footer={
          <>
            Previous month: <span className="num font-semibold text-foreground">{formatCurrency(stats.previousNetProfit, { signed: true })}</span>
          </>
        }
      />
      <KpiCard
        label="Lots traded (MTD)"
        value={formatLots(stats.lots)}
        unit="lots"
        badge={<Pill tone="grey">100 oz / lot</Pill>}
        footer={
          <>
            <span className="num font-semibold text-foreground">{stats.tradeCount}</span> closed gold trades
          </>
        }
      />
      <KpiCard
        label="Active clients"
        value={stats.activeClients}
        unit="investors"
        badge={stats.newClients > 0 ? <Pill tone="gold">+{stats.newClients} new</Pill> : null}
        footer={
          <>
            {stats.activeIbs} active IB{stats.activeIbs === 1 ? "" : "s"} · avg. capital{" "}
            <span className="num font-semibold text-foreground">{formatCurrency(avgInvestment, { places: 0 })}</span>
          </>
        }
      />
    </div>
  );
}

function PerformancePanel({ month, dataVersion }: { month: MonthKey; dataVersion: number }) {
  const [view, setView] = useState<"current" | "previous">("current");
  const shownMonth = view === "current" ? month : shiftMonth(month, -1);
  const { data, error, reload } = useAsync(() => getDailyPerformance(shownMonth), [shownMonth, dataVersion]);

  return (
    <>
      <div className="flex flex-col gap-4 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold">Daily Profit Performance</h2>
            <Pill tone="grey">{formatMonth(shownMonth, { short: true })}</Pill>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {data ? <PerformanceSummary data={data} /> : <Skeleton className="h-4 w-64" />}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as "current" | "previous")}>
            <TabsList>
              <TabsTrigger value="current" className="px-2.5">
                {formatMonth(month, { short: true })}
              </TabsTrigger>
              <TabsTrigger value="previous" className="px-2.5">
                {formatMonth(shiftMonth(month, -1), { short: true })}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="sm"
            disabled={!data?.length}
            onClick={() => data && exportDaily(shownMonth, data)}
          >
            <Download aria-hidden /> CSV
          </Button>
        </div>
      </div>

      <div className="px-3 pt-4 pb-2 sm:px-5">
        <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 px-2 text-xs text-muted-foreground" aria-hidden>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-gold" /> Cumulative net profit
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-sky-300" /> Daily net profit
          </span>
        </div>
        {!data ? (
          error ? (
            <LoadError error={error} onRetry={reload} className="h-72 border-0" />
          ) : (
            <ChartSkeleton />
          )
        ) : data.length === 0 ? (
          <EmptyState icon={LineChart} title="No closed trades" description={`No trades closed in ${formatMonth(shownMonth)}.`} className="h-72" />
        ) : (
          <ProfitPerformanceChart data={data} />
        )}
      </div>

      {data && data.length > 0 ? <PerformanceStats data={data} /> : null}
    </>
  );
}

function PerformanceSummary({ data }: { data: DailyPerformance[] }) {
  const total = data.at(-1)?.cumulative ?? "0";
  return (
    <>
      Cumulative net profit of <ProfitText value={total} /> across{" "}
      <span className="num font-semibold text-foreground">{data.length}</span> trading days
    </>
  );
}

function PerformanceStats({ data }: { data: DailyPerformance[] }) {
  const sorted = [...data].sort((a, b) => toDecimal(a.netProfit).comparedTo(toDecimal(b.netProfit)));
  const worst = sorted[0];
  const best = sorted.at(-1)!;
  const average = toDecimal(sumMoney(data.map((d) => d.netProfit))).dividedBy(data.length);
  const winning = data.filter((d) => signOf(d.netProfit) > 0).length;

  const items = [
    { label: "Daily average", value: <ProfitText value={average} /> },
    { label: `Best day · ${formatDayShort(best.date)}`, value: <ProfitText value={best.netProfit} /> },
    { label: `Worst day · ${formatDayShort(worst.date)}`, value: <ProfitText value={worst.netProfit} /> },
    {
      label: "Winning days",
      value: (
        <span className="num font-semibold">
          {winning}/{data.length}
        </span>
      ),
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 border-t px-5 py-4 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border bg-background/50 px-3 py-2.5">
          <dt className="eyebrow text-[10px]">{item.label}</dt>
          <dd className="mt-1 text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function exportDaily(month: MonthKey, data: DailyPerformance[]) {
  downloadCsv(
    `daily-performance-${month}.csv`,
    ["Date", "Trades", "Lots", "Net profit (USD)", "Cumulative (USD)"],
    data.map((d) => [d.date, d.trades, d.lots, d.netProfit, d.cumulative]),
  );
}

function RecentTrades({ stats }: { stats: DashboardStats | undefined }) {
  const subtotal = stats ? sumMoney(stats.recentTrades.map(netProfit)) : "0";
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-profit-soft text-profit-ink">
            <ListChecks className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-bold">Recent Trades</h2>
            <p className="text-xs text-muted-foreground">Latest closed gold positions across all MT5 accounts</p>
          </div>
        </div>
        <Link
          href="/trades"
          className="inline-flex items-center gap-1 text-sm font-semibold text-gold-ink hover:underline"
        >
          View all trades <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {stats ? (
        <DataTable
          columns={recentTradeColumns}
          data={stats.recentTrades}
          getRowId={(t) => `${t.accountLogin}:${t.ticket}`}
          empty={<EmptyState icon={ListChecks} title="No trades yet" description="Closed trades will appear here once MT5 syncs." />}
        />
      ) : (
        <TableSkeleton rows={5} columns={7} />
      )}
      {stats && stats.recentTrades.length > 0 ? (
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          Subtotal ({stats.recentTrades.length} trades): <ProfitText value={subtotal} className="text-sm" />
        </div>
      ) : null}
    </Card>
  );
}

function TopClients({ stats }: { stats: DashboardStats }) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-lg border bg-gold-soft text-gold-ink">
          <Trophy className="size-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-bold">Top clients</h2>
          <p className="text-xs text-muted-foreground">By net trading profit this month</p>
        </div>
      </div>
      {stats.topClients.length === 0 ? (
        <EmptyState icon={Trophy} title="No client results yet" description="Clients appear here once their accounts trade." />
      ) : (
        <ul className="divide-y">
          {stats.topClients.map((c, i) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                <span className="num w-5 text-xs text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.ibName} · <span className="num">{formatLots(c.monthLots)}</span> lots
                    {c.equity ? (
                      <>
                        {" "}
                        · equity <span className="num">{formatCurrency(c.equity, { places: 0 })}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <ProfitText value={c.monthNetProfit} className="text-sm font-semibold" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SyncHealthCard({ stats }: { stats: DashboardStats }) {
  const issues = stats.syncIssues;
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <span
          className={`flex size-9 items-center justify-center rounded-lg border ${issues.length ? "bg-loss-soft text-loss" : "bg-profit-soft text-profit-ink"}`}
        >
          <Activity className="size-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-bold">Sync health</h2>
          <p className="text-xs text-muted-foreground">
            {issues.length ? `${issues.length} account${issues.length === 1 ? " needs" : "s need"} attention` : "Every active account is in sync"}
          </p>
        </div>
        <Link href="/settings?tab=mt5" className="ml-auto text-sm font-semibold text-gold-ink hover:underline">
          MT5 settings
        </Link>
      </div>
      {issues.length === 0 ? (
        <EmptyState icon={Activity} title="All green" description="Accounts synced within the last 5 minutes." />
      ) : (
        <ul className="divide-y">
          {issues.map((a) => (
            <li key={a.accountId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="num text-sm font-semibold">
                  {a.login} <span className="font-sans text-xs font-normal text-muted-foreground">{a.server}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.clientId ? (
                    <Link href={`/clients/${a.clientId}`} className="hover:underline">
                      {a.clientName}
                    </Link>
                  ) : (
                    "Pooled account"
                  )}
                </p>
              </div>
              <AccountStatus
                syncState={a.syncState}
                health={a.health}
                lastSyncAt={a.lastSyncAt}
                lastErrorKind={a.lastErrorKind}
                lastError={a.lastError}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
