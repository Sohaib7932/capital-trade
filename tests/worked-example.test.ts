import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sumMoney } from "@/lib/calculations";
import { createTestDb, type TestDb } from "./helpers/db";
import { EXAMPLE_MONTH, loadWorkedExample } from "./fixtures/worked-example";

describe("worked example — March 2026, three clients", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await loadWorkedExample(db);
    await db.recompute();
  });
  afterAll(() => db.close());

  it("builds one pnl row per Karachi business day", async () => {
    expect(await db.dailyPnl(EXAMPLE_MONTH)).toEqual([
      { day: "2026-03-02", net: "1000.00", pool_capital: "150000.00" },
      { day: "2026-03-09", net: "2000.00", pool_capital: "150000.00" },
      { day: "2026-03-10", net: "-500.00", pool_capital: "150000.00" }, // B's deposit day: not counted yet
      { day: "2026-03-11", net: "3000.00", pool_capital: "200000.00" }, // B joins
      { day: "2026-03-17", net: "1200.00", pool_capital: "200000.00" },
      { day: "2026-03-18", net: "900.00", pool_capital: "150000.00" }, // C's withdrawal day: excluded
      { day: "2026-03-25", net: "1500.00", pool_capital: "150000.00" },
    ]);
  });

  it("weights each day by that day's capital", async () => {
    const rows = await db.dailyAllocations(EXAMPLE_MONTH);
    const on = (day: string) => Object.fromEntries(rows.filter((r) => r.day === day).map((r) => [r.client_id, r.gross]));
    expect(on("2026-03-02")).toEqual({ A: "666.6666666666666667", C: "333.3333333333333333" });
    expect(on("2026-03-10")).toEqual({ A: "-333.3333333333333333", C: "-166.6666666666666667" });
    expect(on("2026-03-11")).toEqual({ A: "1500.0000000000000000", B: "750.0000000000000000", C: "750.0000000000000000" });
    expect(on("2026-03-18")).toEqual({ A: "600.0000000000000000", B: "300.0000000000000000" });
  });

  it("settles the month with each client's own split and exact totals", async () => {
    const split = (await db.ledger()).monthlySplit(EXAMPLE_MONTH);
    const row = (id: string) => split.rows.find((r) => r.clientId === id)!;

    expect(split.netProfit).toBe("9100.00");
    expect(row("A")).toMatchObject({ grossProfit: "5366.67", trader: "1610.00", company: "268.33", client: "3488.34", activeDays: 7 });
    expect(row("B")).toMatchObject({ grossProfit: "1850.00", trader: "462.50", company: "92.50", client: "1295.00", activeDays: 4 });
    expect(row("C")).toMatchObject({ grossProfit: "1883.33", trader: "565.00", company: "94.17", client: "1224.16", activeDays: 5 });

    expect(split.companyAdjustment).toBe("0.00");
    expect(sumMoney([split.trader, split.company, split.client])).toBe(split.netProfit);
  });
});
