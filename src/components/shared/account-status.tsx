"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { formatRelative } from "@/lib/dates";
import { syncErrorText, syncHealth } from "@/lib/mt5";
import type { ISODateTime, Mt5SyncState, SyncHealth } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Pill } from "./status-badge";

type Tone = "green" | "amber" | "red" | "grey";

const HEALTH_TONE: Record<SyncHealth, Tone> = { green: "green", amber: "amber", red: "red", none: "grey" };
const DOT: Record<Tone, string> = { green: "bg-profit", amber: "bg-amber-500", red: "bg-loss", grey: "bg-slate-400" };

interface StatusInput {
  syncState: Mt5SyncState;
  health: SyncHealth;
  lastSyncAt: ISODateTime | null;
  lastErrorKind?: "auth" | "other" | null;
  lastError?: string | null;
}

/** One label + tone for an account's sync state; "ok" ages with the clock. */
function describe(a: StatusInput, now: Date | null): { tone: Tone; label: string } {
  switch (a.syncState) {
    case "paused":
      return { tone: "grey", label: "Paused" };
    case "no_password":
      return { tone: "amber", label: "No investor password" };
    case "waiting":
      return { tone: "grey", label: "Waiting for first sync" };
    case "error":
      return { tone: "red", label: syncErrorText(a.lastErrorKind ?? null, a.lastError ?? null) };
    default: {
      const health = now ? syncHealth(a.lastSyncAt, null, now) : a.health;
      const tone = HEALTH_TONE[health];
      const ago = a.lastSyncAt && now ? ` · ${formatRelative(a.lastSyncAt, now)}` : "";
      return { tone, label: `${tone === "green" ? "Synced" : tone === "amber" ? "Delayed" : "Out of sync"}${ago}` };
    }
  }
}

/** Status pill for an MT5 account (client page, settings). */
export function AccountStatus({ className, ...account }: StatusInput & { className?: string }) {
  const now = useNow(30_000);
  const { tone, label } = describe(account, now);
  return (
    <Pill tone={tone} dot className={cn("max-w-full truncate", className)}>
      {label}
    </Pill>
  );
}

/** A small coloured dot for tables, with the status on hover. */
export function SyncDot({ health, label }: { health: SyncHealth; label?: string }) {
  const tone = HEALTH_TONE[health];
  const text = label ?? (health === "none" ? "Not synced yet" : health === "green" ? "Synced" : health === "amber" ? "Delayed" : "Out of sync or failing");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex size-4 items-center justify-center" aria-label={text}>
          <span className={cn("size-2.5 rounded-full", DOT[tone])} aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
