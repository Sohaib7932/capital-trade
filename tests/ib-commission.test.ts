import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sumMoney } from "@/lib/calculations";
import type { IBCommissionRule, SplitPercent } from "@/lib/types";
import { settleMonth } from "@/server/settle";
import { createTestDb, type TestDb } from "./helpers/db";

const DEFAULT: SplitPercent = { trader: 30, company: 5, client: 65 };

function settleOne(gross: string, rule: IBCommissionRule, carryIn = "0.00") {
  const { clients } = settleMonth({
    netProfit: gross,
    allocations: [{ clientId: "A", gross }],
    splits: new Map([["A", DEFAULT]]),
    ibRules: new Map([["A", rule]]),
    carryIn: new Map([["A", carryIn]]),
    lossHandling: "carry_forward",
  });
  const c = clients[0];
  expect(sumMoney([c.trader, c.company, c.client, c.ib])).toBe(c.grossProfit);
  return c;
}

describe("IB commission", () => {
  it("from_company_share: paid out of the company line; trader and client unchanged", () => {
    expect(settleOne("1000", { percent: 2, source: "from_company_share" })).toMatchObject({
      ib: "20.00",
      trader: "300.00",
      company: "30.00", // 50 − 20
      client: "650.00",
    });
  });

  it("additional: taken off the profit first, then the remainder is split 30/5/65", () => {
    expect(settleOne("1000", { percent: 3, source: "additional" })).toMatchObject({
      ib: "30.00",
      trader: "291.00", // 30% of 970
      company: "48.50", // 5% of 970
      client: "630.50", // 65% of 970
    });
  });

  it("takes no commission on a loss or while a carried loss is being recovered", () => {
    expect(settleOne("-500", { percent: 5, source: "additional" })).toMatchObject({ ib: "0.00", trader: "0.00" });
    // 1,500 profit recovers a 1,000 loss first; commission only on the 500 beyond it.
    expect(settleOne("1500", { percent: 10, source: "from_company_share" }, "-1000.00")).toMatchObject({
      ib: "50.00",
      trader: "150.00",
      company: "-25.00", // 5% of 500 = 25, minus the 50 commission
      client: "1325.00", // 1,000 recovered + 65% of 500
    });
  });

  it("no rule means no commission", () => {
    expect(settleOne("1000", { percent: 0, source: "from_company_share" }).ib).toBe("0.00");
  });
});

describe("IB commission in the full pipeline", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(() => db.close());

  it("applies each client's IB rule and reports trader and IB payouts", async () => {
    await db.client("A");
    await db.deposit("A", "10000.00", "2026-02-01");
    await db.setIbCommission("ib-01", 2, "from_company_share");
    await db.trade("2026-03-05T09:00:00Z", "1000.00");
    await db.recompute();

    const split = (await db.ledger()).monthlySplit("2026-03");
    expect(split.rows[0]).toMatchObject({ ib: "20.00", trader: "300.00", company: "30.00", client: "650.00" });
    expect(split.ib).toBe("20.00");
    expect(sumMoney([split.trader, split.company, split.client, split.ib])).toBe(split.netProfit);
    expect(split.partyPayouts).toEqual([
      expect.objectContaining({ partyType: "trader", amount: "300.00" }),
      expect.objectContaining({ partyType: "ib", partyId: "ib-01", amount: "20.00" }),
    ]);
  });
});
