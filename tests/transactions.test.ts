import { describe, expect, it } from "vitest";
import { assertBalanceNeverNegative } from "@/server/store";

const dep = (amount: string, date: string) => ({ type: "deposit" as const, amount, date });
const wd = (amount: string, date: string) => ({ type: "withdrawal" as const, amount, date });

describe("capital never goes below zero", () => {
  it("accepts withdrawals covered by earlier deposits", () => {
    expect(() => assertBalanceNeverNegative([dep("1000.00", "2026-03-01"), wd("400.00", "2026-03-10"), wd("600.00", "2026-03-20")])).not.toThrow();
  });

  it("rejects a withdrawal larger than the balance at that date", () => {
    expect(() => assertBalanceNeverNegative([dep("1000.00", "2026-03-01"), wd("1000.01", "2026-03-10")])).toThrow(/below zero/);
  });

  it("checks the timeline, not just the final total", () => {
    // Ends at +500, but is negative between Mar 5 and Mar 10.
    expect(() =>
      assertBalanceNeverNegative([dep("1000.00", "2026-03-01"), wd("1500.00", "2026-03-05"), dep("1000.00", "2026-03-10")]),
    ).toThrow(/2026-03-05/);
  });

  it("applies a same-day withdrawal before a same-day deposit", () => {
    expect(() => assertBalanceNeverNegative([wd("100.00", "2026-03-01"), dep("100.00", "2026-03-01")])).toThrow();
  });
});
