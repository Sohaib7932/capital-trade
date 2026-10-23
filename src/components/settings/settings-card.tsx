import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Titled card used by every Settings section. */
export function SettingsCard({
  title,
  description,
  children,
  wide,
}: {
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Card className={wide ? "gap-0 py-0" : "max-w-2xl gap-0 py-0"}>
      <div className="border-b px-6 py-4">
        <h2 className="text-base font-bold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </Card>
  );
}
