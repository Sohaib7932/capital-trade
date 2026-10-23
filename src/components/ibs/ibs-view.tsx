"use client";

import { Network, Plus } from "lucide-react";
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
import { getIBs } from "@/lib/api";
import { formatCurrency, sumMoney } from "@/lib/calculations";
import { formatMonth } from "@/lib/dates";
import type { IBSummary, MonthKey } from "@/lib/types";
import { describeCommission, IBFormSheet } from "./ib-form-sheet";

const helper = columnHelper<IBSummary>();

function buildColumns(month: MonthKey): DataTableColumn<IBSummary>[] {
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
    helper.accessor((ib) => ib.commission.percent, {
      id: "commission",
      header: "Commission rule",
      cell: (info) => <span className="text-xs">{describeCommission(info.row.original)}</span>,
    }),
    helper.accessor("clientCount", {
      header: "Clients",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold">{info.getValue()}</span>,
    }),
    helper.accessor("totalCapital", {
      header: "Capital brought",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold">{formatCurrency(info.getValue())}</span>,
    }),
    helper.accessor("monthClientProfit", {
      header: `Clients' result · ${formatMonth(month, { short: true })}`,
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <ProfitText value={info.getValue()} />,
    }),
    helper.accessor("monthCommission", {
      header: `Commission · ${formatMonth(month, { short: true })}`,
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold text-gold-ink">{formatCurrency(info.getValue())}</span>,
    }),
    helper.accessor("status", { header: "Status", enableSorting: false, cell: (info) => <StatusBadge status={info.getValue()} /> }),
  ];
}

export function IBsView() {
  const router = useRouter();
  const { month, dataVersion, notifyDataChanged, canEdit } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const { data: ibs } = useAsync(() => getIBs(month ?? undefined), [month, dataVersion], { enabled: month !== null });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Introducing Brokers"
        description="Agents who bring in clients. Every client belongs to exactly one IB."
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
          <KpiCard label="Capital brought in" value={formatCurrency(sumMoney(ibs.map((ib) => ib.totalCapital)))} />
          <KpiCard
            label={`IB commission · ${formatMonth(month, { short: true })}`}
            value={formatCurrency(sumMoney(ibs.map((ib) => ib.monthCommission)))}
            footer="Paid on finalized months"
          />
        </div>
      ) : (
        <KpiGridSkeleton count={4} />
      )}

      <Card className="gap-0 py-0">
        {ibs && month ? (
          <DataTable
            columns={buildColumns(month)}
            data={ibs}
            getRowId={(ib) => ib.id}
            initialSorting={[{ id: "totalCapital", desc: true }]}
            onRowClick={(ib) => router.push(`/ibs/${ib.id}`)}
            rowLabel={(ib) => `Open ${ib.name}`}
            empty={
              <EmptyState
                icon={Network}
                title="No IBs yet"
                description="Add an introducing broker before adding their clients."
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
