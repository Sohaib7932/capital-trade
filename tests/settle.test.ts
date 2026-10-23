import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { sumMoney } from "@/lib/calculations";
import type { LossHandling, SplitPercent } from "@/lib/types";
import { nextCarry, settleMonth, type ClientMonthAllocation } from "@/server/settle";

const DEFAULT: SplitPercent = { trader: 30, company: 5, client: 65 };

function settle(
  allocations: ClientMonthAllocation[],
  options: { net?: string; carry?: Record<string, string>; lossHandling?: LossHandling; splits?: Record<string, SplitPercent> } = {},
) {
  const net = options.net ?? sumMoney(allocations.map((a) => a.gross));
  return settleMonth({
    netProfit: net,
    allocations,
    splits: new Map(allocations.map((a) => [a.clientId, options.splits?.[a.clientId] ?? DEFAULT])),
    carryIn: new Map(Object.entries(options.carry ?? {})),
    lossHandling: options.lossHandling ?? "carry_forward",
  });
}

/** trader + company + client of every row, plus the pool adjustment, must equal the month's net. */
function expectReconciles(result: ReturnType<typeof settle>, net: string) {
  const lines = result.clients.flatMap((c) => [c.trader, c.company, c.client]);
  expect(sumMoney([...lines, result.companyAdjustment])).toBe(new Decimal(net).toFixed(2));
  for (const c of result.clients) expect(sumMoney([c.trader, c.company, c.client])).toBe(c.grossProfit);
}

describe("split", () => {
  it("applies each client's own percentages", () => {
    const r = settle([{ clientId: "A", gross: "1000" }, { clientId: "B", gross: "1000" }], {
      splits: { A: DEFAULT, B: { trader: 20, company: 10, client: 70 } },
    });
    expect(r.clients[0]).toMatchObject({ trader: "300.00", company: "50.00", client: "650.00" });
    expect(r.clients[1]).toMatchObject({ trader: "200.00", company: "100.00", client: "700.00" });
  });

  it("puts a client's split remainder cent on the company line", () => {
    // 0.05 × 30% = 0.015 → 0.02, × 65% = 0.0325 → 0.03, company gets what's left.
    const r = settle([{ clientId: "A", gross: "0.05" }]);
    expect(r.clients[0]).toMatchObject({ trader: "0.02", client: "0.03", company: "0.00" });
    expectReconciles(r, "0.05");
  });

  it("puts pool rounding cents on the company adjustment so totals match the real net", () => {
    const third = new Decimal(100).dividedBy(3).toFixed(16);
    const r = settle(
      ["A", "B", "C"].map((clientId) => ({ clientId, gross: third })),
      { net: "100.00" },
    );
    expect(r.clients.map((c) => c.grossProfit)).toEqual(["33.33", "33.33", "33.33"]);
    expect(r.companyAdjustment).toBe("0.01");
    expectReconciles(r, "100.00");
  });

  it("always reconciles to the cent (randomised)", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let round = 0; round < 200; round++) {
      const net = new Decimal(Math.round((rand() - 0.3) * 2_000_000)).dividedBy(100);
      const weights = Array.from({ length: 1 + Math.floor(rand() * 12) }, () => new Decimal(1 + Math.floor(rand() * 500_000)));
      const total = weights.reduce((a, b) => a.plus(b), new Decimal(0));
      const allocations = weights.map((w, i) => ({ clientId: `c${i}`, gross: net.times(w).dividedBy(total).toFixed(16) }));
      const splits = Object.fromEntries(
        allocations.map((a) => {
          const trader = Math.floor(rand() * 40);
          const company = Math.floor(rand() * 10);
          return [a.clientId, { trader, company, client: 100 - trader - company }];
        }),
      );
      const carry = Object.fromEntries(allocations.map((a) => [a.clientId, rand() < 0.3 ? `-${(rand() * 5000).toFixed(2)}` : "0"]));
      for (const lossHandling of ["carry_forward", "reset_monthly"] as const) {
        expectReconciles(settle(allocations, { net: net.toFixed(2), splits, carry, lossHandling }), net.toFixed(2));
      }
    }
  });
});

describe("losing months", () => {
  it("carry_forward: a loss takes no shares and is carried", () => {
    const r = settle([{ clientId: "A", gross: "-1000" }]);
    expect(r.clients[0]).toMatchObject({ trader: "0.00", company: "0.00", client: "-1000.00", carryOut: "-1000.00" });
  });

  it("carry_forward: next month recovers the loss before anything is split", () => {
    const march = settle([{ clientId: "A", gross: "-1000" }]);
    const april = settleMonth({
      netProfit: "3000.00",
      allocations: [{ clientId: "A", gross: "3000" }],
      splits: new Map([["A", DEFAULT]]),
      carryIn: nextCarry(new Map(), march),
      lossHandling: "carry_forward",
    });
    // 1,000 goes back to the client first; the remaining 2,000 is split 30/5/65.
    expect(april.clients[0]).toMatchObject({
      carryIn: "-1000.00",
      carryOut: "0.00",
      trader: "600.00",
      company: "100.00",
      client: "2300.00", // 1,000 recovered + 1,300 (65% of 2,000)
    });
  });

  it("carry_forward: a partial recovery keeps carrying the rest, with no shares taken", () => {
    const r = settle([{ clientId: "A", gross: "400" }], { carry: { A: "-1000.00" } });
    expect(r.clients[0]).toMatchObject({ trader: "0.00", company: "0.00", client: "400.00", carryOut: "-600.00" });
  });

  it("carry_forward: a client absent this month keeps their carried loss", () => {
    const march = settle([{ clientId: "A", gross: "-500" }]);
    const april = settle([{ clientId: "B", gross: "100" }]);
    expect(nextCarry(nextCarry(new Map(), march), april).get("A")).toBe("-500.00");
  });

  it("reset_monthly: losses are not carried and the next month splits normally", () => {
    const r = settle([{ clientId: "A", gross: "-1000" }], { lossHandling: "reset_monthly" });
    expect(r.clients[0]).toMatchObject({ client: "-1000.00", carryOut: "0.00" });
    const next = settle([{ clientId: "A", gross: "3000" }], { lossHandling: "reset_monthly", carry: { A: "-1000.00" } });
    expect(next.clients[0]).toMatchObject({ carryIn: "0.00", trader: "900.00", company: "150.00", client: "1950.00" });
  });
});
