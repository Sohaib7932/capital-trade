import { CloudOff, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shown in place of a section whose data couldn't be loaded, instead of an endless skeleton. */
export function LoadError({ error, onRetry, className }: { error: Error; onRetry: () => void; className?: string }) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border bg-card px-6 py-10 text-center", className)}
    >
      <div className="flex size-11 items-center justify-center rounded-xl border bg-loss-soft text-loss">
        <CloudOff className="size-5" aria-hidden />
      </div>
      <div>
        <p className="text-sm font-semibold">Couldn&apos;t load this</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{error.message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw aria-hidden /> Try again
      </Button>
    </div>
  );
}
