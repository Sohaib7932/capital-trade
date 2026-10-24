/**
 * Realistic demo data for `npm run db:seed`: 4 IBs, 20 clients, their
 * deposits/withdrawals, and ~150 XAUUSD trades per month for 6 months.
 *
 * Generated from a fixed seed, anchored to the current month, so "this month"
 * always has data.
 */
import Decimal from "decimal.js";
import { DEFAULT_SPLIT, sum, toMoney, tradeProfit } from "@/lib/calculations";
import { daysInMonth, monthOf, monthStart, shiftMonth, toISODate, weekdayIndex } from "@/lib/dates";
import type { IB, ISODate, MonthKey, SplitPercent, Trade, Transaction } from "@/lib/types";

/** A seeded trade (seed trades belong to the demo account, not to a client). */
export type SeedTrade = Omit<Trade, "accountLogin" | "accountLabel" | "clientId" | "clientName">;
import { payoutKey, type ClientRecord, type MonthRecord, type PayoutRecord } from "./ledger";

export interface SeedData {
  ibs: IB[];
  clients: ClientRecord[];
  transactions: Omit<Transaction, "locked">[];
  trades: SeedTrade[];
  months: Record<MonthKey, MonthRecord>;
  payouts: Record<string, PayoutRecord>;
  defaultSplit: SplitPercent;
}

export const HISTORY_MONTHS = 5;

/** Deterministic PRNG (mulberry32). */
function createRandom(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    chance: (p: number) => next() < p,
  };
}

function dateIn(month: MonthKey, day: number): ISODate {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
}

const IB_SEED: Omit<IB, "joinedAt">[] = [
  { id: "ib-01", code: "IB-01", name: "Imran Qureshi", phone: "+1 (555) 014-2201", email: "imran.qureshi@example.com", status: "active", commission: { percent: 2, source: "from_company_share" } },
  { id: "ib-02", code: "IB-02", name: "Northgate Advisors", phone: "+1 (555) 017-3390", email: "office@northgate.example.com", status: "active", notes: "Agency — contact person: Laura Chen.", commission: { percent: 3, source: "additional" } },
  { id: "ib-03", code: "IB-03", name: "Daniel Brooks", phone: "+1 (555) 019-4478", email: "daniel.brooks@example.com", status: "active", commission: { percent: 2.5, source: "from_company_share" } },
  { id: "ib-04", code: "IB-04", name: "Layla Haddad", phone: "+1 (555) 012-5567", email: "layla.haddad@example.com", status: "active", commission: { percent: 1.5, source: "from_company_share" } },
];

interface ClientSeed {
  name: string;
  ib: number;
  amount: number;
  monthsAgo: number;
  day: number;
  split?: SplitPercent;
  /** Extra deposits (+) / withdrawals (−): [monthsAgo, day, amount]. */
  moves?: [number, number, number][];
  /** Fully withdrawn `monthsAgo` months ago. */
  exited?: number;
}

const CLIENT_SEED: ClientSeed[] = [
  { name: "Alexander Wright", ib: 3, amount: 100_000, monthsAgo: 9, day: 15 },
  { name: "Fatima Noor", ib: 1, amount: 250_000, monthsAgo: 8, day: 3, split: { trader: 25, company: 5, client: 70 } },
  { name: "Omar Siddiqui", ib: 0, amount: 180_000, monthsAgo: 8, day: 20 },
  { name: "Hannah Lee", ib: 2, amount: 150_000, monthsAgo: 7, day: 11 },
  { name: "Usman Tariq", ib: 1, amount: 120_000, monthsAgo: 7, day: 25 },
  { name: "Priya Raman", ib: 3, amount: 85_000, monthsAgo: 6, day: 6 },
  { name: "James Carter", ib: 2, amount: 75_000, monthsAgo: 6, day: 18 },
  { name: "Zainab Hussain", ib: 0, amount: 60_000, monthsAgo: 5, day: 9 },
  { name: "Ahmed Raza", ib: 1, amount: 50_000, monthsAgo: 5, day: 22, moves: [[2, 12, 25_000]] },
  { name: "Sofia Martins", ib: 3, amount: 50_000, monthsAgo: 4, day: 2 },
  { name: "Bilal Chaudhry", ib: 1, amount: 40_000, monthsAgo: 4, day: 14 },
  { name: "Emily Brooks", ib: 2, amount: 35_000, monthsAgo: 3, day: 7, moves: [[1, 5, 15_000]] },
  { name: "Hamza Iqbal", ib: 0, amount: 30_000, monthsAgo: 3, day: 19 },
  { name: "Mariam Saeed", ib: 3, amount: 25_000, monthsAgo: 2, day: 4 },
  { name: "Daniel Kim", ib: 2, amount: 25_000, monthsAgo: 2, day: 23, moves: [[1, 16, -5_000]] },
  { name: "Ayesha Malik", ib: 1, amount: 20_000, monthsAgo: 1, day: 10 },
  { name: "Rohan Mehta", ib: 3, amount: 15_000, monthsAgo: 1, day: 26, split: { trader: 30, company: 10, client: 60 } },
  { name: "Noah Williams", ib: 0, amount: 10_000, monthsAgo: 0, day: 6 },
  { name: "Sana Javed", ib: 1, amount: 40_000, monthsAgo: 6, day: 12, exited: 2 },
  { name: "Lucas Fischer", ib: 2, amount: 30_000, monthsAgo: 5, day: 3, exited: 1 },
];

/** Monthly performance factor, oldest → current, for some variety. */
const MONTH_FACTOR = [0.85, 1.1, 0.7, 1.2, 0.95, 1.0];

function buildTrades(months: MonthKey[], now: Date, rand: ReturnType<typeof createRandom>): SeedTrade[] {
  const today = toISODate(now);
  const trades: Omit<SeedTrade, "ticket">[] = [];
  let price = new Decimal("3880.00");

  months.forEach((month, monthIndex) => {
    const factor = MONTH_FACTOR[monthIndex] ?? 1;
    for (let day = 1; day <= daysInMonth(month); day++) {
      const date = dateIn(month, day);
      if (date > today) break;
      if (weekdayIndex(date) >= 5) continue; // markets closed on weekends

      price = price.plus(rand.between(-22, 28)).toDecimalPlaces(2);
      const count = rand.int(7, 12);
      for (let i = 0; i < count; i++) {
        const lots = new Decimal(rand.int(2, 20)).times("0.25"); // 0.50 – 5.00
        const type = rand.chance(0.55) ? "buy" : "sell";
        const openPrice = price.plus(rand.between(-14, 14)).toDecimalPlaces(2);
        const win = rand.chance(0.66 + (factor - 1) * 0.15);
        const move = new Decimal(win ? rand.between(1.5, 9) * factor : -rand.between(0.8, 6)).toDecimalPlaces(2);
        const closePrice = type === "buy" ? openPrice.plus(move) : openPrice.minus(move);

        const overnight = rand.chance(0.1);
        const closeMinute = overnight ? rand.int(60, 600) : rand.int(90, 1380);
        const durationMinutes = overnight ? closeMinute + rand.int(60, 240) : rand.int(5, Math.min(360, closeMinute - 30));
        const closeTime = new Date(`${date}T00:00:00Z`);
        closeTime.setUTCMinutes(closeMinute, rand.int(0, 59));
        const openTime = new Date(closeTime.getTime() - durationMinutes * 60_000 - rand.int(0, 59) * 1000);
        if (closeTime > now) continue; // not closed yet

        const swapPerLot = type === "buy" ? "-4.85" : "1.20";
        trades.push({
          symbol: "XAUUSD",
          type,
          lots: lots.toFixed(2),
          openTime: openTime.toISOString().replace(".000", ""),
          closeTime: closeTime.toISOString().replace(".000", ""),
          openPrice: openPrice.toFixed(2),
          closePrice: closePrice.toFixed(2),
          profit: tradeProfit(type, openPrice, closePrice, lots),
          swap: overnight ? toMoney(lots.times(swapPerLot)) : "0.00",
          commission: toMoney(lots.times("-7")),
        });
      }
    }
  });

  trades.sort((a, b) => a.openTime.localeCompare(b.openTime));
  return trades.map((t, i) => ({ ticket: 8_914_000 + i * 7 + (i % 5), ...t }));
}

export function createSeedData(now: Date): SeedData {
  const rand = createRandom(20_240_915);
  const currentMonth = monthOf(toISODate(now));
  const today = toISODate(now);
  const clampToToday = (date: ISODate) => (date > today ? today : date);

  const ibs: IB[] = IB_SEED.map((ib, i) => ({
    ...ib,
    joinedAt: dateIn(shiftMonth(currentMonth, -11 + i * 2), 4 + i * 6),
  }));

  const clients: ClientRecord[] = [];
  const transactions: Omit<Transaction, "locked">[] = [];
  let txn = 1;

  CLIENT_SEED.forEach((seed, i) => {
    const id = `cl-${String(i + 1).padStart(3, "0")}`;
    const [first, last] = seed.name.toLowerCase().split(" ");
    const joinedAt = clampToToday(dateIn(shiftMonth(currentMonth, -seed.monthsAgo), seed.day));
    clients.push({
      id,
      code: `CL-${String(i + 1).padStart(4, "0")}`,
      fullName: seed.name,
      phone: `+1 (555) 0${String(20 + i).padStart(2, "0")}-${String(1000 + ((i * 7919) % 9000)).slice(0, 4)}`,
      email: `${first}.${last}@example.com`,
      ibId: ibs[seed.ib].id,
      joinedAt,
      status: seed.exited === undefined ? "active" : "inactive",
      split: seed.split ?? { ...DEFAULT_SPLIT },
    });

    const add = (type: Transaction["type"], amount: number, date: ISODate, note: string) =>
      transactions.push({
        id: `tx-${String(txn++).padStart(4, "0")}`,
        clientId: id,
        type,
        amount: toMoney(amount),
        date,
        note,
        source: "manual",
      });

    add("deposit", seed.amount, joinedAt, "Initial investment");
    for (const [monthsAgo, day, amount] of seed.moves ?? []) {
      const date = clampToToday(dateIn(shiftMonth(currentMonth, -monthsAgo), day));
      if (amount > 0) add("deposit", amount, date, "Additional investment");
      else add("withdrawal", -amount, date, "Partial withdrawal");
    }
    if (seed.exited !== undefined) {
      const balance = sum([seed.amount, ...(seed.moves ?? []).map((m) => m[2])]);
      add("withdrawal", balance.toNumber(), dateIn(shiftMonth(currentMonth, -seed.exited), 28), "Full withdrawal — account closed");
    }
  });

  const months = Array.from({ length: HISTORY_MONTHS + 1 }, (_, i) =>
    shiftMonth(currentMonth, i - HISTORY_MONTHS),
  );
  const trades = buildTrades(months, now, rand);

  const monthRecords: Record<MonthKey, MonthRecord> = {};
  const payouts: Record<string, PayoutRecord> = {};
  months.forEach((month, i) => {
    if (month === currentMonth) {
      monthRecords[month] = { status: "open" };
      return;
    }
    const next = shiftMonth(month, 1);
    monthRecords[month] = { status: "finalized", finalizedAt: monthStart(next) };
    const isLatestClosed = i === months.length - 2;
    clients.forEach((client, clientIndex) => {
      const capital = sum(
        transactions
          .filter((t) => t.clientId === client.id && t.date < monthStart(month))
          .map((t) => (t.type === "deposit" ? t.amount : `-${t.amount}`)),
      );
      if (capital.lessThanOrEqualTo(0)) return;
      // Leave a few of last month's payouts pending so "Mark as paid" can be tried.
      const pending = isLatestClosed && clientIndex % 4 === 1;
      payouts[payoutKey(month, "client", client.id)] = pending
        ? { status: "pending" }
        : { status: "paid", paidAt: dateIn(next, 2) };
    });
  });

  return {
    ibs,
    clients,
    transactions,
    trades,
    months: monthRecords,
    payouts,
    defaultSplit: { ...DEFAULT_SPLIT },
  };
}
