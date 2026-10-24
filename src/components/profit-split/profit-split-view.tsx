"use client";

import { ArrowRight, CheckCircle2, Download, Loader2, Lock, LockOpen, PieChart } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/layout/app-context";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { columnHelper, DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, SearchInput } from "@/components/shared/filter-bar";
import { FormField } from "@/components/shared/form-field";
import { PageHeader } from "@/components/shared/page-header";
import { PersonCell } from "@/components/shared/person-cell";
import { ProfitText } from "@/components/shared/profit-text";
import { PageSkeleton } from "@/components/shared/skeletons";
import { Pill, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAsync } from "@/hooks/use-async";
import { exportProfitSplit, finalizeMonth, getMonthlySplit, markPaid, reopenMonth } from "@/lib/api";
import { formatCurrency, formatPercent, percentOf, signOf, sumMoney } from "@/lib/calculations";
import { formatDate, formatMonth } from "@/lib/dates";
import type { ClientSplitRow, MonthKey, MonthlySplit, PartyType, Payout } from "@/lib/types";
import { cn } from "@/lib/utils";

const helper = columnHelper<ClientSplitRow>();
const partyHelper = columnHelper<Payout>();

interface PayTarget {
  partyType: PartyType;
  partyId: string;
  name: string;
  amount: string;
}

/** Wrap a disabled control so its tooltip still shows (disabled buttons get no pointer events). */
function WithReason({ reason, children }: { reason: string | null; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-lg">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function payReason(split: MonthlySplit, status: string, amount: string): string | null {
  if (split.status !== "finalized") return "Finalize the month first";
  if (status === "paid") return null;
  if (signOf(amount) <= 0) return "Nothing to pay this month";
  return null;
}

/** Shown only while IB commissions are on. */
const ibColumn = helper.accessor("ib", {
  header: "IB comm.",
  sortFn: "decimal",
  meta: { align: "right" },
  cell: (info) => (
    <SplitAmount
      value={info.getValue()}
      pct={
        info.row.original.ibCommission.percent
          ? `${formatPercent(info.row.original.ibCommission.percent)}${info.row.original.ibCommission.source === "additional" ? " add." : ""}`
          : "—"
      }
    />
  ),
});

export function ProfitSplitView() {
  const { month, dataVersion, notifyDataChanged, canEdit, settings } = useApp();
  const ibOn = settings?.ibCommissionsEnabled ?? false;
  const { data: split, loading } = useAsync(() => getMonthlySplit(month!), [month, dataVersion], {
    enabled: month !== null,
    keepPreviousData: true,
  });
  const [search, setSearch] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [paying, setPaying] = useState<PayTarget | null>(null);
  const [exporting, setExporting] = useState(false);

  if (!split || !month || (loading && split.month !== month)) return <PageSkeleton kpis={0} />;

  const finalized = split.status === "finalized";
  const pending = [...split.rows.map((r) => ({ status: r.payoutStatus, amount: r.payoutAmount })), ...split.partyPayouts].filter(
    (p) => p.status === "pending" && signOf(p.amount) > 0,
  ).length;

  const payButton = (target: PayTarget, status: string) => {
    if (status === "paid") {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-profit-ink">
          <CheckCircle2 className="size-3.5" aria-hidden /> Paid
        </span>
      );
    }
    if (!canEdit) return <span className="text-xs text-muted-foreground">—</span>;
    const reason = payReason(split, status, target.amount);
    return (
      <WithReason reason={reason}>
        <Button size="sm" disabled={reason !== null} onClick={() => setPaying(target)}>
          Mark as Paid
        </Button>
      </WithReason>
    );
  };

  const columns: DataTableColumn<ClientSplitRow>[] = [
    helper.accessor("clientName", {
      header: "Client",
      cell: (info) => (
        <div>
          <PersonCell name={info.getValue()} code={info.row.original.clientCode} />
          {signOf(info.row.original.carryIn) < 0 ? (
            <p className="num mt-1 text-[11px] text-loss">recovering {formatCurrency(info.row.original.carryIn)}</p>
          ) : null}
        </div>
      ),
    }),
    helper.accessor("ibName", {
      header: "Source",
      cell: (info) =>
        info.row.original.ibId ? <span className="font-medium">{info.getValue()}</span> : <Pill tone="gold">Direct</Pill>,
    }),
    helper.accessor("grossProfit", {
      header: "Net result",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <ProfitText value={info.getValue()} />,
    }),
    helper.accessor("carryIn", {
      header: "Loss brought fwd",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) =>
        signOf(info.getValue()) < 0 ? (
          <ProfitText value={info.getValue()} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    }),
    helper.accessor("splitBase", {
      header: "Split base",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold">{formatCurrency(info.getValue())}</span>,
    }),
    helper.accessor("trader", {
      header: "Trader",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <SplitAmount value={info.getValue()} pct={formatPercent(info.row.original.split.trader)} />,
    }),
    helper.accessor("company", {
      header: "Company",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <SplitAmount value={info.getValue()} pct={formatPercent(info.row.original.split.company)} />,
    }),
    ...(ibOn ? [ibColumn] : []),
    helper.accessor("client", {
      header: "Client",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <SplitAmount value={info.getValue()} pct={formatPercent(info.row.original.split.client)} strong />,
    }),
    helper.accessor("carryOut", {
      header: "Loss carried",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) =>
        signOf(info.getValue()) < 0 ? (
          <ProfitText value={info.getValue()} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    }),
    helper.accessor("payoutStatus", {
      header: "Payout / fee",
      cell: (info) => {
        const r = info.row.original;
        if (!finalized) return <StatusBadge status="open" />;
        if (signOf(r.payoutAmount) <= 0) return <span className="text-xs text-muted-foreground">Nothing due</span>;
        return (
          <div className="leading-tight">
            <StatusBadge status={r.payoutStatus} detail={r.paidAt ? formatDate(r.paidAt) : undefined} />
            <p className="num mt-1 text-xs text-muted-foreground">
              {r.payoutType === "fee" ? "Fee due " : "To client "}
              {formatCurrency(r.payoutAmount)}
            </p>
          </div>
        );
      },
    }),
    helper.display({
      id: "action",
      header: "Action",
      meta: { align: "right" },
      cell: (info) => {
        const r = info.row.original;
        return payButton(
          { partyType: r.payoutType, partyId: r.clientId, name: r.clientName, amount: r.payoutAmount },
          r.payoutStatus,
        );
      },
    }),
  ];

  const partyColumns: DataTableColumn<Payout>[] = [
    partyHelper.accessor("name", {
      header: "Payee",
      cell: (info) => (
        <div className="leading-tight">
          <p className="font-semibold">{info.getValue()}</p>
          <p className="text-xs text-muted-foreground">
            {info.row.original.partyType === "trader" ? "Trader share" : "IB commission"}
          </p>
        </div>
      ),
    }),
    partyHelper.accessor("amount", {
      header: "Amount",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold">{formatCurrency(info.getValue())}</span>,
    }),
    partyHelper.accessor("status", {
      header: "Status",
      cell: (info) =>
        finalized ? (
          <StatusBadge
            status={info.getValue()}
            detail={info.row.original.paidAt ? formatDate(info.row.original.paidAt) : undefined}
          />
        ) : (
          <StatusBadge status="open" />
        ),
    }),
    partyHelper.display({
      id: "action",
      header: "Action",
      meta: { align: "right" },
      cell: (info) => {
        const p = info.row.original;
        return payButton({ partyType: p.partyType, partyId: p.partyId, name: p.name, amount: p.amount }, p.status);
      },
    }),
  ];

  const footer = (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={2} className="font-bold">
        Totals <span className="font-normal text-muted-foreground">({split.rows.length} clients)</span>
      </TableCell>
      <TableCell className="num text-right">{formatCurrency(split.totalCapital)}</TableCell>
      <TableCell className="num text-right">{formatCurrency(sumMoney(split.rows.map((r) => r.grossProfit)))}</TableCell>
      <TableCell className="num text-right">{formatCurrency(split.trader)}</TableCell>
      <TableCell className="num text-right">{formatCurrency(sumMoney(split.rows.map((r) => r.company)))}</TableCell>
      <TableCell className="num text-right">{formatCurrency(split.ib)}</TableCell>
      <TableCell className="num text-right text-gold-ink">{formatCurrency(split.client)}</TableCell>
      <TableCell colSpan={2} />
    </TableRow>
  );

  async function onExport() {
    setExporting(true);
    try {
      await exportProfitSplit(month!);
      toast.success("Excel file downloaded");
    } catch (err) {
      toast.error("Couldn't export", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Profit Split · {formatMonth(month)}
            <StatusBadge status={split.status} detail={split.finalizedAt ? formatDate(split.finalizedAt) : undefined} />
          </span>
        }
        description={
          finalized
            ? `Locked — these numbers no longer change. ${pending} payout${pending === 1 ? "" : "s"} still pending.`
            : "Running totals for the open month. Finalize once trading for the month is complete."
        }
        actions={
          <>
            <Button variant="outline" onClick={onExport} disabled={exporting}>
              {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} Export Excel
            </Button>
            {canEdit && !finalized ? (
              <WithReason reason={split.finalizeBlocker}>
                <Button onClick={() => setFinalizing(true)} disabled={split.finalizeBlocker !== null} className="font-semibold">
                  <Lock aria-hidden /> Finalize Month
                </Button>
              </WithReason>
            ) : null}
            {canEdit && finalized ? (
              <WithReason reason={split.reopenBlocker}>
                <Button variant="outline" onClick={() => setReopening(true)} disabled={split.reopenBlocker !== null}>
                  <LockOpen aria-hidden /> Reopen month
                </Button>
              </WithReason>
            ) : null}
          </>
        }
      />

      <SummaryStrip split={split} />

      <Card className="gap-0 py-0">
        <Tabs defaultValue="clients" className="gap-0">
          <FilterBar>
            <TabsList>
              <TabsTrigger value="clients" className="px-3">
                Clients
              </TabsTrigger>
              <TabsTrigger value="parties" className="px-3">
                Trader &amp; IB payouts
              </TabsTrigger>
            </TabsList>
            <div className="md:ml-auto md:w-72">
              <SearchInput
                id="split-search"
                label="Search clients"
                value={search}
                onChange={setSearch}
                placeholder="Search client or IB"
              />
            </div>
          </FilterBar>
          <TabsContent value="clients">
            <p className="border-b px-5 py-2.5 text-xs text-muted-foreground">
              Each day&apos;s profit is shared by the capital active that day, then split by each client&apos;s % (IB commission
              per the IB&apos;s rule).
            </p>
            <DataTable
              columns={columns}
              data={split.rows}
              globalFilter={search}
              getRowId={(r) => r.clientId}
              footer={footer}
              initialSorting={[{ id: "capital", desc: true }]}
              empty={
                <EmptyState
                  icon={PieChart}
                  title={search ? "No clients match" : "No capital in the pool"}
                  description={search ? "Try a different search." : "No client had capital on this month's trading days."}
                />
              }
            />
          </TabsContent>
          <TabsContent value="parties">
            <DataTable
              columns={partyColumns}
              data={split.partyPayouts}
              getRowId={(p) => `${p.partyType}:${p.partyId}`}
              empty={<EmptyState icon={PieChart} title="No trader or IB payouts" description="Nothing was earned this month." />}
            />
          </TabsContent>
        </Tabs>
      </Card>

      <ConfirmDialog
        open={finalizing}
        onOpenChange={setFinalizing}
        title={`Finalize ${formatMonth(month)}?`}
        description={
          <div className="space-y-2">
            <p>
              This locks the split for <strong className="text-foreground">{split.rows.length} clients</strong> on a net profit of{" "}
              <strong className="num text-foreground">{formatCurrency(split.netProfit, { signed: true })}</strong> and creates
              pending payouts for clients, the trader and IBs.
            </p>
            <p>
              After this, trades, transactions or settings changes won&apos;t alter this month. An admin can reopen it with a
              reason.
            </p>
          </div>
        }
        confirmLabel="Finalize month"
        onConfirm={async () => {
          try {
            await finalizeMonth(month);
            toast.success(`${formatMonth(month)} finalized`);
            notifyDataChanged();
          } catch (err) {
            toast.error("Couldn't finalize month", { description: err instanceof Error ? err.message : undefined });
            throw err;
          }
        }}
      />

      <ReopenDialog month={month} open={reopening} onOpenChange={setReopening} onDone={notifyDataChanged} />

      <ConfirmDialog
        open={paying !== null}
        onOpenChange={(open) => !open && setPaying(null)}
        title="Mark payout as paid?"
        description={
          paying ? (
            <>
              Record that <strong className="text-foreground">{paying.name}</strong> was paid{" "}
              <strong className="num text-foreground">{formatCurrency(paying.amount)}</strong> for {formatMonth(month)}.
            </>
          ) : null
        }
        confirmLabel="Mark as paid"
        onConfirm={async () => {
          if (!paying) return;
          try {
            await markPaid(month, paying.partyType, paying.partyId);
            toast.success(`Payout to ${paying.name} marked as paid`);
            notifyDataChanged();
          } catch (err) {
            toast.error("Couldn't update payout", { description: err instanceof Error ? err.message : undefined });
            throw err;
          }
        }}
      />
    </div>
  );
}

function ReopenDialog({
  month,
  open,
  onOpenChange,
  onDone,
}: {
  month: MonthKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const tooShort = reason.trim().length < 5;

  async function submit() {
    setPending(true);
    try {
      await reopenMonth(month, reason.trim());
      toast.success(`${formatMonth(month)} reopened`, { description: "The reason was written to the audit log." });
      setReason("");
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error("Couldn't reopen month", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reopen {formatMonth(month)}?</DialogTitle>
          <DialogDescription>
            The month&apos;s numbers will be recalculated from current trades and transactions. Payouts already marked paid stay
            paid; pending ones are removed until you finalize again.
          </DialogDescription>
        </DialogHeader>
        <FormField
          id="reopen-reason"
          label="Reason (required)"
          error={reason && tooShort ? "Give a reason of at least 5 characters" : undefined}
          hint="Written to the audit log with your name."
        >
          <Textarea id="reopen-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || tooShort} className="font-semibold">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LockOpen aria-hidden />} Reopen month
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SplitAmount({ value, pct, strong = false }: { value: string; pct: string; strong?: boolean }) {
  return (
    <div className="leading-tight">
      <p className={cn("num", strong ? "font-bold text-gold-ink" : "font-medium")}>{formatCurrency(value)}</p>
      <p className="num text-xs text-muted-foreground">{pct}</p>
    </div>
  );
}

function SummaryStrip({ split }: { split: MonthlySplit }) {
  const parts = [
    { label: "Trader", value: split.trader, dot: "bg-share-trader" },
    { label: "Company", value: split.company, dot: "bg-share-company" },
    { label: "IBs", value: split.ib, dot: "bg-share-ib" },
    { label: "Clients", value: split.client, dot: "bg-share-client" },
  ];
  const base = sumMoney(parts.map((p) => p.value));

  return (
    <Card className="gap-0 py-0">
      <div className="grid grid-cols-1 divide-y lg:grid-cols-[1.3fr_auto_1fr_1fr_1fr_1fr] lg:divide-x lg:divide-y-0">
        <div className="px-5 py-4">
          <p className="eyebrow">Total net profit</p>
          <ProfitText value={split.netProfit} className="mt-1 block text-2xl font-bold" />
          <p className="mt-1 text-xs text-muted-foreground">
            Avg. <span className="num">{formatCurrency(split.totalCapital)}</span> pooled ·{" "}
            <span className="num">{split.tradingDays}</span> trading days
          </p>
        </div>
        <div className="hidden items-center px-3 text-muted-foreground lg:flex" aria-hidden>
          <ArrowRight className="size-5" />
        </div>
        {parts.map((p) => (
          <div key={p.label} className="px-5 py-4">
            <p className="eyebrow flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", p.dot)} aria-hidden />
              {p.label}{" "}
              <span className="num normal-case">
                {signOf(base) > 0 ? formatPercent(percentOf(p.value, base, 2), { places: 2 }) : ""}
              </span>
            </p>
            <p className="num mt-1 text-xl font-bold">{formatCurrency(p.value)}</p>
          </div>
        ))}
      </div>
      {signOf(split.netProfit) <= 0 ? (
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          The pool made no net profit this month, so there is nothing to split.{" "}
          {split.lossHandling === "carry_forward"
            ? "Each client's loss is carried forward and recovered before any shares are taken."
            : "Losses are not carried into next month."}
        </p>
      ) : null}
      {signOf(split.companyAdjustment) !== 0 ? (
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Company includes an adjustment of{" "}
          <span className="num font-semibold text-foreground">{formatCurrency(split.companyAdjustment, { signed: true })}</span>{" "}
          (rounding cents, and profit from days when no client had capital) so totals match the month&apos;s net exactly.
        </p>
      ) : null}
    </Card>
  );
}
