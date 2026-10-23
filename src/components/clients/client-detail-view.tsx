"use client";

import { CalendarDays, FileDown, FileText, Loader2, Lock, Mail, Network, Pencil, Phone, Plus, Trash2, UserX } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/layout/app-context";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { columnHelper, DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { ProfitText } from "@/components/shared/profit-text";
import { PageSkeleton } from "@/components/shared/skeletons";
import { SplitBar } from "@/components/shared/split-bar";
import { Pill, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAsync } from "@/hooks/use-async";
import { deleteTransaction, downloadStatement, getClient, markPaid } from "@/lib/api";
import { formatCurrency, formatPercent, percentOf, signOf, sum, sumMoney, toDecimal, toMoney } from "@/lib/calculations";
import { formatDate, formatMonth } from "@/lib/dates";
import type { ClientDetail, ClientMonthRecord, MonthKey, Transaction } from "@/lib/types";
import { initials } from "@/lib/utils";
import { ClientFormSheet } from "./client-form-sheet";
import { TransactionDialog } from "./transaction-dialog";

export function ClientDetailView() {
  const { id } = useParams<{ id: string }>();
  const { month, dataVersion, notifyDataChanged } = useApp();
  const { data: client, loading } = useAsync(() => getClient(id, month ?? undefined), [id, month, dataVersion], {
    enabled: month !== null,
    keepPreviousData: true,
  });

  if (client === undefined || (loading && client?.id !== id)) return <PageSkeleton kpis={3} />;
  if (client === null) {
    return (
      <Card>
        <EmptyState
          icon={UserX}
          title="Client not found"
          description="This client doesn't exist or may have been removed."
          action={
            <Button asChild variant="outline">
              <Link href="/clients">Back to clients</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  return <ClientDetailContent client={client} month={month!} onChanged={notifyDataChanged} />;
}

function useStatementDownload(client: ClientDetail) {
  const [busy, setBusy] = useState<MonthKey | null>(null);
  async function download(month: MonthKey) {
    setBusy(month);
    try {
      await downloadStatement(client.id, month);
    } catch (err) {
      toast.error("Couldn't create the statement", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }
  return { busy, download };
}

function ClientDetailContent({ client, month, onChanged }: { client: ClientDetail; month: MonthKey; onChanged: () => void }) {
  const { canEdit } = useApp();
  const [editing, setEditing] = useState(false);
  const statement = useStatementDownload(client);
  const current = client.history.find((h) => h.month === month);
  const paidMonths = client.history.filter((h) => h.payoutStatus === "paid").length;
  const deposits = sum(client.transactions.filter((t) => t.type === "deposit").map((t) => t.amount));
  const roi = deposits.isZero() ? null : percentOf(client.totalProfit, deposits, 2);
  const avgMonthly = client.history.length ? toDecimal(client.totalProfit).dividedBy(client.history.length) : toDecimal(0);

  return (
    <div className="space-y-6">
      <PageHeader back={{ href: "/clients", label: "Clients" }} title="Client details" />

      <Card className="relative gap-0 overflow-hidden px-5 py-5 sm:px-6">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-linear-to-l from-gold-soft/70 to-transparent" aria-hidden />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-[#1c1a17] text-xl font-bold text-gold" aria-hidden>
              {initials(client.fullName)}
            </span>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{client.fullName}</h2>
                <Pill tone="gold" className="num">
                  {client.code}
                </Pill>
                <StatusBadge status={client.status} />
              </div>
              <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                <Meta icon={Phone} label="Phone">
                  <span className="num">{client.phone}</span>
                </Meta>
                <Meta icon={Mail} label="Email">
                  <a href={`mailto:${client.email}`} className="hover:text-foreground hover:underline">
                    {client.email}
                  </a>
                </Meta>
                <Meta icon={Network} label="IB">
                  <Link href={`/ibs/${client.ibId}`} className="font-medium text-gold-ink hover:underline">
                    {client.ibName}
                  </Link>
                </Meta>
                <Meta icon={CalendarDays} label="Joined">
                  <span className="num">{formatDate(client.joinedAt)}</span>
                </Meta>
              </dl>
              {client.notes ? <p className="max-w-xl text-sm text-muted-foreground">{client.notes}</p> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 self-start">
            {canEdit ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Edit
              </Button>
            ) : null}
            <Button onClick={() => statement.download(month)} disabled={statement.busy !== null} className="font-semibold">
              {statement.busy === month ? <Loader2 className="animate-spin" aria-hidden /> : <FileDown aria-hidden />}
              {formatMonth(month, { short: true })} statement (PDF)
            </Button>
          </div>
        </div>
      </Card>

      {signOf(client.carriedLoss) < 0 ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-xl border border-loss/25 bg-loss-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-sm font-semibold text-loss">Carried-forward loss</p>
            <p className="text-xs text-muted-foreground">
              No trader, company or IB share is taken from this client until it is recovered.
            </p>
          </div>
          <ProfitText value={client.carriedLoss} className="text-xl font-bold" />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <KpiCard
          label="Invested capital"
          value={formatCurrency(client.investedCapital)}
          badge={<Pill tone="grey">Not split</Pill>}
          footer={
            <>
              Total deposited <span className="num font-semibold text-foreground">{formatCurrency(deposits)}</span> · from
              transactions only
            </>
          }
        />
        <KpiCard
          label={`${formatMonth(month)} · client result`}
          value={<ProfitText value={current?.client ?? "0"} className="font-bold" />}
          badge={
            current && signOf(current.client) > 0 && signOf(current.capital) > 0 ? (
              <Pill tone="green">{formatPercent(percentOf(current.client, current.capital, 2), { signed: true, places: 2 })}</Pill>
            ) : null
          }
          className="bg-linear-to-br from-card to-gold-soft/40"
          footer={
            current ? (
              <div className="space-y-2">
                <p>
                  From <span className="num font-semibold text-foreground">{formatCurrency(current.grossProfit)}</span> gross
                  profit on capital
                  {signOf(current.carryIn) < 0 ? (
                    <>
                      , after recovering <span className="num font-semibold text-foreground">{formatCurrency(current.carryIn)}</span>{" "}
                      of earlier losses
                    </>
                  ) : null}
                  {current.monthStatus === "open" ? " (month still open)" : ""}
                </p>
                <SplitBar split={current.split} />
              </div>
            ) : (
              "No capital in the pool on this month's trading days."
            )
          }
        />
        <KpiCard
          label="Total profit earned"
          value={<ProfitText value={client.totalProfit} className="font-bold" />}
          badge={roi !== null ? <Pill tone="green">{formatPercent(roi, { signed: true, places: 2 })} ROI</Pill> : null}
          footer={
            <>
              Avg. per month <span className="num font-semibold text-foreground">{formatCurrency(avgMonthly)}</span> · {paidMonths}{" "}
              {paidMonths === 1 ? "payout" : "payouts"} made
            </>
          }
        />
      </div>

      <Card className="gap-0 py-0">
        <Tabs defaultValue="monthly" className="gap-0">
          <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold">History</h2>
              <p className="text-xs text-muted-foreground">Profit allocated each month and money moved in or out.</p>
            </div>
            <TabsList>
              <TabsTrigger value="monthly" className="px-3">
                Monthly breakdown
              </TabsTrigger>
              <TabsTrigger value="transactions" className="px-3">
                Transactions
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="monthly">
            <MonthlyBreakdown client={client} onChanged={onChanged} statement={statement} />
          </TabsContent>
          <TabsContent value="transactions">
            <Transactions client={client} onChanged={onChanged} />
          </TabsContent>
        </Tabs>
      </Card>

      {canEdit ? <ClientFormSheet open={editing} onOpenChange={setEditing} client={client} onSaved={onChanged} /> : null}
    </div>
  );
}

function Meta({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt>
        <Icon className="size-3.5" aria-hidden />
        <span className="sr-only">{label}</span>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

const money = (value: string, className = "") => <span className={`num ${className}`}>{formatCurrency(value)}</span>;
const monthHelper = columnHelper<ClientMonthRecord>();

function MonthlyBreakdown({
  client,
  onChanged,
  statement,
}: {
  client: ClientDetail;
  onChanged: () => void;
  statement: ReturnType<typeof useStatementDownload>;
}) {
  const { canEdit } = useApp();
  const [confirming, setConfirming] = useState<ClientMonthRecord | null>(null);

  const columns: DataTableColumn<ClientMonthRecord>[] = [
    monthHelper.accessor("month", {
      header: "Month",
      cell: (info) => (
        <div className="leading-tight">
          <p className="font-semibold">{formatMonth(info.getValue())}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {info.row.original.monthStatus === "open" ? <span className="text-gold-ink">Open month</span> : "Finalized"}
          </p>
        </div>
      ),
    }),
    monthHelper.accessor("capital", {
      header: "Avg. capital",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => money(info.getValue(), "text-muted-foreground"),
    }),
    monthHelper.accessor("grossProfit", {
      header: "Gross",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => money(info.getValue(), "font-semibold"),
    }),
    monthHelper.accessor("trader", {
      header: "Trader",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => (
        <div className="leading-tight">
          {money(info.getValue())}
          <p className="num text-xs text-muted-foreground">{formatPercent(info.row.original.split.trader)}</p>
        </div>
      ),
    }),
    monthHelper.accessor("company", {
      header: "Company",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => (
        <div className="leading-tight">
          {money(info.getValue())}
          <p className="num text-xs text-muted-foreground">{formatPercent(info.row.original.split.company)}</p>
        </div>
      ),
    }),
    monthHelper.accessor("ib", {
      header: "IB",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => money(info.getValue(), "text-muted-foreground"),
    }),
    monthHelper.accessor("client", {
      header: "Client",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <ProfitText value={info.getValue()} signed={false} className="text-gold-ink" />,
    }),
    monthHelper.accessor("carryOut", {
      header: "Carried loss",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) =>
        signOf(info.getValue()) < 0 ? <ProfitText value={info.getValue()} /> : <span className="text-xs text-muted-foreground">—</span>,
    }),
    monthHelper.accessor("payoutStatus", {
      header: "Payout",
      cell: (info) => {
        const r = info.row.original;
        if (r.monthStatus === "open") return <StatusBadge status="open" detail="in progress" />;
        if (signOf(r.payoutAmount) <= 0) return <span className="text-xs text-muted-foreground">Nothing due</span>;
        return (
          <div className="leading-tight">
            <StatusBadge status={r.payoutStatus} detail={r.paidAt ? formatDate(r.paidAt) : undefined} />
            <p className="num mt-1 text-xs text-muted-foreground">{formatCurrency(r.payoutAmount)}</p>
          </div>
        );
      },
    }),
    monthHelper.display({
      id: "action",
      header: "Action",
      meta: { align: "right" },
      cell: (info) => {
        const r = info.row.original;
        const payable = r.monthStatus === "finalized" && r.payoutStatus === "pending" && signOf(r.payoutAmount) > 0;
        return (
          <div className="flex justify-end gap-2">
            {canEdit && payable ? (
              <Button size="sm" onClick={() => setConfirming(r)}>
                Mark paid
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => statement.download(r.month)}
              disabled={statement.busy !== null}
              aria-label={`Download ${formatMonth(r.month)} statement`}
            >
              {statement.busy === r.month ? <Loader2 className="animate-spin" aria-hidden /> : <FileText aria-hidden />} PDF
            </Button>
          </div>
        );
      },
    }),
  ];

  const h = client.history;
  const footer = (
    <TableRow className="hover:bg-transparent">
      <TableCell className="font-bold">
        Total <span className="font-normal text-muted-foreground">({h.length} months)</span>
      </TableCell>
      <TableCell />
      <TableCell className="num text-right">{formatCurrency(sumMoney(h.map((r) => r.grossProfit)))}</TableCell>
      <TableCell className="num text-right">{formatCurrency(sumMoney(h.map((r) => r.trader)))}</TableCell>
      <TableCell className="num text-right">{formatCurrency(sumMoney(h.map((r) => r.company)))}</TableCell>
      <TableCell className="num text-right">{formatCurrency(sumMoney(h.map((r) => r.ib)))}</TableCell>
      <TableCell className="num text-right text-gold-ink">{formatCurrency(sumMoney(h.map((r) => r.client)))}</TableCell>
      <TableCell colSpan={3} />
    </TableRow>
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={h}
        getRowId={(r) => r.month}
        footer={footer}
        empty={
          <EmptyState
            icon={FileText}
            title="No months yet"
            description="A deposit earns from the day after its effective date, on days the pool trades."
          />
        }
      />
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Mark payout as paid?"
        description={
          confirming ? (
            <>
              Record that <strong className="text-foreground">{client.fullName}</strong> was paid{" "}
              <strong className="num text-foreground">{formatCurrency(confirming.payoutAmount)}</strong> for{" "}
              {formatMonth(confirming.month)}.
            </>
          ) : null
        }
        confirmLabel="Mark as paid"
        onConfirm={async () => {
          if (!confirming) return;
          try {
            await markPaid(confirming.month, "client", client.id);
            toast.success("Payout marked as paid");
            onChanged();
          } catch (err) {
            toast.error("Couldn't update payout", { description: err instanceof Error ? err.message : undefined });
            throw err;
          }
        }}
      />
    </>
  );
}

interface TransactionRow extends Transaction {
  balance: string;
}

/** Adds the capital balance after each transaction; returns newest first. */
function withRunningBalance(transactions: Transaction[]): TransactionRow[] {
  let balance = toDecimal(0);
  const rows: TransactionRow[] = [];
  for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    balance = t.type === "deposit" ? balance.plus(t.amount) : balance.minus(t.amount);
    rows.push({ ...t, balance: toMoney(balance) });
  }
  return rows.reverse();
}

const txHelper = columnHelper<TransactionRow>();

function Transactions({ client, onChanged }: { client: ClientDetail; onChanged: () => void }) {
  const { canEdit } = useApp();
  const [editing, setEditing] = useState<Transaction | "new" | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const rows = withRunningBalance(client.transactions);

  const columns: DataTableColumn<TransactionRow>[] = [
    txHelper.accessor("date", {
      header: "Effective date",
      cell: (info) => (
        <span className="num inline-flex items-center gap-1.5">
          {formatDate(info.getValue())}
          {info.row.original.locked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} aria-label="Locked: falls in a finalized month">
                  <Lock className="size-3 text-muted-foreground" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>Falls in a finalized month — reopen it to change</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      ),
    }),
    txHelper.accessor("type", {
      header: "Type",
      cell: (info) => (
        <Pill tone={info.getValue() === "deposit" ? "green" : "red"}>{info.getValue() === "deposit" ? "Deposit" : "Withdrawal"}</Pill>
      ),
    }),
    txHelper.accessor("amount", {
      header: "Amount",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => <ProfitText value={info.row.original.type === "deposit" ? info.getValue() : `-${info.getValue()}`} />,
    }),
    txHelper.accessor("balance", {
      header: "Capital after",
      sortFn: "decimal",
      meta: { align: "right" },
      cell: (info) => money(info.getValue(), "font-semibold"),
    }),
    txHelper.accessor("note", {
      header: "Note",
      enableSorting: false,
      cell: (info) => <span className="text-muted-foreground">{info.getValue() ?? "—"}</span>,
    }),
    ...(canEdit
      ? [
          txHelper.display({
            id: "actions",
            header: "Actions",
            meta: { align: "right" },
            cell: (info) =>
              info.row.original.locked ? (
                <span className="text-xs text-muted-foreground">Locked</span>
              ) : (
                <div className="flex justify-end gap-1">
                  <Button size="icon-sm" variant="ghost" onClick={() => setEditing(info.row.original)} aria-label="Edit transaction">
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-loss hover:text-loss"
                    onClick={() => setDeleting(info.row.original)}
                    aria-label="Delete transaction"
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ),
          }),
        ]
      : []),
  ];

  return (
    <>
      {canEdit ? (
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <p className="text-xs text-muted-foreground">Capital is always the sum of these transactions.</p>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add transaction
          </Button>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(t) => t.id}
        empty={<EmptyState icon={FileText} title="No transactions" description="Deposits and withdrawals will appear here." />}
      />
      <TransactionDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        clientId={client.id}
        transaction={editing === "new" || editing === null ? undefined : editing}
        onSaved={onChanged}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this transaction?"
        description={
          deleting ? (
            <>
              The {deleting.type} of <strong className="num text-foreground">{formatCurrency(deleting.amount)}</strong> effective{" "}
              {formatDate(deleting.date)} will be removed and open months recalculated.
            </>
          ) : null
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteTransaction(deleting.id);
            toast.success("Transaction deleted");
            onChanged();
          } catch (err) {
            toast.error("Couldn't delete transaction", { description: err instanceof Error ? err.message : undefined });
            throw err;
          }
        }}
      />
    </>
  );
}
