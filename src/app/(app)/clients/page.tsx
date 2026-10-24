import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/skeletons";
import { ClientsView } from "@/components/clients/clients-view";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage() {
  // The view reads filters from the URL, which needs a Suspense boundary.
  return (
    <Suspense fallback={<PageSkeleton kpis={0} />}>
      <ClientsView />
    </Suspense>
  );
}
