"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
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
import { toISODate } from "@/lib/dates";
import type { ClientDetail, IBSummary, SplitPercent } from "@/lib/types";
import { createClientSchema, updateClientSchema } from "@/lib/validation";

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
              : "Record a new investor and their initial investment. Only profit is split — never the capital."}
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
        <SelectValue placeholder="Select an IB" />
      </SelectTrigger>
      <SelectContent>
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

type AddInput = z.input<typeof createClientSchema>;
type AddOutput = z.output<typeof createClientSchema>;

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
    resolver: zodResolver(createClientSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      email: "",
      ibId: "",
      investedAmount: "",
      investmentDate: toISODate(new Date()),
      split: { ...defaultSplit },
      notes: "",
    },
  });
  const split = useWatch({ control, name: "split" });

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
        <FormField id="client-ib" label="Introducing broker (IB)" error={errors.ibId?.message}>
          <Controller
            control={control}
            name="ibId"
            render={({ field }) => (
              <IbSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} ibs={ibs} error={errors.ibId?.message} />
            )}
          />
        </FormField>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField id="client-amount" label="Invested amount (USD)" error={errors.investedAmount?.message}>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
              <Input
                id="client-amount"
                inputMode="decimal"
                placeholder="10,000.00"
                className="num pl-6"
                aria-invalid={Boolean(errors.investedAmount)}
                aria-describedby={describedBy("client-amount", errors.investedAmount?.message)}
                {...register("investedAmount")}
              />
            </div>
          </FormField>
          <FormField
            id="client-date"
            label="Effective date"
            error={errors.investmentDate?.message}
            hint="Earns from the next day."
          >
            <Input
              id="client-date"
              type="date"
              className="num"
              aria-invalid={Boolean(errors.investmentDate)}
              aria-describedby={describedBy("client-date", errors.investmentDate?.message, true)}
              {...register("investmentDate")}
            />
          </FormField>
        </div>

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

type EditInput = z.input<typeof updateClientSchema>;
type EditOutput = z.output<typeof updateClientSchema>;

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
    resolver: zodResolver(updateClientSchema),
    defaultValues: {
      fullName: client.fullName,
      phone: client.phone,
      email: client.email,
      ibId: client.ibId ?? "",
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
          <FormField id="client-ib" label="Introducing broker (IB)" error={errors.ibId?.message}>
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
          Capital is never typed in: it comes from deposits and withdrawals on the client&apos;s Transactions tab.
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
