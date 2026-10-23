import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
  await db.client("A");
  await db.deposit("A", "10000.00", "2026-02-01");
  await db.trade("2026-03-05T09:00:00Z", "1000.00");
  await db.trade("2026-04-06T09:00:00Z", "500.00");
  await db.recompute();
});
afterEach(() => db.close());

describe("finalized months are locked", () => {
  it("freezes every client's numbers and creates payouts", async () => {
    await db.finalize("2026-03");
    const split = (await db.ledger()).monthlySplit("2026-03");
    expect(split.status).toBe("finalized");
    expect(split.rows[0]).toMatchObject({ grossProfit: "1000.00", trader: "300.00", company: "50.00", client: "650.00", payoutAmount: "650.00" });

    const { rows } = await db.pg.query<{ party_type: string; amount: string; status: string }>(
      "SELECT party_type, amount::text, status FROM payouts WHERE month = '2026-03' ORDER BY party_type",
    );
    expect(rows).toEqual([
      { party_type: "client", amount: "650.00", status: "pending" },
      { party_type: "trader", amount: "300.00", status: "pending" },
    ]);
  });

  it("doesn't change when trades, splits or IB rules change afterwards", async () => {
    await db.finalize("2026-03");
    const before = (await db.ledger()).monthlySplit("2026-03");

    await db.trade("2026-03-20T09:00:00Z", "-9000.00"); // a late trade in the locked month
    await db.setSplit("A", { trader: 10, company: 10, client: 80 });
    await db.setIbCommission("ib-01", 50, "additional");
    await db.recompute();

    const after = (await db.ledger()).monthlySplit("2026-03");
    expect(after.netProfit).toBe(before.netProfit);
    expect(after.rows).toEqual(before.rows);
    expect(after.partyPayouts).toEqual(before.partyPayouts);
    // The open month does pick up the new split.
    expect((await db.ledger()).monthlySplit("2026-04").rows[0]).toMatchObject({ split: { trader: 10, company: 10, client: 80 } });
  });

  it("carries a locked loss into the next month from the frozen numbers", async () => {
    await db.trade("2026-03-06T09:00:00Z", "-3000.00"); // March nets −2,000
    await db.recompute();
    await db.finalize("2026-03");
    await db.setSplit("A", { trader: 10, company: 10, client: 80 }); // must not rewrite March's frozen carry
    const april = (await db.ledger()).monthlySplit("2026-04").rows[0];
    expect(april).toMatchObject({ carryIn: "-2000.00", carryOut: "-1500.00", trader: "0.00", client: "500.00" });
  });

  it("must be finalized oldest-first and reopened newest-first", async () => {
    let ledger = await db.ledger();
    expect(ledger.finalizeBlocker("2026-04")).toMatch(/Finalize 2026-03 first/);
    expect(ledger.finalizeBlocker("2026-03")).toBeNull();

    await db.finalize("2026-03");
    await db.finalize("2026-04");
    ledger = await db.ledger();
    expect(ledger.finalizeBlocker("2026-03")).toMatch(/already finalized/);
    expect(ledger.reopenBlocker("2026-03")).toMatch(/Reopen 2026-04 first/);
    expect(ledger.reopenBlocker("2026-04")).toBeNull();
  });

  it("refuses to finalize a month twice", async () => {
    await db.finalize("2026-03");
    await expect(db.finalize("2026-03")).rejects.toThrow(/already finalized/);
  });

  it("locks transactions dated in or before the last finalized month", async () => {
    await db.finalize("2026-03");
    const ledger = await db.ledger();
    expect(ledger.isDateLocked("2026-02-15")).toBe(true);
    expect(ledger.isDateLocked("2026-03-31")).toBe(true);
    expect(ledger.isDateLocked("2026-04-01")).toBe(false);
    expect(ledger.client("A")?.transactions[0].locked).toBe(true);
  });
});
