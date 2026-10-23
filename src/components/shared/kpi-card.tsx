import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Small pill in the top-right corner, e.g. a % change. */
  badge?: ReactNode;
  /** Unit shown next to the value, e.g. "lots". */
  unit?: string;
  /** Secondary line under the value. */
  footer?: ReactNode;
  icon?: ReactNode;
  valueClassName?: string;
  className?: string;
}

/** Small uppercase label on top, large monospace value below. */
export function KpiCard({ label, value, badge, unit, footer, icon, valueClassName, className }: KpiCardProps) {
  return (
    <Card className={cn("gap-0 px-5 py-4", className)}>
      <div className="flex min-h-6 items-start justify-between gap-2">
        <p className="eyebrow flex items-center gap-1.5">
          {icon}
          {label}
        </p>
        {badge}
      </div>
      <p className={cn("num mt-2 flex items-baseline gap-1.5 text-2xl font-bold tracking-tight text-foreground", valueClassName)}>
        {value}
        {unit ? <span className="font-sans text-sm font-medium tracking-normal text-muted-foreground">{unit}</span> : null}
      </p>
      {footer ? <div className="mt-3 text-xs text-muted-foreground">{footer}</div> : null}
    </Card>
  );
}
