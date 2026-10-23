"use client";

import type { UseFormRegisterReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { splitTotal } from "@/lib/calculations";
import type { SplitPercent } from "@/lib/types";
import { cn } from "@/lib/utils";

const PARTS = [
  { key: "trader", label: "Trader", dot: "bg-share-trader" },
  { key: "company", label: "Company", dot: "bg-share-company" },
  { key: "client", label: "Client", dot: "bg-share-client" },
] as const;

interface SplitFieldsProps {
  idPrefix: string;
  fields: Record<keyof SplitPercent, UseFormRegisterReturn>;
  /** Current values, for the live total. */
  values: Partial<SplitPercent> | undefined;
  errors?: Partial<Record<keyof SplitPercent | "total", { message?: string }>>;
}

/** Three percentage inputs with a live total that must reach 100%. */
export function SplitFields({ idPrefix, fields, values, errors }: SplitFieldsProps) {
  const safe = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  const total = splitTotal({
    trader: safe(values?.trader),
    company: safe(values?.company),
    client: safe(values?.client),
  });
  const ok = total.equals(100);
  const totalError = errors?.total?.message;

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-xs font-semibold text-foreground">Profit split (%)</legend>
      <div className="grid grid-cols-3 gap-3">
        {PARTS.map((part) => {
          const id = `${idPrefix}-${part.key}`;
          const error = errors?.[part.key]?.message;
          return (
            <div key={part.key} className="grid gap-1.5">
              <label htmlFor={id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("size-2 rounded-full", part.dot)} aria-hidden />
                {part.label}
              </label>
              <div className="relative">
                <Input
                  id={id}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  max={100}
                  className="num pr-7"
                  aria-invalid={Boolean(error || totalError)}
                  aria-describedby={`${idPrefix}-total`}
                  {...fields[part.key]}
                />
                <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
                  %
                </span>
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </div>
          );
        })}
      </div>
      <p
        id={`${idPrefix}-total`}
        className={cn("text-xs", ok ? "text-muted-foreground" : "font-medium text-destructive")}
        aria-live="polite"
      >
        Total: <span className="num font-semibold">{total.toString()}%</span>
        {ok ? " — splits only the net profit, never the invested capital." : ` — ${totalError ?? "must equal 100%"}`}
      </p>
    </fieldset>
  );
}
