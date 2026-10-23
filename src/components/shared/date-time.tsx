"use client";

import { useApp } from "@/components/layout/app-context";
import { formatDateTimeIn } from "@/lib/dates";
import type { ISODateTime } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A UTC timestamp shown in the business timezone (Settings → Profit Split). */
export function DateTime({ value, className }: { value: ISODateTime; className?: string }) {
  const { timeZone } = useApp();
  return (
    <time dateTime={value} title={`${value} (UTC)`} className={cn("num", className)}>
      {formatDateTimeIn(value, timeZone)}
    </time>
  );
}
