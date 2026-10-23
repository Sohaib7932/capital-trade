import type { Metadata } from "next";
import { Suspense } from "react";
import { ClientDetailView } from "@/components/clients/client-detail-view";
import { PageSkeleton } from "@/components/shared/skeletons";

export const metadata: Metadata = { title: "Client" };

export default function ClientDetailPage() {
  // The client id is only known at request time, so useParams needs a Suspense boundary.
  return (
    <Suspense fallback={<PageSkeleton kpis={3} />}>
      <ClientDetailView />
    </Suspense>
  );
}
