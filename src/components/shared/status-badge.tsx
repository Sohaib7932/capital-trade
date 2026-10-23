import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TradeType } from "@/lib/types";

type Tone = "green" | "amber" | "grey" | "gold" | "red" | "blue";

const TONES: Record<Tone, string> = {
  green: "border-profit/25 bg-profit-soft text-profit-ink",
  amber: "border-amber-300/60 bg-amber-50 text-amber-800",
  grey: "border-border bg-muted text-muted-foreground",
  gold: "border-gold/30 bg-gold-soft text-gold-ink",
  red: "border-loss/25 bg-loss-soft text-loss",
  blue: "border-sky-300/60 bg-sky-50 text-sky-800",
};

const DOTS: Record<Tone, string> = {
  green: "bg-profit",
  amber: "bg-amber-500",
  grey: "bg-slate-400",
  gold: "bg-gold",
  red: "bg-loss",
  blue: "bg-sky-500",
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "green" },
  inactive: { label: "Inactive", tone: "grey" },
  pending: { label: "Pending", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
  open: { label: "Open", tone: "gold" },
  finalized: { label: "Finalized", tone: "grey" },
  connected: { label: "Connected", tone: "green" },
  disconnected: { label: "Disconnected", tone: "red" },
};

export type StatusKind = keyof typeof STATUS;

interface PillProps {
  tone: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}

/** Small rounded pill. Base for every status-like label in the app. */
export function Pill({ tone, children, dot = false, className }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", DOTS[tone])} aria-hidden /> : null}
      {children}
    </span>
  );
}

interface StatusBadgeProps {
  status: StatusKind;
  /** Optional suffix, e.g. a paid date. */
  detail?: string;
  className?: string;
}

export function StatusBadge({ status, detail, className }: StatusBadgeProps) {
  const { label, tone } = STATUS[status] ?? { label: status, tone: "grey" as const };
  return (
    <Pill tone={tone} dot className={className}>
      {label}
      {detail ? <span className="num font-medium opacity-80">{detail}</span> : null}
    </Pill>
  );
}

export function TradeTypeBadge({ type }: { type: TradeType }) {
  const buy = type === "buy";
  const Icon = buy ? ArrowUpRight : ArrowDownRight;
  return (
    <Pill tone={buy ? "green" : "red"} className="h-6 rounded-md px-2 text-[11px] tracking-wide uppercase">
      <Icon className="size-3" aria-hidden />
      {buy ? "Buy" : "Sell"}
    </Pill>
  );
}
