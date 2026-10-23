import Decimal from "decimal.js";
import type { DailyPerformance, DecimalString, SplitAmounts, SplitPercent, Trade } from "./types";

/** Anything decimal.js can parse. Prefer strings for money. */
export type DecimalInput = Decimal.Value;

const CENTS = 2;
const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

/** Contract size of one XAUUSD lot, in troy ounces. */
export const OUNCES_PER_LOT = 100;

export const DEFAULT_SPLIT: SplitPercent = { trader: 30, company: 5, client: 65 };

export function toDecimal(value: DecimalInput | null | undefined): Decimal {
  return value === null || value === undefined || value === "" ? ZERO : new Decimal(value);
}

/** Round to cents and serialise. */
export function toMoney(value: DecimalInput): DecimalString {
  return toDecimal(value).toDecimalPlaces(CENTS, Decimal.ROUND_HALF_UP).toFixed(CENTS);
}

export function sum(values: readonly DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), ZERO);
}

export function sumMoney(values: readonly DecimalInput[]): DecimalString {
  return toMoney(sum(values));
}

/** Net profit of a trade = profit + swap + commission. */
export function netProfit(trade: Pick<Trade, "profit" | "swap" | "commission">): DecimalString {
  return toMoney(sum([trade.profit, trade.swap, trade.commission]));
}

/**
 * Group trades by close date (UTC) into daily net profit, lots and a running
 * cumulative total. Days are returned in ascending order.
 */
export function dailyPerformance(trades: readonly Trade[]): DailyPerformance[] {
  const byDay = new Map<string, Trade[]>();
  for (const trade of trades) {
    const day = trade.closeTime.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), trade]);
  }
  let cumulative = ZERO;
  return [...byDay.keys()].sort().map((date) => {
    const dayTrades = byDay.get(date) ?? [];
    const net = sum(dayTrades.map(netProfit));
    cumulative = cumulative.plus(net);
    return {
      date,
      netProfit: toMoney(net),
      cumulative: toMoney(cumulative),
      lots: sum(dayTrades.map((t) => t.lots)).toFixed(2),
      trades: dayTrades.length,
    };
  });
}

/** Gross P/L of an XAUUSD position from price movement. */
export function tradeProfit(
  type: Trade["type"],
  openPrice: DecimalInput,
  closePrice: DecimalInput,
  lots: DecimalInput,
): DecimalString {
  const move = toDecimal(closePrice).minus(toDecimal(openPrice));
  const directed = type === "buy" ? move : move.negated();
  return toMoney(directed.times(toDecimal(lots)).times(OUNCES_PER_LOT));
}

export function splitTotal(split: SplitPercent): Decimal {
  return sum([split.trader, split.company, split.client]);
}

export function isValidSplit(split: SplitPercent): boolean {
  return (
    [split.trader, split.company, split.client].every((p) => p >= 0) &&
    splitTotal(split).equals(HUNDRED)
  );
}

/**
 * Split a profit between trader, company and client.
 *
 * Trader and company are rounded to cents; the client receives the remainder,
 * so the three parts always add up to `amount` exactly. Only profit is split —
 * a loss (or zero) produces zero for every party.
 */
export function splitProfit(amount: DecimalInput, split: SplitPercent): Omit<SplitAmounts, "ib"> {
  const total = toDecimal(amount);
  if (total.lessThanOrEqualTo(0)) {
    return { trader: toMoney(0), company: toMoney(0), client: toMoney(0) };
  }
  const trader = new Decimal(toMoney(total.times(split.trader).dividedBy(HUNDRED)));
  const company = new Decimal(toMoney(total.times(split.company).dividedBy(HUNDRED)));
  return {
    trader: toMoney(trader),
    company: toMoney(company),
    client: toMoney(total.minus(trader).minus(company)),
  };
}

/**
 * Allocate a pool amount across holders in proportion to their capital.
 *
 * Each share is rounded to cents and the rounding difference is given to the
 * largest holder, so the parts always sum to `amount` exactly.
 */
export function allocateByCapital(
  amount: DecimalInput,
  capitals: readonly DecimalInput[],
): DecimalString[] {
  const total = sum(capitals);
  if (total.isZero()) return capitals.map(() => toMoney(0));

  const pool = toDecimal(amount);
  const shares = capitals.map((c) => new Decimal(toMoney(pool.times(toDecimal(c)).dividedBy(total))));
  const diff = pool.minus(sum(shares));
  if (!diff.isZero()) {
    let largest = 0;
    capitals.forEach((c, i) => {
      if (toDecimal(c).greaterThan(toDecimal(capitals[largest]))) largest = i;
    });
    shares[largest] = shares[largest].plus(diff);
  }
  return shares.map((s) => toMoney(s));
}

/** `part` as a percentage of `whole`, e.g. "6.7568". */
export function percentOf(part: DecimalInput, whole: DecimalInput, places = 4): DecimalString {
  const w = toDecimal(whole);
  if (w.isZero()) return new Decimal(0).toFixed(places);
  return toDecimal(part).dividedBy(w).times(HUNDRED).toFixed(places, Decimal.ROUND_HALF_UP);
}

/** Percentage change from `previous` to `current`, or null if previous is zero. */
export function percentChange(current: DecimalInput, previous: DecimalInput): DecimalString | null {
  const prev = toDecimal(previous);
  if (prev.isZero()) return null;
  return toDecimal(current).minus(prev).dividedBy(prev.abs()).times(HUNDRED).toFixed(2);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const MINUS = "−";

function groupThousands(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatAbsolute(value: Decimal, places: number): string {
  const [int, frac] = value.abs().toFixed(places, Decimal.ROUND_HALF_UP).split(".");
  return frac ? `${groupThousands(int)}.${frac}` : groupThousands(int);
}

interface CurrencyOptions {
  /** Always show a sign: "+$1.00" / "−$1.00". */
  signed?: boolean;
  /** Decimal places (default 2). */
  places?: number;
  /** Compact form for chart axes: "$14.8k", "$1.48M". */
  compact?: boolean;
}

/** "$1,480,000.00", "−$2,140.00", or with `signed` "+$142,650.00". */
export function formatCurrency(value: DecimalInput, options: CurrencyOptions = {}): string {
  const { signed = false, places = CENTS, compact = false } = options;
  const d = toDecimal(value);
  const rounded = new Decimal(d.toFixed(places, Decimal.ROUND_HALF_UP));
  const sign = rounded.isNegative() && !rounded.isZero() ? MINUS : signed && !rounded.isZero() ? "+" : "";

  if (compact) {
    const abs = rounded.abs();
    const units: [Decimal, string][] = [
      [new Decimal(1_000_000), "M"],
      [new Decimal(1_000), "k"],
    ];
    for (const [size, suffix] of units) {
      if (abs.greaterThanOrEqualTo(size)) {
        const scaled = abs.dividedBy(size);
        const text = scaled.toDecimalPlaces(scaled.lessThan(10) ? 2 : 1).toString();
        return `${sign}$${text}${suffix}`;
      }
    }
    return `${sign}$${abs.toDecimalPlaces(0).toString()}`;
  }
  return `${sign}$${formatAbsolute(rounded, places)}`;
}

/** "2.50" or, with `unit`, "2.50 lots". */
export function formatLots(value: DecimalInput, options: { unit?: boolean } = {}): string {
  const text = formatAbsolute(toDecimal(value), 2);
  if (!options.unit) return text;
  return `${text} ${toDecimal(value).equals(1) ? "lot" : "lots"}`;
}

/** Price with grouping and 2 decimals: "4,012.35". */
export function formatPrice(value: DecimalInput): string {
  return formatAbsolute(toDecimal(value), 2);
}

/** "65%", "6.76%" or with `signed` "+9.64%". */
export function formatPercent(
  value: DecimalInput,
  options: { places?: number; signed?: boolean } = {},
): string {
  const d = toDecimal(value);
  const places = options.places ?? (d.isInteger() ? 0 : 2);
  const sign = d.isNegative() && !d.isZero() ? MINUS : options.signed && !d.isZero() ? "+" : "";
  return `${sign}${formatAbsolute(d, places)}%`;
}

/** -1, 0 or 1 — for picking profit/loss colours. */
export function signOf(value: DecimalInput): -1 | 0 | 1 {
  const d = toDecimal(value);
  return d.isZero() ? 0 : d.isNegative() ? -1 : 1;
}
