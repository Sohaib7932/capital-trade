"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ClientFormSheet } from "@/components/clients/client-form-sheet";
import { useAsync } from "@/hooks/use-async";
import { getAvailableMonths, getSettings } from "@/lib/api";
import type { MonthKey } from "@/lib/types";
import { AppContext, type AppContextValue } from "./app-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

const DEFAULT_TIMEZONE = "Asia/Karachi";

export function AppShell({ children }: { children: ReactNode }) {
  const [dataVersion, setDataVersion] = useState(0);
  const { data: months = [] } = useAsync(getAvailableMonths, [dataVersion], { keepPreviousData: true });
  const { data: settings } = useAsync(getSettings, [dataVersion], { keepPreviousData: true });
  const [selectedMonth, setSelectedMonth] = useState<MonthKey | null>(null);
  const [addClientOpen, setAddClientOpen] = useState(false);

  const value: AppContextValue = {
    month: selectedMonth ?? months[0] ?? null,
    months,
    setMonth: setSelectedMonth,
    dataVersion,
    notifyDataChanged: () => setDataVersion((v) => v + 1),
    openAddClient: () => setAddClientOpen(true),
    settings: settings ?? null,
    canEdit: settings?.profile.role === "admin",
    timeZone: settings?.businessTimezone ?? DEFAULT_TIMEZONE,
  };

  return (
    <AppContext value={value}>
      <div className="min-h-screen">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r lg:block">
          <Sidebar />
        </aside>
        <div className="lg:pl-60">
          <Topbar />
          {value.canEdit && settings && settings.mt5.openWarnings > 0 ? (
            <div role="alert" className="border-b border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 sm:px-6 lg:px-8">
              <span className="font-semibold">MT5 sync needs attention:</span> {settings.mt5.openWarnings} unresolved warning
              {settings.mt5.openWarnings === 1 ? "" : "s"} (for example deals that arrived for a finalized month, whose totals were
              left unchanged).{" "}
              <Link href="/settings?tab=mt5" className="font-semibold underline underline-offset-2">
                Review in Settings → MT5
              </Link>
            </div>
          ) : null}
          <main className="mx-auto w-full min-w-0 max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
      {value.canEdit ? (
        <ClientFormSheet open={addClientOpen} onOpenChange={setAddClientOpen} onSaved={value.notifyDataChanged} />
      ) : null}
    </AppContext>
  );
}
