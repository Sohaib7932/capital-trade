import type { IngestPayload } from "@/server/ingest";

/**
 * Fake MT5 data, shaped exactly like the Python worker's POST body.
 * Times are *broker server time* in epoch seconds (as MetaTrader5 reports them).
 *
 * With a broker on UTC+3 and the business timezone Asia/Karachi (UTC+5):
 *
 *   Pos 501 BUY 2.00: IN  {month}-03 10:00  comm −7.00
 *                     OUT {month}-03 15:00  profit +1,000.00 comm −7.00 swap −3.20     → day 03: +982.80, 2.00 lots
 *   Pos 502 SELL 1.00: IN {month}-04 09:00  comm −3.50
 *                     OUT {month}-04 12:00  0.50 lot, profit +200.00 comm −1.75       → day 04: +194.75, 1.00 lot
 *                     OUT {month}-05 11:00  0.50 lot, profit −50.00  comm −1.75       → day 05: −51.75, 0 lots
 *   Pos 503 BUY 1.00: IN  {month}-06 01:30 server = {month}-05 22:30 UTC = {month}-06 03:30 Karachi
 *                     OUT {month}-06 02:00, profit +100.00                              → day 06: +100.00, 1.00 lot
 *   Month total: +1,225.80 net, 4.00 lots, 4 closing deals.
 *
 *   Cash events (never trading profit): balance +50,000, credit +1,000, bonus +250.
 *   A cancelled order deal (type 13) is ignored.
 *   Optional: pos 504 closed in {lockedMonth}-20 for +400 (to test finalized months).
 *   Open position 505: BUY 1.00, floating +1,000.
 */
export const FAKE_BROKER_OFFSET_MINUTES = 180;

/** "2026-11-03 10:00" (broker server clock) → epoch seconds as MT5 reports it. */
export function serverTime(month: string, day: number, hhmm: string): number {
  const [y, m] = month.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return Date.UTC(y, m - 1, day, h, min) / 1000;
}

const deal = (ticket: number, position_id: number, time: number, type: number, entry: number, volume: number, price: number, extra: Partial<IngestPayload["deals"][number]> = {}) => ({
  ticket,
  order: ticket + 50_000,
  position_id,
  time,
  type,
  entry,
  symbol: "XAUUSD",
  volume: String(volume),
  price: String(price),
  profit: "0.00",
  swap: "0.00",
  commission: "0.00",
  fee: "0.00",
  magic: 0,
  comment: "",
  ...extra,
});

export function buildFakePayload(options: {
  login: number;
  server: string;
  month: string;
  /** Include a closed trade in this (finalized) month. */
  lockedMonth?: string;
  detectedOffsetMinutes?: number | null;
}): IngestPayload {
  const { month } = options;
  const t = (day: number, hhmm: string) => serverTime(month, day, hhmm);
  const deals = [
    deal(9001, 501, t(3, "10:00"), 0, 0, 2, 2650.1, { commission: "-7.00" }),
    deal(9002, 501, t(3, "15:00"), 1, 1, 2, 2655.1, { profit: "1000.00", commission: "-7.00", swap: "-3.20" }),
    deal(9003, 502, t(4, "09:00"), 1, 0, 1, 2660.0, { commission: "-3.50" }),
    deal(9004, 502, t(4, "12:00"), 0, 1, 0.5, 2656.0, { profit: "200.00", commission: "-1.75" }),
    deal(9005, 502, t(5, "11:00"), 0, 1, 0.5, 2661.0, { profit: "-50.00", commission: "-1.75" }),
    deal(9006, 503, t(6, "01:30"), 0, 0, 1, 2670.0),
    deal(9007, 503, t(6, "02:00"), 1, 1, 1, 2671.0, { profit: "100.00" }),
    // Balance operations: not trading profit.
    { ...deal(9100, 0, t(1, "08:00"), 2, 0, 0, 0, { profit: "50000.00", comment: "Deposit" }), symbol: "" },
    { ...deal(9101, 0, t(2, "08:00"), 3, 0, 0, 0, { profit: "1000.00", comment: "Credit in" }), symbol: "" },
    { ...deal(9102, 0, t(2, "09:00"), 6, 0, 0, 0, { profit: "250.00", comment: "Bonus" }), symbol: "" },
    // A cancelled order: ignored.
    deal(9103, 506, t(7, "10:00"), 13, 0, 1, 2680.0),
  ];
  if (options.lockedMonth) {
    const l = (day: number, hhmm: string) => serverTime(options.lockedMonth!, day, hhmm);
    deals.push(deal(8001, 504, l(20, "10:00"), 0, 0, 1, 2600.0), deal(8002, 504, l(20, "14:00"), 1, 1, 1, 2604.0, { profit: "400.00" }));
  }
  return {
    account_login: options.login,
    server: options.server,
    account: { balance: "60000.00", equity: "61000.00", margin: "500.00", profit: "1000.00" },
    positions: [
      {
        ticket: 505,
        symbol: "XAUUSD",
        type: 0,
        volume: "1.00",
        time: t(7, "09:00"),
        price_open: "2700.00000",
        price_current: "2710.00000",
        profit: "1000.00",
        swap: "0.00",
      },
    ],
    deals,
    detected_utc_offset_minutes: options.detectedOffsetMinutes ?? FAKE_BROKER_OFFSET_MINUTES,
    worker_version: "fixture",
  } as IngestPayload;
}
