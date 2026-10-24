import type { ISODateTime, Mt5SyncState, SyncHealth } from "./types";

export const SYNC_GREEN_MINUTES = 5;
export const SYNC_AMBER_MINUTES = 30;

/** Green if the last good sync was < 5 min ago, amber < 30 min, red otherwise or if the last attempt failed. */
export function syncHealth(lastSyncAt: ISODateTime | null, lastStatus: "ok" | "error" | null, now: Date): SyncHealth {
  if (!lastSyncAt) return lastStatus === "error" ? "red" : "none";
  if (lastStatus === "error") return "red";
  const minutes = (now.getTime() - new Date(lastSyncAt).getTime()) / 60_000;
  if (minutes < SYNC_GREEN_MINUTES) return "green";
  if (minutes < SYNC_AMBER_MINUTES) return "amber";
  return "red";
}

/** Where an account is in its sync life: paused, no password yet, waiting for its first sync, ok, or failing. */
export function accountSyncState(a: {
  isActive: boolean;
  isDemo?: boolean;
  passwordSet: boolean;
  lastSyncAt: ISODateTime | null;
  lastSyncStatus: "ok" | "error" | null;
}): Mt5SyncState {
  if (!a.isActive) return "paused";
  if (a.lastSyncStatus === "error") return "error";
  if (a.lastSyncAt) return "ok";
  return a.passwordSet || a.isDemo ? "waiting" : "no_password";
}

const HEALTH_RANK: Record<SyncHealth, number> = { none: 0, green: 1, amber: 2, red: 3 };

/** The worst of several sync healths ("none" if there are none). */
export function worstHealth(values: SyncHealth[]): SyncHealth {
  return values.reduce<SyncHealth>((worst, h) => (HEALTH_RANK[h] > HEALTH_RANK[worst] ? h : worst), "none");
}

/** What to tell an admin when an account's last sync failed. */
export function syncErrorText(kind: "auth" | "other" | null, message: string | null): string {
  if (kind === "auth") return "Wrong investor password or server";
  return message ?? "The last sync failed";
}

/** MT5 deal types (ENUM_DEAL_TYPE). Only BUY/SELL are trading deals. */
export const DEAL_TYPE = {
  BUY: 0,
  SELL: 1,
  BALANCE: 2,
  CREDIT: 3,
  CHARGE: 4,
  CORRECTION: 5,
  BONUS: 6,
  COMMISSION: 7,
  COMMISSION_DAILY: 8,
  COMMISSION_MONTHLY: 9,
  COMMISSION_AGENT_DAILY: 10,
  COMMISSION_AGENT_MONTHLY: 11,
  INTEREST: 12,
  BUY_CANCELED: 13,
  SELL_CANCELED: 14,
  DIVIDEND: 15,
  DIVIDEND_FRANKED: 16,
  TAX: 17,
} as const;

/** MT5 deal entries (ENUM_DEAL_ENTRY). */
export const DEAL_ENTRY = { IN: 0, OUT: 1, INOUT: 2, OUT_BY: 3 } as const;

const CASH_KINDS: Record<number, string> = {
  2: "balance",
  3: "credit",
  4: "charge",
  5: "correction",
  6: "bonus",
  7: "commission",
  8: "commission_daily",
  9: "commission_monthly",
  10: "agent_commission_daily",
  11: "agent_commission_monthly",
  12: "interest",
  15: "dividend",
  16: "dividend_franked",
  17: "tax",
};

/** The cash-event kind for a non-trading deal type, or null if the deal should be ignored (cancelled orders). */
export function cashKind(dealType: number): string | null {
  if (dealType === DEAL_TYPE.BUY_CANCELED || dealType === DEAL_TYPE.SELL_CANCELED) return null;
  return CASH_KINDS[dealType] ?? `type_${dealType}`;
}

/** First guess for a balance operation: balance deals by sign; everything else (credit, bonus, …) is ignored. */
export function suggestCashClass(kind: string, amount: string): "deposit" | "withdrawal" | "ignore" {
  if (kind !== "balance") return "ignore";
  return amount.startsWith("-") ? "withdrawal" : "deposit";
}

export const CASH_KIND_LABELS: Record<string, string> = {
  balance: "Deposit / withdrawal",
  credit: "Credit",
  charge: "Charge",
  correction: "Correction",
  bonus: "Bonus",
  commission: "Commission",
  commission_daily: "Daily commission",
  commission_monthly: "Monthly commission",
  agent_commission_daily: "Agent commission (daily)",
  agent_commission_monthly: "Agent commission (monthly)",
  interest: "Interest",
  dividend: "Dividend",
  dividend_franked: "Dividend (franked)",
  tax: "Tax",
};
