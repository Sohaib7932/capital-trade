import type { Metadata } from "next";
import { IBsView } from "@/components/ibs/ibs-view";

export const metadata: Metadata = { title: "IBs" };

export default function IBsPage() {
  return <IBsView />;
}
