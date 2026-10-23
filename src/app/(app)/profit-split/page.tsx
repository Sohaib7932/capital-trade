import type { Metadata } from "next";
import { ProfitSplitView } from "@/components/profit-split/profit-split-view";

export const metadata: Metadata = { title: "Profit Split" };

export default function ProfitSplitPage() {
  return <ProfitSplitView />;
}
