import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsView } from "@/components/settings/settings-view";
import { PageSkeleton } from "@/components/shared/skeletons";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  // The view reads ?tab= from the URL, which needs a Suspense boundary.
  return (
    <Suspense fallback={<PageSkeleton kpis={0} />}>
      <SettingsView />
    </Suspense>
  );
}
