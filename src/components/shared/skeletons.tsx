import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function KpiGridSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", className)} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="gap-3 px-5 py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-3 w-28" />
        </Card>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div aria-hidden>
      <div className="flex gap-4 border-b bg-muted/40 px-5 py-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b px-5 py-4 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-4 flex-1", c === 0 && "flex-[1.5]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-72 items-end gap-2 px-2", className)} aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <Skeleton key={i} className="flex-1" style={{ height: `${25 + ((i * 37) % 70)}%` }} />
      ))}
    </div>
  );
}

/** Generic page placeholder: header, KPI row and a table card. */
export function PageSkeleton({ kpis = 4 }: { kpis?: number }) {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      {kpis > 0 ? <KpiGridSkeleton count={kpis} /> : null}
      <Card className="py-0">
        <TableSkeleton />
      </Card>
    </div>
  );
}
