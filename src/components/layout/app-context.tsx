"use client";

import { createContext, useContext } from "react";
import type { MonthKey, Settings } from "@/lib/types";

export interface AppContextValue {
  /** Month selected in the top bar; null until the month list has loaded. */
  month: MonthKey | null;
  /** Months that have data, newest first. */
  months: MonthKey[];
  setMonth: (month: MonthKey) => void;
  /** Bumped after any change, so pages reload their data. */
  dataVersion: number;
  notifyDataChanged: () => void;
  openAddClient: () => void;
  /** Settings and the signed-in user; null until loaded. */
  settings: Settings | null;
  /** Admins can change data; viewers are read-only. */
  canEdit: boolean;
  /** IANA zone used to display times, e.g. "Asia/Karachi". */
  timeZone: string;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppShell>");
  return value;
}
