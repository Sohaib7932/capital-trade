"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { describedBy, FormField } from "@/components/shared/form-field";
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
import { Textarea } from "@/components/ui/textarea";
import { createIB, updateIB } from "@/lib/api";
import type { IB, IBCommissionSource } from "@/lib/types";
import { updateIBSchema } from "@/lib/validation";

export const COMMISSION_SOURCES: { value: IBCommissionSource; label: string; description: string }[] = [
  {
    value: "from_company_share",
    label: "From the company's share",
    description: "Paid out of the company line. Trader and client shares are unchanged.",
  },
  {
    value: "additional",
    label: "Additional (before the split)",
    description: "Taken off the client's profit first; trader, company and client share the cost.",
  },
];

/** "2% of client profit · from company share" */
export function describeCommission(ib: Pick<IB, "commission">): string {
  if (!ib.commission.percent) return "No commission";
  const source = ib.commission.source === "additional" ? "additional" : "from company share";
  return `${ib.commission.percent}% of client profit · ${source}`;
}

type FormInput = z.input<typeof updateIBSchema>;
type FormOutput = z.output<typeof updateIBSchema>;

interface IBFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (ib: IB) => void;
  /** Edit this IB; omit to add one. */
  ib?: IB;
}

export function IBFormSheet({ open, onOpenChange, onSaved, ib }: IBFormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="text-lg font-bold">{ib ? `Edit ${ib.name}` : "Add IB"}</SheetTitle>
          <SheetDescription>
            {ib
              ? "Commission changes apply to open months. Finalized months keep the rule they were locked with."
              : "An introducing broker brings in clients. Every client belongs to one IB."}
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <IBForm
            ib={ib}
            onCancel={() => onOpenChange(false)}
            onSaved={(saved) => {
              onOpenChange(false);
              onSaved(saved);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function IBForm({ ib, onCancel, onSaved }: { ib?: IB; onCancel: () => void; onSaved: (ib: IB) => void }) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(updateIBSchema),
    defaultValues: ib
      ? { name: ib.name, phone: ib.phone, email: ib.email, status: ib.status, commission: { ...ib.commission }, notes: ib.notes ?? "" }
      : { name: "", phone: "", email: "", status: "active", commission: { percent: 0, source: "from_company_share" }, notes: "" },
  });

  async function onSubmit(values: FormOutput) {
    try {
      if (ib) {
        const saved = await updateIB(ib.id, values);
        toast.success("IB updated");
        onSaved(saved);
      } else {
        const saved = await createIB({
          name: values.name,
          phone: values.phone,
          email: values.email,
          commission: values.commission,
          notes: values.notes,
        });
        toast.success(`${saved.name} added`, { description: `IB ${saved.code} was created.` });
        onSaved(saved);
      }
    } catch (err) {
      toast.error(ib ? "Couldn't update IB" : "Couldn't add IB", { description: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <FormField id="ib-name" label="Name or company" error={errors.name?.message}>
          <Input id="ib-name" aria-invalid={Boolean(errors.name)} aria-describedby={describedBy("ib-name", errors.name?.message)} {...register("name")} />
        </FormField>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField id="ib-phone" label="Phone" error={errors.phone?.message}>
            <Input
              id="ib-phone"
              type="tel"
              autoComplete="tel"
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={describedBy("ib-phone", errors.phone?.message)}
              {...register("phone")}
            />
          </FormField>
          <FormField id="ib-email" label="Email" error={errors.email?.message}>
            <Input
              id="ib-email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy("ib-email", errors.email?.message)}
              {...register("email")}
            />
          </FormField>
        </div>

        <fieldset className="space-y-4 rounded-xl border bg-muted/30 p-4">
          <legend className="px-1 text-xs font-semibold">Commission</legend>
          <FormField
            id="ib-percent"
            label="Percent of each client's profit"
            error={errors.commission?.percent?.message}
            hint="Only on profit left after a client recovers earlier losses. 0 = no commission."
          >
            <div className="relative">
              <Input
                id="ib-percent"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                max={100}
                className="num pr-7"
                aria-invalid={Boolean(errors.commission?.percent)}
                aria-describedby={describedBy("ib-percent", errors.commission?.percent?.message, true)}
                {...register("commission.percent", { valueAsNumber: true })}
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">%</span>
            </div>
          </FormField>
          <Controller
            control={control}
            name="commission.source"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Who pays the commission" className="space-y-2">
                {COMMISSION_SOURCES.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer gap-3 rounded-lg border bg-card p-3 has-checked:border-gold has-checked:bg-gold-soft/50"
                  >
                    <input
                      type="radio"
                      name={field.name}
                      value={option.value}
                      checked={field.value === option.value}
                      onChange={() => field.onChange(option.value)}
                      className="mt-0.5 size-4 accent-gold"
                    />
                    <span>
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          />
        </fieldset>

        {ib ? (
          <FormField id="ib-status" label="Status">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="ib-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive (no new clients)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
        ) : null}

        <FormField id="ib-notes" label="Notes (optional)" error={errors.notes?.message}>
          <Textarea id="ib-notes" rows={3} {...register("notes")} />
        </FormField>
      </div>
      <SheetFooter className="flex-row justify-end gap-2 border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || (ib !== undefined && !isDirty)} className="font-semibold">
          {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {ib ? "Save changes" : "Add IB"}
        </Button>
      </SheetFooter>
    </form>
  );
}
