"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, BadgeCheck, Eye, Info, Loader2, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { useApp } from "@/components/layout/app-context";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { columnHelper, DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DateTime } from "@/components/shared/date-time";
import { EmptyState } from "@/components/shared/empty-state";
import { describedBy, FormField } from "@/components/shared/form-field";
import { ProfitText } from "@/components/shared/profit-text";
import { TableSkeleton } from "@/components/shared/skeletons";
import { Pill } from "@/components/shared/status-badge";
import { SyncPill } from "@/components/shared/sync-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAsync } from "@/hooks/use-async";
import {
  createMt5Account,
  deleteMt5Account,
  getCashEvents,
  getClients,
  getMt5Accounts,
  getMt5Positions,
  getSyncWarnings,
  resolveSyncWarning,
  reviewCashEvent,
  updateMt5Account,
  type Mt5Position,
} from "@/lib/api";
import { formatCurrency, formatLots, formatPrice } from "@/lib/calculations";
import { CASH_KIND_LABELS } from "@/lib/mt5";
import type { CashEvent, Mt5Account } from "@/lib/types";
import { mt5AccountSchema } from "@/lib/validation";
import { SettingsCard } from "./settings-card";

const POOL = "pool";

/** "UTC+3h", "UTC+5:30h" */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

const OFFSETS = Array.from({ length: (840 + 720) / 30 + 1 }, (_, i) => -720 + i * 30);

function errorText(err: unknown) {
  return err instanceof Error ? err.message : undefined;
}

export function Mt5Panel() {
  const { canEdit, dataVersion, notifyDataChanged, settings } = useApp();
  const [version, setVersion] = useState(0);
  const refresh = () => {
    setVersion((v) => v + 1);
    notifyDataChanged();
  };
  const { data: accounts } = useAsync(getMt5Accounts, [dataVersion, version], { keepPreviousData: true });
  const [editing, setEditing] = useState<Mt5Account | "new" | null>(null);
  const [deleting, setDeleting] = useState<Mt5Account | null>(null);
  const [viewing, setViewing] = useState<Mt5Account | null>(null);

  const helper = columnHelper<Mt5Account>();
  const columns: DataTableColumn<Mt5Account>[] = [
    helper.accessor("label", {
      header: "Account",
      cell: (info) => {
        const a = info.row.original;
        return (
          <div className="leading-tight">
            <p className="flex items-center gap-2 font-semibold">
              {a.label}
              {a.isDemo ? <Pill tone="grey">demo</Pill> : null}
              {!a.isActive ? <Pill tone="grey">paused</Pill> : null}
            </p>
            <p className="num mt-0.5 text-xs text-muted-foreground">
              {a.login} @ {a.server}
            </p>
          </div>
        );
      },
    }),
    helper.accessor("linkedClientName", {
      header: "Profit goes to",
      enableSorting: false,
      cell: (info) =>
        info.row.original.linkedClientId ? (
          <span className="text-sm">{info.getValue()}</span>
        ) : (
          <span className="text-sm text-muted-foreground">Pool (all clients)</span>
        ),
    }),
    helper.accessor("brokerTimezoneOffsetMinutes", {
      header: "Broker clock",
      enableSorting: false,
      cell: (info) => {
        const a = info.row.original;
        const mismatch = a.detectedOffsetMinutes !== null && a.detectedOffsetMinutes !== a.brokerTimezoneOffsetMinutes;
        return (
          <div className="leading-tight">
            <span className="num text-sm">{formatOffset(info.getValue())}</span>
            {mismatch ? (
              <p className="num mt-0.5 text-xs font-semibold text-loss">detected {formatOffset(a.detectedOffsetMinutes!)}</p>
            ) : null}
          </div>
        );
      },
    }),
    helper.accessor("health", {
      header: "Sync",
      enableSorting: false,
      cell: (info) => {
        const a = info.row.original;
        if (a.isDemo) return <span className="text-xs text-muted-foreground">Seeded</span>;
        return (
          <div className="max-w-64 leading-tight">
            <SyncPill health={a.health} lastSyncAt={a.lastSyncAt} prefix="" />
            {a.lastSyncStatus === "error" && a.lastError ? (
              <p className="mt-1 text-xs whitespace-normal text-loss">{a.lastError}</p>
            ) : null}
          </div>
        );
      },
    }),
    helper.accessor("equity", {
      header: "Balance / equity",
      enableSorting: false,
      meta: { align: "right" },
      cell: (info) => {
        const a = info.row.original;
        if (a.balance === null) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="leading-tight">
            <p className="num font-semibold">{formatCurrency(a.balance)}</p>
            <p className="num text-xs text-muted-foreground">eq. {formatCurrency(a.equity ?? "0")} · margin {formatCurrency(a.margin ?? "0")}</p>
          </div>
        );
      },
    }),
    helper.accessor("floatingPl", {
      header: "Floating P/L",
      enableSorting: false,
      meta: { align: "right" },
      cell: (info) =>
        info.getValue() === null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <button
            type="button"
            onClick={() => setViewing(info.row.original)}
            className="rounded text-right hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={`View open positions of ${info.row.original.label}`}
          >
            <ProfitText value={info.getValue()!} />
            <p className="text-xs text-muted-foreground">{info.row.original.openPositions} open</p>
          </button>
        ),
    }),
    ...(canEdit
      ? [
          helper.display({
            id: "actions",
            header: "Actions",
            meta: { align: "right" },
            cell: (info) =>
              info.row.original.isDemo ? null : (
                <div className="flex justify-end gap-1">
                  <Button size="icon-sm" variant="ghost" onClick={() => setEditing(info.row.original)} aria-label={`Edit ${info.row.original.label}`}>
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-loss hover:text-loss"
                    onClick={() => setDeleting(info.row.original)}
                    aria-label={`Delete ${info.row.original.label}`}
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
    <div className="space-y-6">
      <SettingsCard
        wide
        title="MT5 accounts"
        description="Trades sync automatically from these accounts via the MT5 worker on your Windows VPS. Passwords stay on the VPS — they are never stored here."
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" aria-hidden /> Green: synced in the last 5 min · amber: within 30 min · red: older, or the last sync failed.
          </p>
          {canEdit ? (
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add account
            </Button>
          ) : null}
        </div>
        {settings?.mt5.demoData ? (
          <p className="border-b bg-gold-soft/60 px-6 py-3 text-xs text-gold-ink">
            Demo trades are loaded. They are removed automatically the first time a real account syncs.
          </p>
        ) : null}
        {accounts ? (
          <DataTable
            columns={columns}
            data={accounts}
            getRowId={(a) => a.id}
            empty={
              <EmptyState
                icon={Server}
                title="No MT5 accounts yet"
                description="Add the pooled trading account, then start the worker on your VPS."
                action={
                  canEdit ? (
                    <Button onClick={() => setEditing("new")}>
                      <Plus aria-hidden /> Add account
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        ) : (
          <TableSkeleton rows={2} columns={6} />
        )}
      </SettingsCard>

      <WarningsCard version={version} onChanged={refresh} />
      <CashEventsCard version={version} />

      <AccountDialog
        account={editing === "new" ? undefined : (editing ?? undefined)}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={refresh}
      />
      <PositionsDialog account={viewing} onOpenChange={(open) => !open && setViewing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this MT5 account?"
        description={
          deleting ? (
            <>
              <strong className="text-foreground">{deleting.label}</strong> ({deleting.login}) will stop syncing. Accounts with synced deals
              can&apos;t be deleted — pause them instead so their history stays.
            </>
          ) : null
        }
        confirmLabel="Delete account"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteMt5Account(deleting.id);
            toast.success("Account deleted");
            refresh();
          } catch (err) {
            toast.error("Couldn't delete account", { description: errorText(err) });
            throw err;
          }
        }}
      />
    </div>
  );
}

// --- Add / edit ---------------------------------------------------------------------

type FormInput = z.input<typeof mt5AccountSchema>;
type FormOutput = z.output<typeof mt5AccountSchema>;

function AccountDialog({
  account,
  open,
  onOpenChange,
  onSaved,
}: {
  account?: Mt5Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{account ? `Edit ${account.label}` : "Add MT5 account"}</DialogTitle>
          <DialogDescription>
            Enter the login and server exactly as shown in MetaTrader 5. The investor password goes only into the worker on your VPS.
          </DialogDescription>
        </DialogHeader>
        {open ? <AccountForm account={account} onCancel={() => onOpenChange(false)} onSaved={() => (onOpenChange(false), onSaved())} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({ account, onCancel, onSaved }: { account?: Mt5Account; onCancel: () => void; onSaved: () => void }) {
  const { data: clients } = useAsync(() => getClients({ status: "active", pageSize: 500, sort: "fullName", dir: "asc" }), []);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(mt5AccountSchema),
    defaultValues: account
      ? {
          label: account.label,
          login: account.login,
          server: account.server,
          brokerTimezoneOffsetMinutes: account.brokerTimezoneOffsetMinutes,
          isActive: account.isActive,
          linkedClientId: account.linkedClientId,
        }
      : { label: "", login: undefined as unknown as number, server: "", brokerTimezoneOffsetMinutes: 180, isActive: true, linkedClientId: null },
  });

  async function onSubmit(values: FormOutput) {
    try {
      if (account) await updateMt5Account(account.id, values);
      else await createMt5Account(values);
      toast.success(account ? "Account updated" : "Account added", {
        description: account ? undefined : "Add the same login, password and server to the worker's accounts.json on the VPS.",
      });
      onSaved();
    } catch (err) {
      toast.error("Couldn't save account", { description: errorText(err) });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FormField id="mt5-label" label="Name" error={errors.label?.message}>
        <Input id="mt5-label" placeholder="Main pool account" aria-invalid={Boolean(errors.label)} aria-describedby={describedBy("mt5-label", errors.label?.message)} {...register("label")} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField id="mt5-login" label="Login (account number)" error={errors.login?.message}>
          <Input
            id="mt5-login"
            inputMode="numeric"
            className="num"
            aria-invalid={Boolean(errors.login)}
            aria-describedby={describedBy("mt5-login", errors.login?.message)}
            {...register("login", { valueAsNumber: true })}
          />
        </FormField>
        <FormField id="mt5-server" label="Server" error={errors.server?.message}>
          <Input
            id="mt5-server"
            placeholder="BrokerName-Live"
            aria-invalid={Boolean(errors.server)}
            aria-describedby={describedBy("mt5-server", errors.server?.message)}
            {...register("server")}
          />
        </FormField>
      </div>
      <FormField
        id="mt5-offset"
        label="Broker server clock"
        error={errors.brokerTimezoneOffsetMinutes?.message}
        hint="MT5 shows times in the broker's clock. Most brokers use UTC+2 in winter and UTC+3 in summer; the worker reports the real value each sync and warns if it differs."
      >
        <Controller
          control={control}
          name="brokerTimezoneOffsetMinutes"
          render={({ field }) => (
            <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
              <SelectTrigger id="mt5-offset" className="w-full" aria-describedby={describedBy("mt5-offset", undefined, true)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {OFFSETS.map((o) => (
                  <SelectItem key={o} value={String(o)}>
                    {formatOffset(o)}
                    {o === account?.detectedOffsetMinutes ? " (detected)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      <FormField id="mt5-client" label="Profit goes to" hint="The pooled account is shared by all clients by capital. Link a client only if this account trades just their money.">
        <Controller
          control={control}
          name="linkedClientId"
          render={({ field }) => (
            <Select value={field.value ?? POOL} onValueChange={(v) => field.onChange(v === POOL ? null : v)}>
              <SelectTrigger id="mt5-client" className="w-full" aria-describedby={describedBy("mt5-client", undefined, true)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={POOL}>Pool — shared by all clients</SelectItem>
                {(clients?.rows ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.fullName} ({c.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      <Controller
        control={control}
        name="isActive"
        render={({ field }) => (
          <div className="flex items-center gap-2">
            <Checkbox id="mt5-active" checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
            <Label htmlFor="mt5-active" className="text-sm font-normal">
              Active — accept syncs and count its trades
            </Label>
          </div>
        )}
      />
      {account ? (
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Changing the clock shifts this account&apos;s stored deals in open months; changing who gets the profit or pausing the
          account recalculates open months. Finalized months never change.
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="font-semibold">
          {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null} {account ? "Save changes" : "Add account"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// --- Positions ---------------------------------------------------------------------------

const positionHelper = columnHelper<Mt5Position>();
const positionColumns: DataTableColumn<Mt5Position>[] = [
  positionHelper.accessor("ticket", { header: "Ticket", cell: (info) => <span className="num">#{info.getValue()}</span> }),
  positionHelper.accessor("symbol", { header: "Symbol" }),
  positionHelper.accessor("type", { header: "Type", cell: (info) => <Pill tone={info.getValue() === "buy" ? "green" : "red"}>{info.getValue()}</Pill> }),
  positionHelper.accessor("volume", { header: "Lots", meta: { align: "right" }, cell: (info) => <span className="num">{formatLots(info.getValue())}</span> }),
  positionHelper.accessor("openTime", { header: "Opened", cell: (info) => <DateTime value={info.getValue()} className="text-xs" /> }),
  positionHelper.accessor("openPrice", { header: "Open", meta: { align: "right" }, cell: (info) => <span className="num">{formatPrice(info.getValue())}</span> }),
  positionHelper.accessor("currentPrice", { header: "Now", meta: { align: "right" }, cell: (info) => <span className="num">{formatPrice(info.getValue())}</span> }),
  positionHelper.accessor("profit", { header: "Floating", meta: { align: "right" }, cell: (info) => <ProfitText value={info.getValue()} /> }),
];

function PositionsDialog({ account, onOpenChange }: { account: Mt5Account | null; onOpenChange: (open: boolean) => void }) {
  // Optional chaining, not `!`: the React Compiler reads captured paths during render.
  const id = account?.id ?? "";
  const { data } = useAsync(() => getMt5Positions(id), [id], { enabled: id !== "" });
  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Open positions · {account?.label}</DialogTitle>
          <DialogDescription>As of the last sync. Floating P/L isn&apos;t profit until a position closes.</DialogDescription>
        </DialogHeader>
        {data ? (
          <DataTable columns={positionColumns} data={data} getRowId={(p) => String(p.ticket)} empty={<EmptyState icon={Server} title="No open positions" />} />
        ) : (
          <TableSkeleton rows={3} columns={6} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Warnings ---------------------------------------------------------------------------

function WarningsCard({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { canEdit, dataVersion } = useApp();
  const { data: warnings } = useAsync(getSyncWarnings, [dataVersion, version], { keepPreviousData: true });
  if (!warnings?.length) return null;
  return (
    <SettingsCard wide title="Sync warnings" description="Things the sync couldn't apply automatically. Dismiss each once you've dealt with it.">
      <ul className="divide-y">
        {warnings.map((w) => (
          <li key={w.id} className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <div>
                <p className="text-sm">{w.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {w.accountLabel} · seen {w.occurrences}× · last <DateTime value={w.lastSeenAt} />
                </p>
              </div>
            </div>
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await resolveSyncWarning(w.id);
                    toast.success("Warning dismissed");
                    onChanged();
                  } catch (err) {
                    toast.error("Couldn't dismiss", { description: errorText(err) });
                  }
                }}
              >
                Dismiss
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}

// --- Cash events ---------------------------------------------------------------------------

function CashEventsCard({ version }: { version: number }) {
  const { canEdit, dataVersion } = useApp();
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [local, setLocal] = useState(0);
  const { data, loading } = useAsync(
    () => getCashEvents({ page: pagination.pageIndex, pageSize: pagination.pageSize, unreviewed: onlyUnreviewed }),
    [pagination.pageIndex, pagination.pageSize, onlyUnreviewed, dataVersion, version, local],
    { keepPreviousData: true },
  );

  const helper = columnHelper<CashEvent>();
  const columns: DataTableColumn<CashEvent>[] = [
    helper.accessor("time", { header: "When", enableSorting: false, cell: (info) => <DateTime value={info.getValue()} className="text-xs" /> }),
    helper.accessor("accountLabel", {
      header: "Account",
      enableSorting: false,
      cell: (info) => (
        <div className="leading-tight">
          <p className="text-sm">{info.getValue()}</p>
          <p className="num text-xs text-muted-foreground">deal #{info.row.original.dealTicket}</p>
        </div>
      ),
    }),
    helper.accessor("kind", { header: "Type", enableSorting: false, cell: (info) => <Pill tone="grey">{CASH_KIND_LABELS[info.getValue()] ?? info.getValue()}</Pill> }),
    helper.accessor("amount", { header: "Amount", enableSorting: false, meta: { align: "right" }, cell: (info) => <ProfitText value={info.getValue()} /> }),
    helper.accessor("comment", { header: "MT5 comment", enableSorting: false, cell: (info) => <span className="text-xs text-muted-foreground">{info.getValue() || "—"}</span> }),
    helper.display({
      id: "review",
      header: "Review",
      meta: { align: "right" },
      cell: (info) => {
        const e = info.row.original;
        if (e.reviewedAt) {
          return (
            <span className="inline-flex items-center gap-1 text-xs text-profit-ink">
              <BadgeCheck className="size-3.5" aria-hidden /> {e.reviewedBy}
            </span>
          );
        }
        if (!canEdit) return <span className="text-xs text-muted-foreground">Pending</span>;
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await reviewCashEvent(e.accountLogin, e.dealTicket);
                toast.success("Marked as reviewed");
                setLocal((v) => v + 1);
              } catch (err) {
                toast.error("Couldn't update", { description: errorText(err) });
              }
            }}
          >
            <Eye aria-hidden /> Reviewed
          </Button>
        );
      },
    }),
  ];

  return (
    <SettingsCard
      wide
      title="Account cash events"
      description="Deposits, withdrawals, credit, bonuses and charges on the MT5 accounts. They are never trading profit and never change client capital automatically — record client deposits on the client's Transactions tab."
    >
      <div className="flex items-center gap-2 border-b px-6 py-3">
        <Checkbox
          id="cash-unreviewed"
          checked={onlyUnreviewed}
          onCheckedChange={(v) => {
            setOnlyUnreviewed(v === true);
            setPagination((p) => ({ ...p, pageIndex: 0 }));
          }}
        />
        <Label htmlFor="cash-unreviewed" className="text-sm font-normal">
          Only show events that need review
        </Label>
      </div>
      {data ? (
        <DataTable
          columns={columns}
          data={data.rows}
          getRowId={(e) => `${e.accountLogin}:${e.dealTicket}`}
          server={{ rowCount: data.total, pagination, onPaginationChange: setPagination, sorting: [], onSortingChange: () => undefined, loading }}
          empty={<EmptyState icon={BadgeCheck} title={onlyUnreviewed ? "Nothing to review" : "No cash events yet"} />}
        />
      ) : (
        <TableSkeleton rows={3} columns={5} />
      )}
    </SettingsCard>
  );
}
