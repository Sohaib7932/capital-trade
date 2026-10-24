import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/skeletons";
import { TradesView } from "@/components/trades/trades-view";

export const metadata: Metadata = { title: "Trades" };

export default function TradesPage() {
  // The view reads filters from the URL, which needs a Suspense boundary.
  return (
    <Suspense fallback={<PageSkeleton kpis={5} />}>
      <TradesView />
    </Suspense>
  );
}
