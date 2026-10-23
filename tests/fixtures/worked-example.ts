import type { TestDb } from "../helpers/db";

export const EXAMPLE_MONTH = "2026-03";

/**
 * March 2026, business timezone Asia/Karachi (UTC+5).
 *
 * - A: $100,000 deposited Feb 20 → in the pool all month. Split 30/5/65.
 * - B: $50,000 deposited Mar 10 → earns from Mar 11. Custom split 25/5/70.
 * - C: $50,000 deposited Feb 25, fully withdrawn Mar 18 → earns Mar 1–17. Split 30/5/65.
 *
 * Trades (net = profit + swap + commission):
 *   Mar 02 +1,000 · Mar 09 +2,000 · Mar 10 −500 · Mar 11 +3,000 · Mar 17 +1,200
 *   Mar 18 +900 (closed 20:30 UTC on Mar 17 = 01:30 on Mar 18 in Karachi) · Mar 25 +1,500
 */
export async function loadWorkedExample(db: TestDb): Promise<void> {
  await db.client("A");
  await db.client("B", { trader: 25, company: 5, client: 70 });
  await db.client("C");
  await db.deposit("A", "100000.00", "2026-02-20");
  await db.deposit("B", "50000.00", "2026-03-10");
  await db.deposit("C", "50000.00", "2026-02-25");
  await db.withdraw("C", "50000.00", "2026-03-18");

  await db.trade("2026-03-02T10:00:00Z", "1000.00");
  await db.trade("2026-03-09T08:00:00Z", "1500.00");
  await db.trade("2026-03-09T12:00:00Z", "500.00"); // two trades on one day are summed
  await db.trade("2026-03-10T09:00:00Z", "-500.00");
  await db.trade("2026-03-11T11:00:00Z", "3000.00");
  await db.trade("2026-03-17T07:00:00Z", "1200.00");
  await db.trade("2026-03-17T20:30:00Z", "900.00"); // Karachi: Mar 18, 01:30
  await db.trade("2026-03-25T06:00:00Z", "1500.00");
}
