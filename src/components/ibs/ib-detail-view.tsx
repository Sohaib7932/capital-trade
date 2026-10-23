"use client";

import { CalendarDays, HandCoins, Mail, Network, Pencil, Phone, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/layout/app-context";
import { columnHelper, DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { PersonCell } from "@/components/shared/person-cell";
import { ProfitText } from "@/components/shared/profit-text";
import { PageSkeleton } from "@/components/shared/skeletons";
import { Pill, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAsync } from "@/hooks/use-async";
import { getIB } from "@/lib/api";
import { formatCurrency } from "@/lib/calculations";
import { formatDate, formatMonth } from "@/lib/dates";
import type { IBClientRow, IBDetail, MonthKey, Payout } from "@/lib/types";
import { initials } from "@/lib/utils";
import { describeCommission, IBFormSheet } from "./ib-form-sheet";

const helper = columnHelper<IBClientRow>();

function buildColumns(month: MonthKey): DataTableColumn<IBClientRow>[] {
  return [
    helper.accessor("fullName", {
      header: "Client",
      cell: (info) => <PersonCell name={info.getValue()} code={info.row.original.code} muted={info.row.original.status === "inactive"} />,
    }),
    helper.accessor("joinedAt", { header: "Joined", cell: (info) => <span className="num text-xs">{formatDate(info.getValue())}</span> }),
    helper.accessor("investedCapital", {
      header: "Capital",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold">{formatCurrency(info.getValue())}</span>,
    }),
    helper.accessor("monthProfit", {
      header: `${formatMonth(month, { short: true })} result`,
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <ProfitText value={info.getValue()} />,
    }),
    helper.accessor("totalProfit", {
      header: "Total result",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <ProfitText value={info.getValue()} />,
    }),
    helper.accessor("monthCommission", {
      header: `Commission · ${formatMonth(month, { short: true })}`,
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <span className="num text-gold-ink">{formatCurrency(info.getValue())}</span>,
    }),
    helper.accessor("totalCommission", {
      header: "Commission · all time",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold text-gold-ink">{formatCurrency(info.getValue())}</span>,
    }),
    helper.accessor("status", { header: "Status", enableSorting: false, cell: (info) => <StatusBadge status={info.getValue()} /> }),
  ];
}

const payoutHelper = columnHelper<Payout>();
const payoutColumns: DataTableColumn<Payout>[] = [
  payoutHelper.accessor("month", { header: "Month", cell: (info) => <span className="font-semibold">{formatMonth(info.getValue())}</span> }),
  payoutHelper.accessor("amount", {
    header: "Commission",
    sortFn: "decimal",
    meta: { align: "right" },
    cell: (info) => <span className="num font-semibold">{formatCurrency(info.getValue())}</span>,
  }),
  payoutHelper.accessor("status", {
    header: "Status",
    cell: (info) => <StatusBadge status={info.getValue()} detail={info.row.original.paidAt ? formatDate(info.row.original.paidAt) : undefined} />,
  }),
];

export function IBDetailView() {
  const { id } = useParams<{ id: string }>();
  const { month, dataVersion } = useApp();
  const { data: ib } = useAsync(() => getIB(id, month ?? undefined), [id, month, dataVersion], { enabled: month !== null });

  if (ib === undefined || month === null) return <PageSkeleton kpis={4} />;
  if (ib === null) {
    return (
      <Card>
        <EmptyState
          icon={Network}
          title="IB not found"
          description="This introducing broker doesn't exist or may have been removed."
          action={
            <Button asChild variant="outline">
              <Link href="/ibs">Back to IBs</Link>
            </Button>
          }
        />
      </Card>
    );
  }
  return <IBDetailContent ib={ib} month={month} />;
}

function IBDetailContent({ ib, month }: { ib: IBDetail; month: MonthKey }) {
  const router = useRouter();
  const { canEdit, notifyDataChanged } = useApp();
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader back={{ href: "/ibs", label: "IBs" }} title="IB details" />

      <Card className="gap-0 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-[#1c1a17] text-xl font-bold text-gold" aria-hidden>
              {initials(ib.name)}
            </span>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{ib.name}</h2>
                <Pill tone="gold" className="num">
                  {ib.code}
                </Pill>
                <StatusBadge status={ib.status} />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5" aria-label="Phone" />
                  <span className="num">{ib.phone}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3.5" aria-label="Email" />
                  <a href={`mailto:${ib.email}`} className="hover:text-foreground hover:underline">
                    {ib.email}
                  </a>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" aria-label="Joined" />
                  Since <span className="num">{formatDate(ib.joinedAt)}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <HandCoins className="size-3.5" aria-label="Commission rule" />
                  {describeCommission(ib)}
                </span>
              </div>
              {ib.notes ? <p className="text-sm text-muted-foreground">{ib.notes}</p> : null}
            </div>
          </div>
          {canEdit ? (
            <Button variant="outline" onClick={() => setEditing(true)} className="self-start">
              <Pencil aria-hidden /> Edit IB
            </Button>
          ) : null}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active clients" value={ib.clientCount} unit={`of ${ib.clients.length}`} footer={`Capital ${formatCurrency(ib.totalCapital)}`} />
        <KpiCard
          label={`Clients' result · ${formatMonth(month, { short: true })}`}
          value={<ProfitText value={ib.monthClientProfit} className="font-bold" />}
          footer={<>All time <ProfitText value={ib.totalClientProfit} /></>}
        />
        <KpiCard
          label={`Commission · ${formatMonth(month, { short: true })}`}
          value={<span className="text-gold-ink">{formatCurrency(ib.monthCommission)}</span>}
          footer={describeCommission(ib)}
        />
        <KpiCard label="Commission · all time" value={formatCurrency(ib.totalCommission)} footer="Across every month" />
      </div>

      <Card className="gap-0 py-0">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-bold">Clients introduced</h2>
          <p className="text-xs text-muted-foreground">Everyone {ib.name} has brought into the pool.</p>
        </div>
        <DataTable
          columns={buildColumns(month)}
          data={ib.clients}
          getRowId={(c) => c.id}
          onRowClick={(c) => router.push(`/clients/${c.id}`)}
          rowLabel={(c) => `Open ${c.fullName}`}
          empty={<EmptyState icon={Users} title="No clients yet" description="Clients added under this IB will appear here." />}
        />
      </Card>

      <Card className="gap-0 py-0">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-bold">Commission payouts</h2>
          <p className="text-xs text-muted-foreground">Created when a month is finalized. Mark them paid on the Profit Split page.</p>
        </div>
        <DataTable
          columns={payoutColumns}
          data={ib.payouts}
          getRowId={(p) => p.month}
          empty={<EmptyState icon={HandCoins} title="No payouts yet" description="Commission payouts appear once a month with commission is finalized." />}
        />
      </Card>

      {canEdit ? <IBFormSheet open={editing} onOpenChange={setEditing} ib={ib} onSaved={notifyDataChanged} /> : null}
    </div>
  );
}
