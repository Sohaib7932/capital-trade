import { formatCurrency, signOf, type DecimalInput } from "@/lib/calculations";
import { cn } from "@/lib/utils";

interface ProfitTextProps {
  value: DecimalInput;
  /** Show "+" on positive values (default true). */
  signed?: boolean;
  className?: string;
}

/** Money coloured by sign: green with "+" for profit, red with "−" for loss. */
export function ProfitText({ value, signed = true, className }: ProfitTextProps) {
  const sign = signOf(value);
  return (
    <span
      className={cn(
        "num font-semibold",
        sign > 0 && "text-profit-ink",
        sign < 0 && "text-loss",
        sign === 0 && "text-muted-foreground",
        className,
      )}
    >
      {formatCurrency(value, { signed })}
    </span>
  );
}
