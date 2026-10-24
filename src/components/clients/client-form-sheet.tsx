"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { describedBy, FormField } from "@/components/shared/form-field";
import { SplitFields } from "@/components/shared/split-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAsync } from "@/hooks/use-async";
import { createClient, getIBs, getSettings, updateClient } from "@/lib/api";
import type { ClientDetail, IBSummary, SplitPercent } from "@/lib/types";
import { createClientSchema, MT5_SERVERS, updateClientSchema } from "@/lib/validation";

interface ClientFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (client: ClientDetail) => void;
  /** Edit this client; omit to add a new one. */
  client?: ClientDetail;
}

export function ClientFormSheet({ open, onOpenChange, onSaved, client }: ClientFormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="text-lg font-bold">{client ? `Edit ${client.fullName}` : "Add client"}</SheetTitle>
          <SheetDescription>
            {client
              ? "Split changes apply to open months. Finalized months keep the split they were locked with."
              : "Add the investor and their EC Markets MT5 account(s). Capital, balance and history fill in after the first sync."}
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <ClientFormLoader
            client={client}
            onCancel={() => onOpenChange(false)}
            onSaved={(saved) => {
              onOpenChange(false);
              onSaved?.(saved);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

interface LoaderProps {
  client?: ClientDetail;
  onCancel: () => void;
  onSaved: (client: ClientDetail) => void;
}

function ClientFormLoader({ client, onCancel, onSaved }: LoaderProps) {
  const { data, error } = useAsync(() => Promise.all([getIBs(), getSettings()]), []);
  if (error) {
    return <p className="p-6 text-sm text-destructive">Couldn&apos;t load IBs: {error.message}</p>;
  }
  if (!data) {
    return (
      <div className="space-y-5 p-6" role="status" aria-label="Loading form">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }
  const [ibs, settings] = data;
  // Keep the client's current IB selectable even if it has since been deactivated.
  const options = ibs.filter((ib) => ib.status === "active" || ib.id === client?.ibId);
  return client ? (
    <EditClientForm client={client} ibs={options} onCancel={onCancel} onSaved={onSaved} />
  ) : (
    <AddClientForm ibs={options} defaultSplit={settings.defaultSplit} onCancel={onCancel} onSaved={onSaved} />
  );
}

/** Select value standing for "no IB" (a Direct client of the company). */
const DIRECT = "direct";
const sourceField = z.string().transform((v) => (v === DIRECT ? null : v));

function IbSelect({ value, onChange, onBlur, ibs, error }: { value: string; onChange: (v: string) => void; onBlur: () => void; ibs: IBSummary[]; error?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id="client-ib"
        className="w-full"
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy("client-ib", error)}
        onBlur={onBlur}
      >
        <SelectValue placeholder="Direct or an IB" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DIRECT}>Direct (company client)</SelectItem>
        {ibs.map((ib) => (
          <SelectItem key={ib.id} value={ib.id}>
            {ib.name} <span className="num text-muted-foreground">({ib.code})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function errorText(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

// --- Add ------------------------------------------------------------------------

const addFormSchema = createClientSchema.extend({ ibId: sourceField });
type AddInput = z.input<typeof addFormSchema>;
type AddOutput = z.output<typeof addFormSchema>;
const NEW_ACCOUNT = { login: Number.NaN, server: MT5_SERVERS[0] as string, investorPassword: "" };

function AddClientForm({
  ibs,
  defaultSplit,
  onCancel,
  onSaved,
}: {
  ibs: IBSummary[];
  defaultSplit: SplitPercent;
  onCancel: () => void;
  onSaved: (client: ClientDetail) => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddInput, unknown, AddOutput>({
    resolver: zodResolver(addFormSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      email: "",
      ibId: DIRECT,
      split: { ...defaultSplit },
      notes: "",
      accounts: [{ ...NEW_ACCOUNT }],
    },
  });
  const split = useWatch({ control, name: "split" });
  const accounts = useFieldArray({ control, name: "accounts" });

  async function onSubmit(values: AddOutput) {
    try {
      const client = await createClient(values);
      toast.success(`${client.fullName} added`, { description: `Client ${client.code} was created.` });
      onSaved(client);
    } catch (err) {
      toast.error("Couldn't add client", { description: errorText(err) });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <ContactFields register={register} errors={errors} />
        <FormField id="client-ib" label="Source" error={errors.ibId?.message} hint="Direct, or the IB who introduced this client.">
          <Controller
            control={control}
            name="ibId"
            render={({ field }) => (
              <IbSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} ibs={ibs} error={errors.ibId?.message} />
            )}
          />
        </FormField>

        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold">MT5 accounts</legend>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Use the account&apos;s investor (read-only) password. It is encrypted as soon as you save and can&apos;t be shown again.
          </p>
          <datalist id="mt5-servers">
            {MT5_SERVERS.map((server) => (
              <option key={server} value={server} />
            ))}
          </datalist>
          {accounts.fields.map((field, i) => {
            const e = errors.accounts?.[i];
            return (
              <div key={field.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground">Account {i + 1}</p>
                  {accounts.fields.length > 1 ? (
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove account ${i + 1}`} onClick={() => accounts.remove(i)}>
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField id={`acc-${i}-login`} label="Login" error={e?.login?.message}>
                    <Input
                      id={`acc-${i}-login`}
                      inputMode="numeric"
                      className="num"
                      autoComplete="off"
                      aria-invalid={Boolean(e?.login)}
                      aria-describedby={describedBy(`acc-${i}-login`, e?.login?.message)}
                      {...register(`accounts.${i}.login`, { valueAsNumber: true })}
                    />
                  </FormField>
                  <FormField id={`acc-${i}-server`} label="Server" error={e?.server?.message}>
                    <Input
                      id={`acc-${i}-server`}
                      list="mt5-servers"
                      autoComplete="off"
                      aria-invalid={Boolean(e?.server)}
                      aria-describedby={describedBy(`acc-${i}-server`, e?.server?.message)}
                      {...register(`accounts.${i}.server`)}
                    />
                  </FormField>
                </div>
                <FormField id={`acc-${i}-password`} label="Investor password" error={e?.investorPassword?.message}>
                  <Input
                    id={`acc-${i}-password`}
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={Boolean(e?.investorPassword)}
                    aria-describedby={describedBy(`acc-${i}-password`, e?.investorPassword?.message)}
                    {...register(`accounts.${i}.investorPassword`)}
                  />
                </FormField>
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" onClick={() => accounts.append({ ...NEW_ACCOUNT })}>
            <Plus aria-hidden /> Add another account
          </Button>
        </fieldset>

        <div className="rounded-xl border bg-muted/30 p-4">
          <SplitFields
            idPrefix="client-split"
            values={split}
            errors={errors.split}
            fields={{
              trader: register("split.trader", { valueAsNumber: true }),
              company: register("split.company", { valueAsNumber: true }),
              client: register("split.client", { valueAsNumber: true }),
            }}
          />
        </div>

        <FormField id="client-notes" label="Notes (optional)" error={errors.notes?.message}>
          <Textarea id="client-notes" rows={3} {...register("notes")} />
        </FormField>
      </div>
      <FormFooter onCancel={onCancel} submitting={isSubmitting} label="Add client" />
    </form>
  );
}

// --- Edit -----------------------------------------------------------------------

const editFormSchema = updateClientSchema.extend({ ibId: sourceField });
type EditInput = z.input<typeof editFormSchema>;
type EditOutput = z.output<typeof editFormSchema>;

function EditClientForm({
  client,
  ibs,
  onCancel,
  onSaved,
}: {
  client: ClientDetail;
  ibs: IBSummary[];
  onCancel: () => void;
  onSaved: (client: ClientDetail) => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<EditInput, unknown, EditOutput>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      fullName: client.fullName,
      phone: client.phone,
      email: client.email,
      ibId: client.ibId ?? DIRECT,
      status: client.status,
      split: { ...client.split },
      notes: client.notes ?? "",
    },
  });
  const split = useWatch({ control, name: "split" });

  async function onSubmit(values: EditOutput) {
    try {
      const saved = await updateClient(client.id, values);
      toast.success("Client updated");
      onSaved(saved);
    } catch (err) {
      toast.error("Couldn't update client", { description: errorText(err) });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <ContactFields register={register} errors={errors} />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField id="client-ib" label="Source" error={errors.ibId?.message}>
            <Controller
              control={control}
              name="ibId"
              render={({ field }) => (
                <IbSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} ibs={ibs} error={errors.ibId?.message} />
              )}
            />
          </FormField>
          <FormField id="client-status" label="Status">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="client-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
        </div>
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Capital is never typed in: it comes from the deposits and withdrawals on the client&apos;s MT5 accounts. Manage
          accounts and passwords on the client&apos;s page.
        </p>
        <div className="rounded-xl border bg-muted/30 p-4">
          <SplitFields
            idPrefix="client-split"
            values={split}
            errors={errors.split}
            fields={{
              trader: register("split.trader", { valueAsNumber: true }),
              company: register("split.company", { valueAsNumber: true }),
              client: register("split.client", { valueAsNumber: true }),
            }}
          />
        </div>
        <FormField id="client-notes" label="Notes (optional)" error={errors.notes?.message}>
          <Textarea id="client-notes" rows={3} {...register("notes")} />
        </FormField>
      </div>
      <FormFooter onCancel={onCancel} submitting={isSubmitting} label="Save changes" disabled={!isDirty} />
    </form>
  );
}

// --- Shared pieces --------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- shared between the add and edit form types */
function ContactFields({ register, errors }: { register: any; errors: any }) {
  return (
    <>
      <FormField id="client-name" label="Full name" error={errors.fullName?.message}>
        <Input
          id="client-name"
          autoComplete="name"
          aria-invalid={Boolean(errors.fullName)}
          aria-describedby={describedBy("client-name", errors.fullName?.message)}
          {...register("fullName")}
        />
      </FormField>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField id="client-phone" label="Phone" error={errors.phone?.message}>
          <Input
            id="client-phone"
            type="tel"
            autoComplete="tel"
            placeholder="+1 555 010 2000"
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={describedBy("client-phone", errors.phone?.message)}
            {...register("phone")}
          />
        </FormField>
        <FormField id="client-email" label="Email" error={errors.email?.message}>
          <Input
            id="client-email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy("client-email", errors.email?.message)}
            {...register("email")}
          />
        </FormField>
      </div>
    </>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function FormFooter({ onCancel, submitting, label, disabled }: { onCancel: () => void; submitting: boolean; label: string; disabled?: boolean }) {
  return (
    <SheetFooter className="flex-row justify-end gap-2 border-t px-6 py-4">
      <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
        Cancel
      </Button>
      <Button type="submit" disabled={submitting || disabled} className="font-semibold">
        {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {label}
      </Button>
    </SheetFooter>
  );
}
