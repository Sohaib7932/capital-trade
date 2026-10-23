import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CashClass } from "@/lib/types";
import { applyCashClassification } from "@/server/mt5";
import { createTestDb, type TestDb } from "./helpers/db";

/**
 * The per-client model: each client trades in their own MT5 account(s), the
 * account's whole result is the client's, capital comes from classified balance
 * operations, and fee payments settle the client's monthly fee.
 */

const USER_ID = "00000000-0000-0000-0000-000000000001";
const USER = { id: USER_ID, name: "Admin", email: "admin@x.test", role: "admin" as const };
const DEMO_LOGIN = 800223736;
const OCT = "2026-10";

let db: TestDb;
let cashTicket = 1;

beforeEach(async () => {
  db = await createTestDb();
  await db.pg.query("INSERT INTO admin_users (id, name, email, password_hash) VALUES ($1, 'Admin', 'admin@x.test', 'x')", [USER_ID]);
});
afterEach(() => db.close());

/** A Direct client (no IB) with their own MT5 account(s). */
async function directClient(id: string, ...logins: number[]) {
  await db.client(id);
  await db.pg.query("UPDATE clients SET ib_id = NULL WHERE id = $1", [id]);
  for (const login of logins) {
    await db.pg.query("INSERT INTO mt5_accounts (label, login, server, linked_client_id) VALUES ($1, $2, 'ECMarketsLtd-Demo', $3)", [
      `Account ${login}`,
      login,
      id,
    ]);
  }
}

async function cashEvent(login: number, amount: string, time = "2026-10-12T07:22:00Z") {
  const ticket = cashTicket++;
  await db.pg.query(
    `INSERT INTO account_cash_events (account_login, deal_ticket, time, deal_type, kind, amount, suggested_class)
     VALUES ($1, $2, $3, 2, 'balance', $4, CASE WHEN $4::numeric < 0 THEN 'withdrawal' ELSE 'deposit' END)`,
    [login, ticket, time, amount],
  );
  return ticket;
}

function classify(login: number, ticket: number, classification: CashClass, feeMonth?: string) {
  return db.pg.transaction((tx) =>
    applyCashClassification({ query: (text, params) => tx.query(text, params) }, USER, {
      accountLogin: login,
      dealTicket: ticket,
      classification,
      feeMonth,
    }),
  );
}

describe("Direct clients", () => {
  it("have no IB, show as Direct and can be filtered", async () => {
    await directClient("D", DEMO_LOGIN);
    await db.client("I"); // from ib-01
    const ledger = await db.ledger();
    expect(ledger.client("D")).toMatchObject({ ibId: null, ibName: "Direct" });
    expect(ledger.clients({ ibId: "direct" }).rows.map((c) => c.id)).toEqual(["D"]);
    expect(ledger.clients({ ibId: "ib-01" }).rows.map((c) => c.id)).toEqual(["I"]);
  });
});

describe("profit from the client's own accounts", () => {
  it("splits the demo account's October exactly (7,234.84 → 2,170.45 / 361.74 / 4,702.65)", async () => {
    await directClient("D", DEMO_LOGIN);
    await db.trade("2026-10-14T13:11:48Z", "7234.84", DEMO_LOGIN);
    await db.recompute(OCT);
    const split = (await db.ledger()).monthlySplit(OCT);
    expect(split.netProfit).toBe("7234.84");
    expect(split.rows).toHaveLength(1);
    expect(split.rows[0]).toMatchObject({
      clientId: "D",
      ibName: "Direct",
      grossProfit: "7234.84",
      trader: "2170.45",
      company: "361.74",
      client: "4702.65",
      ib: "0.00",
    });
    expect(split.trader).toBe("2170.45");
    expect(split.company).toBe("361.74");
  });

  it("adds up several accounts of one client, without any capital weighting", async () => {
    await directClient("D", 5001, 5002);
    await db.trade("2026-10-05T10:00:00Z", "100.00", 5001);
    await db.trade("2026-10-06T10:00:00Z", "50.00", 5002);
    await db.recompute(OCT);
    const row = (await db.ledger()).monthlySplit(OCT).rows[0];
    expect(row).toMatchObject({ clientId: "D", grossProfit: "150.00", trader: "45.00", company: "7.50", client: "97.50" });
  });

  it("keeps each client's accounts separate", async () => {
    await directClient("A", 5001);
    await directClient("B", 5002);
    await db.trade("2026-10-05T10:00:00Z", "100.00", 5001);
    await db.trade("2026-10-05T11:00:00Z", "-40.00", 5002);
    await db.recompute(OCT);
    const rows = (await db.ledger()).monthlySplit(OCT).rows;
    expect(rows.find((r) => r.clientId === "A")).toMatchObject({ grossProfit: "100.00", trader: "30.00" });
    expect(rows.find((r) => r.clientId === "B")).toMatchObject({ grossProfit: "-40.00", trader: "0.00", carryOut: "-40.00" });
  });
});

describe("losses carry forward per client", () => {
  it("−300 then +1,000: the loss is recovered first, 700 is split", async () => {
    await directClient("D", DEMO_LOGIN);
    await db.trade("2026-09-10T10:00:00Z", "-300.00", DEMO_LOGIN);
    await db.trade("2026-10-10T10:00:00Z", "1000.00", DEMO_LOGIN);
    await db.recompute(OCT);
    const ledger = await db.ledger();
    expect(ledger.monthlySplit("2026-09").rows[0]).toMatchObject({ carryOut: "-300.00", trader: "0.00", client: "-300.00" });
    expect(ledger.monthlySplit(OCT).rows[0]).toMatchObject({
      carryIn: "-300.00",
      carryOut: "0.00",
      trader: "210.00", // 30% of 700
      company: "35.00", // 5% of 700
      client: "755.00", // 65% of 700, plus the 300 recovered
    });
    expect(ledger.client("D")?.carriedLoss).toBe("0.00");
  });

  it("−300 then +200: nothing is split and 100 is still to recover", async () => {
    await directClient("D", DEMO_LOGIN);
    await db.trade("2026-09-10T10:00:00Z", "-300.00", DEMO_LOGIN);
    await db.trade("2026-10-10T10:00:00Z", "200.00", DEMO_LOGIN);
    await db.recompute(OCT);
    const ledger = await db.ledger();
    expect(ledger.monthlySplit(OCT).rows[0]).toMatchObject({ carryIn: "-300.00", carryOut: "-100.00", trader: "0.00", company: "0.00" });
    expect(ledger.client("D")?.carriedLoss).toBe("-100.00");
  });

  it("can't be switched off", async () => {
    await expect(db.pg.query("UPDATE settings SET loss_handling = 'reset_monthly' WHERE id = 1")).rejects.toThrow(/settings_loss_carry_forward/);
  });
});

describe("IB commission", () => {
  async function ibClientWithProfit() {
    await db.client("C"); // introduced by ib-01
    await db.pg.query("INSERT INTO mt5_accounts (label, login, server, linked_client_id) VALUES ('C', 6001, 'ECMarketsLtd-Live', 'C')");
    await db.trade("2026-10-05T10:00:00Z", "1000.00", 6001);
  }

  it("is off by default: no commission even with a rule", async () => {
    await ibClientWithProfit();
    await db.pg.query("UPDATE ibs SET commission_percent = 10 WHERE id = 'ib-01'");
    await db.recompute(OCT);
    const split = (await db.ledger()).monthlySplit(OCT);
    expect(split.rows[0]).toMatchObject({ ib: "0.00", trader: "300.00", company: "50.00", client: "650.00" });
    expect(split.partyPayouts.filter((p) => p.partyType === "ib")).toEqual([]);
  });

  it("on, from the company's share", async () => {
    await ibClientWithProfit();
    await db.setIbCommission("ib-01", 2, "from_company_share");
    await db.recompute(OCT);
    expect((await db.ledger()).monthlySplit(OCT).rows[0]).toMatchObject({ ib: "20.00", trader: "300.00", company: "30.00", client: "650.00" });
  });

  it("on, additional (taken off before the split)", async () => {
    await ibClientWithProfit();
    await db.setIbCommission("ib-01", 10, "additional");
    await db.recompute(OCT);
    expect((await db.ledger()).monthlySplit(OCT).rows[0]).toMatchObject({ ib: "100.00", trader: "270.00", company: "45.00", client: "585.00" });
  });
});

describe("cash events", () => {
  it("a confirmed deposit becomes the client's capital; ignoring it removes it again", async () => {
    await directClient("D", DEMO_LOGIN);
    const ticket = await cashEvent(DEMO_LOGIN, "10000.00");
    expect((await db.ledger()).client("D")?.investedCapital).toBe("0.00");

    await classify(DEMO_LOGIN, ticket, "deposit");
    const detail = (await db.ledger()).client("D");
    expect(detail?.investedCapital).toBe("10000.00");
    expect(detail?.transactions).toMatchObject([{ type: "deposit", amount: "10000.00", date: "2026-10-12" }]);

    await classify(DEMO_LOGIN, ticket, "ignore");
    expect((await db.ledger()).client("D")?.investedCapital).toBe("0.00");
  });

  it("withdrawals reduce capital; signs are checked", async () => {
    await directClient("D", DEMO_LOGIN);
    await classify(DEMO_LOGIN, await cashEvent(DEMO_LOGIN, "10000.00"), "deposit");
    const out = await cashEvent(DEMO_LOGIN, "-2500.00", "2026-10-20T07:00:00Z");
    await expect(classify(DEMO_LOGIN, out, "deposit")).rejects.toThrow(/positive/);
    await classify(DEMO_LOGIN, out, "withdrawal");
    expect((await db.ledger()).client("D")?.investedCapital).toBe("7500.00");
    await expect(classify(DEMO_LOGIN, await cashEvent(DEMO_LOGIN, "100.00"), "withdrawal")).rejects.toThrow(/negative/);
  });

  it("own-account capital never takes a share of the pool", async () => {
    await directClient("D", DEMO_LOGIN);
    await classify(DEMO_LOGIN, await cashEvent(DEMO_LOGIN, "10000.00", "2026-09-01T07:00:00Z"), "deposit");
    await db.client("P"); // a pool client
    await db.deposit("P", "5000.00", "2026-09-01");
    await db.trade("2026-10-05T10:00:00Z", "100.00"); // pooled account
    await db.recompute(OCT);
    const rows = (await db.ledger()).monthlySplit(OCT).rows;
    expect(rows.map((r) => [r.clientId, r.grossProfit])).toEqual([["P", "100.00"]]);
  });

  it("pooled-account events can only be ignored", async () => {
    const ticket = await cashEvent(1000, "500.00"); // the helper's pooled account
    await expect(classify(1000, ticket, "deposit")).rejects.toThrow(/isn't linked to a client/);
    await classify(1000, ticket, "ignore");
  });

  it("a fee payment pays the month's fee without touching capital", async () => {
    await directClient("D", DEMO_LOGIN);
    await classify(DEMO_LOGIN, await cashEvent(DEMO_LOGIN, "10000.00"), "deposit");
    await db.pg.query("INSERT INTO months (month, status) VALUES ('2026-09', 'finalized')");
    await db.pg.query("INSERT INTO payouts (month, party_type, party_id, amount) VALUES ('2026-09', 'fee', 'D', '1500.00')");
    const fee = async () =>
      (
        await db.pg.query<{ status: string; paid_amount: string; paid_via: string | null; paid_at: string | null }>(
          "SELECT status, paid_amount::text, paid_via, to_char(paid_at, 'YYYY-MM-DD') AS paid_at FROM payouts WHERE party_type = 'fee'",
        )
      ).rows[0];

    const part = await cashEvent(DEMO_LOGIN, "-1000.00", "2026-10-02T07:00:00Z");
    await classify(DEMO_LOGIN, part, "fee_payment"); // defaults to the oldest unpaid fee
    expect(await fee()).toEqual({ status: "pending", paid_amount: "1000.00", paid_via: null, paid_at: null });

    const rest = await cashEvent(DEMO_LOGIN, "-500.00", "2026-10-03T07:00:00Z");
    await classify(DEMO_LOGIN, rest, "fee_payment", "2026-09");
    expect(await fee()).toEqual({ status: "paid", paid_amount: "1500.00", paid_via: "mt5", paid_at: "2026-10-03" });
    expect((await db.ledger()).client("D")?.investedCapital).toBe("10000.00");

    await classify(DEMO_LOGIN, rest, "ignore"); // reclassified: no longer covered
    expect(await fee()).toEqual({ status: "pending", paid_amount: "1000.00", paid_via: null, paid_at: null });
  });

  it("refuses a fee payment when nothing is due and no month is given", async () => {
    await directClient("D", DEMO_LOGIN);
    await expect(classify(DEMO_LOGIN, await cashEvent(DEMO_LOGIN, "-100.00"), "fee_payment")).rejects.toThrow(/no unpaid fee/);
  });
});
