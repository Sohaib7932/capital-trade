import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#1c1a17] text-gold shadow-sm",
        className,
      )}
      aria-hidden
    >
      <TrendingUp className="size-5" strokeWidth={2.5} />
    </span>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className="block text-[15px] font-bold tracking-tight text-foreground">CapitalTrade</span>
        <span className="block text-[10px] font-semibold tracking-[0.12em] text-gold-ink">ADVISOR • XAUUSD</span>
      </span>
    </span>
  );
}
