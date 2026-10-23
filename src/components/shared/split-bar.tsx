import { formatPercent } from "@/lib/calculations";
import type { SplitPercent } from "@/lib/types";
import { cn } from "@/lib/utils";

const SEGMENTS = [
  { key: "client", label: "Client", className: "bg-share-client" },
  { key: "trader", label: "Trader", className: "bg-share-trader" },
  { key: "company", label: "Company", className: "bg-share-company" },
] as const;

/** Horizontal bar showing how profit is split between client, trader and company. */
export function SplitBar({ split, className, legend = true }: { split: SplitPercent; className?: string; legend?: boolean }) {
  const description = SEGMENTS.map((s) => `${s.label} ${formatPercent(split[s.key])}`).join(", ");
  return (
    <div className={className}>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Split: ${description}`}>
        {SEGMENTS.map((s) => (
          <div key={s.key} className={cn("h-full", s.className)} style={{ width: `${split[s.key]}%` }} />
        ))}
      </div>
      {legend ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
          {SEGMENTS.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", s.className)} />
              {s.label} <span className="num font-semibold text-foreground">{formatPercent(split[s.key])}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
