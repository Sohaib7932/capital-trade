"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { describedBy, FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addTransaction, updateTransaction } from "@/lib/api";
import { toISODate } from "@/lib/dates";
import type { ClientDetail, Transaction } from "@/lib/types";
import { transactionSchema } from "@/lib/validation";

type FormInput = z.input<typeof transactionSchema>;
type FormOutput = z.output<typeof transactionSchema>;

interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  /** Edit this transaction; omit to add one. */
  transaction?: Transaction;
  onSaved: (client: ClientDetail) => void;
}

export function TransactionDialog({ open, onOpenChange, clientId, transaction, onSaved }: TransactionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{transaction ? "Edit transaction" : "Add deposit or withdrawal"}</DialogTitle>
          <DialogDescription>
            A deposit earns from the day after its effective date; a withdrawal stops earning on its effective date.
            Only dates in open months can be used.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <TransactionForm
            clientId={clientId}
            transaction={transaction}
            onCancel={() => onOpenChange(false)}
            onSaved={(client) => {
              onOpenChange(false);
              onSaved(client);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({
  clientId,
  transaction,
  onCancel,
  onSaved,
}: {
  clientId: string;
  transaction?: Transaction;
  onCancel: () => void;
  onSaved: (client: ClientDetail) => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(transactionSchema),
    defaultValues: transaction
      ? { type: transaction.type, amount: transaction.amount, date: transaction.date, note: transaction.note ?? "" }
      : { type: "deposit", amount: "", date: toISODate(new Date()), note: "" },
  });

  async function onSubmit(values: FormOutput) {
    try {
      const client = transaction
        ? await updateTransaction(transaction.id, values)
        : await addTransaction(clientId, values);
      toast.success(transaction ? "Transaction updated" : `${values.type === "deposit" ? "Deposit" : "Withdrawal"} recorded`, {
        description: "Open months were recalculated.",
      });
      onSaved(client);
    } catch (err) {
      toast.error("Couldn't save transaction", { description: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField id="txn-type" label="Type">
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="txn-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deposit">Deposit</SelectItem>
                  <SelectItem value="withdrawal">Withdrawal</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField id="txn-date" label="Effective date" error={errors.date?.message}>
          <Input
            id="txn-date"
            type="date"
            className="num"
            aria-invalid={Boolean(errors.date)}
            aria-describedby={describedBy("txn-date", errors.date?.message)}
            {...register("date")}
          />
        </FormField>
      </div>
      <FormField id="txn-amount" label="Amount (USD)" error={errors.amount?.message}>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
          <Input
            id="txn-amount"
            inputMode="decimal"
            className="num pl-6"
            placeholder="5,000.00"
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={describedBy("txn-amount", errors.amount?.message)}
            {...register("amount")}
          />
        </div>
      </FormField>
      <FormField id="txn-note" label="Note (optional)" error={errors.note?.message}>
        <Textarea id="txn-note" rows={2} {...register("note")} />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="font-semibold">
          {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {transaction ? "Save changes" : "Record"}
        </Button>
      </DialogFooter>
    </form>
  );
}
