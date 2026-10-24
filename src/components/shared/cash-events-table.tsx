"use client";

import { BadgeCheck, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/layout/app-context";
import { columnHelper, DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DateTime } from "@/components/shared/date-time";
import { EmptyState } from "@/components/shared/empty-state";
import { ProfitText } from "@/components/shared/profit-text";
import { TableSkeleton } from "@/components/shared/skeletons";
import { Pill } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAsync } from "@/hooks/use-async";
import { classifyCashEvent, getCashEvents } from "@/lib/api";
import { formatCurrency } from "@/lib/calculations";
import { formatMonth } from "@/lib/dates";
import { CASH_KIND_LABELS } from "@/lib/mt5";
import type { CashClass, CashEvent } from "@/lib/types";

const CLASS_LABEL: Record<CashClass, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  fee_payment: "Fee payment",
  ignore: "Ignore",
};
const CLASS_TONE = { deposit: "green", withdrawal: "red", fee_payment: "gold", ignore: "grey" } as const;

/** Which classifications make sense for an event: by sign, and only "ignore" on a pooled account. */
function choicesFor(e: CashEvent): CashClass[] {
  if (!e.clientId) return ["ignore"];
  return e.amount.startsWith("-") ? ["withdrawal", "fee_payment", "ignore"] : ["deposit", "ignore"];
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : undefined);

/**
 * Balance operations from MT5 with one-click classification. Deposits and
 * withdrawals become the client's capital; a fee payment pays a month's fee.
 */
export function CashEventsTable({ clientId, version = 0 }: { clientId?: string; version?: number }) {
  const { canEdit, dataVersion, notifyDataChanged } = useApp();
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(clientId === undefined);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [busy, setBusy] = useState<string | null>(null);
  const [feeFor, setFeeFor] = useState<CashEvent | null>(null);
  const { data, loading } = useAsync(
    () => getCashEvents({ page: pagination.pageIndex, pageSize: pagination.pageSize, unreviewed: onlyUnreviewed, clientId }),
    [pagination.pageIndex, pagination.pageSize, onlyUnreviewed, clientId, dataVersion, version],
    { keepPreviousData: true },
  );

  async function classify(e: CashEvent, classification: CashClass, feeMonth?: string) {
    const key = `${e.accountLogin}:${e.dealTicket}`;
    setBusy(key);
    try {
      await classifyCashEvent({ accountLogin: e.accountLogin, dealTicket: e.dealTicket, classification, feeMonth });
      toast.success(`Marked as ${CLASS_LABEL[classification].toLowerCase()}`, {
        description: classification === "deposit" || classification === "withdrawal" ? "The client's capital was updated." : undefined,
      });
      notifyDataChanged();
      return true;
    } catch (err) {
      toast.error("Couldn't classify", { description: errorText(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const helper = columnHelper<CashEvent>();
  const columns: DataTableColumn<CashEvent>[] = [
    helper.accessor("time", { header: "When", enableSorting: false, cell: (info) => <DateTime value={info.getValue()} className="text-xs" /> }),
    helper.accessor("accountLogin", {
      header: clientId ? "Account" : "Account / client",
      enableSorting: false,
      cell: (info) => (
        <div className="leading-tight">
          <p className="num text-sm">{info.getValue()}</p>
          <p className="text-xs text-muted-foreground">{clientId ? `deal #${info.row.original.dealTicket}` : (info.row.original.clientName ?? "Pooled account")}</p>
        </div>
      ),
    }),
    helper.accessor("kind", {
      header: "MT5 type",
      enableSorting: false,
      cell: (info) => (
        <div className="leading-tight">
          <Pill tone="grey">{CASH_KIND_LABELS[info.getValue()] ?? info.getValue()}</Pill>
          {info.row.original.comment ? <p className="mt-1 max-w-48 truncate text-xs text-muted-foreground">{info.row.original.comment}</p> : null}
        </div>
      ),
    }),
    helper.accessor("amount", { header: "Amount", enableSorting: false, meta: { align: "right" }, cell: (info) => <ProfitText value={info.getValue()} /> }),
    helper.display({
      id: "classification",
      header: "Counts as",
      cell: (info) => {
        const e = info.row.original;
        if (e.classification) {
          return (
            <div className="leading-tight">
              <Pill tone={CLASS_TONE[e.classification]}>
                <BadgeCheck className="size-3" aria-hidden /> {CLASS_LABEL[e.classification]}
                {e.feeMonth ? ` · ${formatMonth(e.feeMonth, { short: true })}` : ""}
              </Pill>
              {e.reviewedBy ? <p className="mt-1 text-xs text-muted-foreground">{e.reviewedBy}</p> : null}
            </div>
          );
        }
        return (
          <div className="leading-tight">
            <Pill tone="amber">Needs review</Pill>
            <p className="mt-1 text-xs text-muted-foreground">Suggested: {CLASS_LABEL[e.suggestedClass]}</p>
          </div>
        );
      },
    }),
    ...(canEdit
      ? [
          helper.display({
            id: "actions",
            header: "Classify",
            meta: { align: "right" },
            cell: (info) => {
              const e = info.row.original;
              const key = `${e.accountLogin}:${e.dealTicket}`;
              return (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {busy === key ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
                  {choicesFor(e).map((c) => {
                    const current = e.classification === c;
                    const suggested = !e.classification && e.suggestedClass === c;
                    return (
                      <Button
                        key={c}
                        size="sm"
                        variant={suggested ? "default" : "outline"}
                        disabled={busy !== null || current}
                        onClick={() => (c === "fee_payment" ? setFeeFor(e) : void classify(e, c))}
                      >
                        {CLASS_LABEL[c]}
                      </Button>
                    );
                  })}
                </div>
              );
            },
          }),
        ]
      : []),
  ];

  return (
    <>
      <div className="flex items-center gap-2 border-b px-5 py-3">
        <Checkbox
          id={`cash-unreviewed-${clientId ?? "all"}`}
          checked={onlyUnreviewed}
          onCheckedChange={(v) => {
            setOnlyUnreviewed(v === true);
            setPagination((p) => ({ ...p, pageIndex: 0 }));
          }}
        />
        <Label htmlFor={`cash-unreviewed-${clientId ?? "all"}`} className="text-sm font-normal">
          Only show events that need review
        </Label>
      </div>
      {data ? (
        <DataTable
          columns={columns}
          data={data.rows}
          getRowId={(e) => `${e.accountLogin}:${e.dealTicket}`}
          server={{ rowCount: data.total, pagination, onPaginationChange: setPagination, sorting: [], onSortingChange: () => undefined, loading }}
          empty={<EmptyState icon={BadgeCheck} title={onlyUnreviewed ? "Nothing to review" : "No deposits or withdrawals yet"} />}
        />
      ) : (
        <TableSkeleton rows={3} columns={5} />
      )}
      <FeeMonthDialog
        event={feeFor}
        onClose={() => setFeeFor(null)}
        onConfirm={async (month) => {
          if (feeFor && (await classify(feeFor, "fee_payment", month || undefined))) setFeeFor(null);
        }}
      />
    </>
  );
}

function FeeMonthDialog({
  event,
  onClose,
  onConfirm,
}: {
  event: CashEvent | null;
  onClose: () => void;
  onConfirm: (month: string) => Promise<void>;
}) {
  const [month, setMonth] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fee payment</DialogTitle>
          <DialogDescription>
            {event ? (
              <>
                {event.clientName} paid <strong className="num text-foreground">{formatCurrency(event.amount.replace("-", ""))}</strong> of
                their trader/company share. It doesn&apos;t change their capital.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="fee-month" className="text-xs font-semibold">
            For month
          </Label>
          <Input id="fee-month" type="month" className="num" value={month} onChange={(e) => setMonth(e.target.value)} />
          <p className="text-xs text-muted-foreground">Leave empty to pay the oldest unpaid fee.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            className="font-semibold"
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm(month);
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Record fee payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
