"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, Pause, Play, Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useApp } from "@/components/layout/app-context";
import { AccountStatus } from "@/components/shared/account-status";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { describedBy, FormField } from "@/components/shared/form-field";
import { ProfitText } from "@/components/shared/profit-text";
import { Pill } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addClientAccount, deleteMt5Account, replaceAccountPassword, updateMt5Account } from "@/lib/api";
import { formatCurrency } from "@/lib/calculations";
import type { ClientDetail, Mt5Account } from "@/lib/types";
import { clientAccountSchema, investorPasswordSchema, MT5_SERVERS } from "@/lib/validation";

const errorText = (err: unknown) => (err instanceof Error ? err.message : undefined);

/** The client's own MT5 accounts: status, live numbers, and password/sync controls. */
export function ClientAccounts({ client, onChanged }: { client: ClientDetail; onChanged: () => void }) {
  const { canEdit } = useApp();
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState<Mt5Account | null>(null);
  const [removing, setRemoving] = useState<Mt5Account | null>(null);

  async function setActive(account: Mt5Account, isActive: boolean) {
    try {
      await updateMt5Account(account.id, {
        label: account.label,
        login: account.login,
        server: account.server,
        brokerTimezoneOffsetMinutes: account.brokerTimezoneOffsetMinutes,
        isActive,
        linkedClientId: account.linkedClientId,
      });
      toast.success(isActive ? "Syncing resumed" : "Syncing paused", {
        description: isActive ? undefined : "History is kept; the account no longer counts until resumed.",
      });
      onChanged();
    } catch (err) {
      toast.error("Couldn't update the account", { description: errorText(err) });
    }
  }

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold">MT5 accounts</h2>
          <p className="text-xs text-muted-foreground">
            Read with the investor password. All of these accounts&apos; trading profit belongs to {client.fullName}.
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add account
          </Button>
        ) : null}
      </div>
      {client.accountDetails.length === 0 ? (
        <EmptyState icon={Server} title="No MT5 account yet" description="Add the client's EC Markets login and investor password." />
      ) : (
        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
          {client.accountDetails.map((a) => (
            <div key={a.id} className="space-y-4 rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="num text-base font-bold">{a.login}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.server}
                    {a.currency ? ` · ${a.currency}` : ""}
                    {a.leverage ? ` · 1:${a.leverage}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={a.environment === "live" ? "gold" : "blue"}>{a.environment === "live" ? "Live" : "Demo"}</Pill>
                  <AccountStatus
                    syncState={a.syncState}
                    health={a.health}
                    lastSyncAt={a.lastSyncAt}
                    lastErrorKind={a.lastErrorKind}
                    lastError={a.lastError}
                  />
                </div>
              </div>
              {a.syncState === "error" && a.lastErrorKind !== "auth" && a.lastError ? (
                <p className="rounded-lg bg-loss-soft px-3 py-2 text-xs text-loss">{a.lastError}</p>
              ) : null}
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Figure label="Balance" value={a.balance} />
                <Figure label="Equity" value={a.equity} />
                <div>
                  <dt className="eyebrow">Floating P/L</dt>
                  <dd className="mt-0.5">{a.floatingPl !== null ? <ProfitText value={a.floatingPl} /> : "—"}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Open positions</dt>
                  <dd className="num mt-0.5 font-semibold">{a.openPositions}</dd>
                </div>
              </dl>
              {canEdit ? (
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Pill tone="grey" className="mr-auto">
                    <KeyRound className="size-3" aria-hidden /> {a.passwordSet ? "•••• set" : "No password"}
                  </Pill>
                  <Button size="sm" variant="outline" onClick={() => setPassword(a)}>
                    <KeyRound aria-hidden /> {a.passwordSet ? "Replace password" : "Set password"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setActive(a, !a.isActive)}>
                    {a.isActive ? <Pause aria-hidden /> : <Play aria-hidden />} {a.isActive ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-loss hover:text-loss"
                    onClick={() => setRemoving(a)}
                    aria-label={`Remove account ${a.login}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <AddAccountDialog open={adding} onOpenChange={setAdding} clientId={client.id} onSaved={onChanged} />
      <PasswordDialog account={password} onClose={() => setPassword(null)} onSaved={onChanged} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this MT5 account?"
        description={
          removing ? (
            <>
              Account <strong className="num text-foreground">{removing.login}</strong> stops syncing and is removed. An account
              that already has trades can&apos;t be removed (its history belongs to the client) — pause it instead.
            </>
          ) : null
        }
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteMt5Account(removing.id);
            toast.success("Account removed");
            onChanged();
          } catch (err) {
            toast.error("Couldn't remove the account", { description: errorText(err) });
            throw err;
          }
        }}
      />
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-0.5 font-semibold">{value !== null ? formatCurrency(value) : "—"}</dd>
    </div>
  );
}

type AccountInput = z.input<typeof clientAccountSchema>;
type AccountOutput = z.output<typeof clientAccountSchema>;

function AddAccountDialog({
  open,
  onOpenChange,
  clientId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AccountInput, unknown, AccountOutput>({
    resolver: zodResolver(clientAccountSchema),
    defaultValues: { login: Number.NaN, server: MT5_SERVERS[0], investorPassword: "" },
  });

  async function onSubmit(values: AccountOutput) {
    try {
      await addClientAccount(clientId, values);
      toast.success(`Account ${values.login} added`, { description: "It shows “Waiting for first sync” until the worker reads it." });
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error("Couldn't add the account", { description: errorText(err) });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add MT5 account</DialogTitle>
          <DialogDescription>The investor (read-only) password is encrypted as soon as you save and can&apos;t be shown again.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <datalist id="add-account-servers">
            {MT5_SERVERS.map((server) => (
              <option key={server} value={server} />
            ))}
          </datalist>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="add-login" label="Login" error={errors.login?.message}>
              <Input
                id="add-login"
                inputMode="numeric"
                className="num"
                autoComplete="off"
                aria-invalid={Boolean(errors.login)}
                aria-describedby={describedBy("add-login", errors.login?.message)}
                {...register("login", { valueAsNumber: true })}
              />
            </FormField>
            <FormField id="add-server" label="Server" error={errors.server?.message}>
              <Input
                id="add-server"
                list="add-account-servers"
                autoComplete="off"
                aria-invalid={Boolean(errors.server)}
                aria-describedby={describedBy("add-server", errors.server?.message)}
                {...register("server")}
              />
            </FormField>
          </div>
          <FormField id="add-password" label="Investor password" error={errors.investorPassword?.message}>
            <Input
              id="add-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.investorPassword)}
              aria-describedby={describedBy("add-password", errors.investorPassword?.message)}
              {...register("investorPassword")}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="font-semibold">
              {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Add account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const passwordForm = z.object({ investorPassword: investorPasswordSchema });

function PasswordDialog({ account, onClose, onSaved }: { account: Mt5Account | null; onClose: () => void; onSaved: () => void }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof passwordForm>>({ resolver: zodResolver(passwordForm), defaultValues: { investorPassword: "" } });

  async function onSubmit(values: z.infer<typeof passwordForm>) {
    if (!account) return;
    try {
      await replaceAccountPassword(account.id, values.investorPassword);
      toast.success("Investor password saved", { description: "The next sync uses it." });
      reset();
      onClose();
      onSaved();
    } catch (err) {
      toast.error("Couldn't save the password", { description: errorText(err) });
    }
  }

  return (
    <Dialog
      open={account !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account?.passwordSet ? "Replace" : "Set"} investor password</DialogTitle>
          <DialogDescription>
            Account <span className="num">{account?.login}</span> @ {account?.server}. The password is encrypted on save and never shown
            again.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <FormField id="replace-password" label="Investor password" error={errors.investorPassword?.message}>
            <Input
              id="replace-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.investorPassword)}
              aria-describedby={describedBy("replace-password", errors.investorPassword?.message)}
              {...register("investorPassword")}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="font-semibold">
              {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
