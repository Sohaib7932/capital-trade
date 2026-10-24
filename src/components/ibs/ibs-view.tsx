"use client";

import { Building2, Network, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/layout/app-context";
import { columnHelper, DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { PersonCell } from "@/components/shared/person-cell";
import { ProfitText } from "@/components/shared/profit-text";
import { KpiGridSkeleton, TableSkeleton } from "@/components/shared/skeletons";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAsync } from "@/hooks/use-async";
import { getDirectSummary, getIBs } from "@/lib/api";
import { formatCurrency, formatLots, sum, sumMoney } from "@/lib/calculations";
import { formatMonth } from "@/lib/dates";
import type { IBSummary, MonthKey } from "@/lib/types";
import { describeCommission, IBFormSheet } from "./ib-form-sheet";

const helper = columnHelper<IBSummary>();

function buildColumns(month: MonthKey, commissions: boolean): DataTableColumn<IBSummary>[] {
  const m = formatMonth(month, { short: true });
  return [
    helper.accessor("name", {
      header: "IB name",
      cell: (info) => <PersonCell name={info.getValue()} code={info.row.original.code} />,
    }),
    helper.accessor("phone", {
      header: "Phone",
      enableSorting: false,
      cell: (info) => <span className="num text-xs text-muted-foreground">{info.getValue()}</span>,
    }),
    ...(commissions
      ? [
          helper.accessor((ib) => ib.commission.percent, {
            id: "commission",
            header: "Commission rule",
            cell: (info) => <span className="text-xs">{describeCommission(info.row.original)}</span>,
          }),
        ]
      : []),
    helper.accessor("clientCount", {
      header: "Clients",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold">{info.getValue()}</span>,
    }),
    helper.accessor("totalCapital", {
      header: "Capital",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold">{formatCurrency(info.getValue())}</span>,
    }),
    helper.accessor("monthLots", {
      header: `Lots · ${m}`,
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <span className="num">{formatLots(info.getValue())}</span>,
    }),
    helper.accessor("monthNetProfit", {
      header: `Clients' profit · ${m}`,
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <ProfitText value={info.getValue()} />,
    }),
    ...(commissions
      ? [
          helper.accessor("monthCommission", {
            header: `Commission · ${m}`,
            sortFn: "decimal",
            meta: { align: "right" },
            cell: (info) => <span className="num font-semibold text-gold-ink">{formatCurrency(info.getValue())}</span>,
          }),
        ]
      : []),
    helper.accessor("status", { header: "Status", enableSorting: false, cell: (info) => <StatusBadge status={info.getValue()} /> }),
  ];
}

export function IBsView() {
  const router = useRouter();
  const { month, dataVersion, notifyDataChanged, canEdit, settings } = useApp();
  const commissions = settings?.ibCommissionsEnabled ?? false;
  const [addOpen, setAddOpen] = useState(false);
  const { data: ibs } = useAsync(() => getIBs(month ?? undefined), [month, dataVersion], { enabled: month !== null });
  const { data: direct } = useAsync(() => getDirectSummary(month ?? undefined), [month, dataVersion], { enabled: month !== null });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Introducing Brokers"
        description="Agents who bring in clients. A client comes from one IB, or is a Direct client of the company."
        actions={
          canEdit ? (
            <Button onClick={() => setAddOpen(true)} className="font-semibold">
              <Plus aria-hidden /> Add IB
            </Button>
          ) : null
        }
      />

      {ibs && month ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Active IBs" value={ibs.filter((ib) => ib.status === "active").length} unit={`of ${ibs.length}`} />
          <KpiCard label="Clients via IBs" value={ibs.reduce((n, ib) => n + ib.clientCount, 0)} unit="active clients" />
          <KpiCard label="Capital via IBs" value={formatCurrency(sumMoney(ibs.map((ib) => ib.totalCapital)))} />
          {commissions ? (
            <KpiCard
              label={`IB commission · ${formatMonth(month, { short: true })}`}
              value={formatCurrency(sumMoney(ibs.map((ib) => ib.monthCommission)))}
              footer="Paid on finalized months"
            />
          ) : (
            <KpiCard
              label={`Lots via IBs · ${formatMonth(month, { short: true })}`}
              value={formatLots(sum(ibs.map((ib) => ib.monthLots)).toFixed(2))}
              footer="IB commissions are off (Settings)"
            />
          )}
        </div>
      ) : (
        <KpiGridSkeleton count={4} />
      )}

      {direct && month ? (
        <Card className="gap-0 py-0">
          <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg border bg-gold-soft text-gold-ink">
                <Building2 className="size-4" aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-bold">Direct clients</h2>
                <p className="text-xs text-muted-foreground">Clients of the company with no IB.</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
              <DirectFigure label="Clients" value={String(direct.clientCount)} />
              <DirectFigure label="Capital" value={formatCurrency(direct.totalCapital)} />
              <DirectFigure label={`Lots · ${formatMonth(month, { short: true })}`} value={formatLots(direct.monthLots)} />
              <div>
                <dt className="eyebrow">Profit · {formatMonth(month, { short: true })}</dt>
                <dd className="mt-0.5 font-semibold">
                  <ProfitText value={direct.monthNetProfit} />
                </dd>
              </div>
            </dl>
            <Button asChild variant="outline" size="sm">
              <Link href="/clients?source=direct">View clients</Link>
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="gap-0 py-0">
        {ibs && month ? (
          <DataTable
            columns={buildColumns(month, commissions)}
            data={ibs}
            getRowId={(ib) => ib.id}
            initialSorting={[{ id: "totalCapital", desc: true }]}
            onRowClick={(ib) => router.push(`/ibs/${ib.id}`)}
            rowLabel={(ib) => `Open ${ib.name}`}
            empty={
              <EmptyState
                icon={Network}
                title="No IBs yet"
                description="Add an introducing broker to attribute clients to them. Direct clients need no IB."
                action={
                  canEdit ? (
                    <Button onClick={() => setAddOpen(true)}>
                      <Plus aria-hidden /> Add IB
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        ) : (
          <TableSkeleton rows={4} columns={7} />
        )}
      </Card>

      {canEdit ? <IBFormSheet open={addOpen} onOpenChange={setAddOpen} onSaved={notifyDataChanged} /> : null}
    </div>
  );
}

function DirectFigure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}
