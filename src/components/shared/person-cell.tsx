import { initials } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** Initials avatar + name + code, used as the first column of people tables. */
export function PersonCell({ name, code, muted = false }: { name: string; code: string; muted?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          muted ? "bg-muted text-muted-foreground" : "bg-gold-soft text-gold-ink",
        )}
        aria-hidden
      >
        {initials(name)}
      </span>
      <div className="leading-tight">
        <p className="font-semibold text-foreground">{name}</p>
        <p className="num mt-0.5 text-xs text-muted-foreground">{code}</p>
      </div>
    </div>
  );
}
