import type { Metadata } from "next";
import { Suspense } from "react";
import { IBDetailView } from "@/components/ibs/ib-detail-view";
import { PageSkeleton } from "@/components/shared/skeletons";

export const metadata: Metadata = { title: "IB" };

export default function IBDetailPage() {
  // The IB id is only known at request time, so useParams needs a Suspense boundary.
  return (
    <Suspense fallback={<PageSkeleton kpis={4} />}>
      <IBDetailView />
    </Suspense>
  );
}
