"use client";

import { useNow } from "@/hooks/use-now";
import { formatRelative } from "@/lib/dates";
import { syncHealth } from "@/lib/mt5";
import type { ISODateTime, SyncHealth } from "@/lib/types";
import { cn } from "@/lib/utils";

const RANK: Record<SyncHealth, number> = { none: 0, green: 1, amber: 2, red: 3 };

const STYLE: Record<SyncHealth, { pill: string; dot: string }> = {
  green: { pill: "border-profit/25 bg-profit-soft text-profit-ink", dot: "bg-profit" },
  amber: { pill: "border-amber-300/60 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  red: { pill: "border-loss/25 bg-loss-soft text-loss", dot: "bg-loss" },
  none: { pill: "border-border bg-muted text-muted-foreground", dot: "bg-slate-400" },
};

/**
 * MT5 sync freshness. `health` comes from the server (it knows about failed
 * syncs); the age is re-checked every minute so the pill ages without a reload.
 */
export function SyncPill({
  health,
  lastSyncAt,
  className,
  prefix = "MT5",
}: {
  health: SyncHealth;
  lastSyncAt: ISODateTime | null;
  className?: string;
  prefix?: string;
}) {
  const now = useNow(30_000);
  const aged = now && health !== "none" ? syncHealth(lastSyncAt, null, now) : health;
  const shown: SyncHealth = RANK[aged] > RANK[health] ? aged : health;
  const label =
    shown === "none"
      ? `${prefix} not connected`
      : `${prefix} ${shown === "green" ? "Synced" : shown === "amber" ? "Delayed" : "Out of sync"}${
          lastSyncAt && now ? ` • ${formatRelative(lastSyncAt, now)}` : ""
        }`;
  return (
    <span
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold whitespace-nowrap", STYLE[shown].pill, className)}
      title={lastSyncAt ? `Last successful sync ${lastSyncAt} (UTC)` : "No successful sync yet"}
    >
      <span className={cn("size-1.5 rounded-full", STYLE[shown].dot)} aria-hidden />
      {label}
    </span>
  );
}
