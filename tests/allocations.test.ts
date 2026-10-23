import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sumMoney } from "@/lib/calculations";
import { createTestDb, type TestDb } from "./helpers/db";

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.close());

const grossOn = async (month: string, day: string) =>
  Object.fromEntries((await db.dailyAllocations(month)).filter((r) => r.day === day).map((r) => [r.client_id, r.gross]));

describe("daily allocation", () => {
  it("weights clients by capital", async () => {
    await db.client("A");
    await db.client("B");
    await db.deposit("A", "30000.00", "2026-04-01");
    await db.deposit("B", "10000.00", "2026-04-01");
    await db.trade("2026-04-06T09:00:00Z", "400.00");
    await db.recompute();
    expect(await grossOn("2026-04", "2026-04-06")).toEqual({ A: "300.0000000000000000", B: "100.0000000000000000" });
  });

  it("counts a deposit from the day after its effective date", async () => {
    await db.client("A");
    await db.client("B");
    await db.deposit("A", "10000.00", "2026-04-01");
    await db.deposit("B", "10000.00", "2026-04-06");
    await db.trade("2026-04-06T09:00:00Z", "100.00"); // B's deposit day
    await db.trade("2026-04-07T09:00:00Z", "100.00");
    await db.recompute();
    expect(await grossOn("2026-04", "2026-04-06")).toEqual({ A: "100.0000000000000000" });
    expect(await grossOn("2026-04", "2026-04-07")).toEqual({ A: "50.0000000000000000", B: "50.0000000000000000" });
  });

  it("stops counting a withdrawal on its effective date, and partial withdrawals reduce the weight", async () => {
    await db.client("A");
    await db.client("B");
    await db.deposit("A", "10000.00", "2026-04-01");
    await db.deposit("B", "10000.00", "2026-04-01");
    await db.withdraw("B", "5000.00", "2026-04-08");
    await db.withdraw("B", "5000.00", "2026-04-15");
    await db.trade("2026-04-07T09:00:00Z", "300.00");
    await db.trade("2026-04-08T09:00:00Z", "300.00");
    await db.trade("2026-04-15T09:00:00Z", "300.00");
    await db.recompute();
    expect(await grossOn("2026-04", "2026-04-07")).toEqual({ A: "150.0000000000000000", B: "150.0000000000000000" });
    expect(await grossOn("2026-04", "2026-04-08")).toEqual({ A: "200.0000000000000000", B: "100.0000000000000000" });
    expect(await grossOn("2026-04", "2026-04-15")).toEqual({ A: "300.0000000000000000" });
  });

  it("uses the business timezone for days and months", async () => {
    await db.client("A");
    await db.deposit("A", "10000.00", "2026-03-01");
    await db.trade("2026-03-31T19:30:00Z", "50.00"); // 00:30 on Apr 1 in Karachi
    await db.recompute();
    expect(await db.dailyPnl("2026-03")).toEqual([]);
    expect(await db.dailyPnl("2026-04")).toEqual([{ day: "2026-04-01", net: "50.00", pool_capital: "10000.00" }]);
  });

  it("books profit from days with no invested client on the company line", async () => {
    await db.client("A");
    await db.deposit("A", "10000.00", "2026-04-10");
    await db.trade("2026-04-06T09:00:00Z", "70.00"); // nobody invested yet
    await db.trade("2026-04-13T09:00:00Z", "100.00");
    await db.recompute();
    const split = (await db.ledger()).monthlySplit("2026-04");
    expect(split.netProfit).toBe("170.00");
    expect(split.companyAdjustment).toBe("70.00");
    expect(sumMoney([split.trader, split.company, split.client])).toBe("170.00");
  });
});

describe("open vs finalized months", () => {
  it("never recomputes a finalized month, even when its trades or transactions change", async () => {
    await db.client("A");
    await db.deposit("A", "10000.00", "2026-03-01");
    await db.trade("2026-03-05T09:00:00Z", "100.00");
    await db.trade("2026-04-06T09:00:00Z", "100.00");
    await db.recompute();
    await db.finalize("2026-03");

    await db.trade("2026-03-06T09:00:00Z", "999.00"); // a late trade in the locked month
    await db.client("B");
    await db.deposit("B", "10000.00", "2026-02-01"); // a back-dated deposit
    await db.trade("2026-04-07T09:00:00Z", "200.00");
    const recomputed = await db.recompute();

    expect(recomputed).not.toContain("2026-03");
    expect(await db.dailyPnl("2026-03")).toEqual([{ day: "2026-03-05", net: "100.00", pool_capital: "10000.00" }]);
    expect((await db.ledger()).monthlySplit("2026-03").netProfit).toBe("100.00");
    // The open month did pick up both changes.
    expect(await grossOn("2026-04", "2026-04-07")).toEqual({ A: "100.0000000000000000", B: "100.0000000000000000" });
  });

  it("carries a losing month's loss into the next month in the full pipeline", async () => {
    await db.client("A");
    await db.deposit("A", "10000.00", "2026-02-01");
    await db.trade("2026-03-05T09:00:00Z", "-1000.00");
    await db.trade("2026-04-06T09:00:00Z", "3000.00");
    await db.recompute();
    const ledger = await db.ledger();
    expect(ledger.monthlySplit("2026-03").rows[0]).toMatchObject({ client: "-1000.00", carryOut: "-1000.00", trader: "0.00" });
    expect(ledger.monthlySplit("2026-04").rows[0]).toMatchObject({ carryIn: "-1000.00", trader: "600.00", client: "2300.00" });
    expect(ledger.client("A")?.carriedLoss).toBe("0.00");
  });
});
