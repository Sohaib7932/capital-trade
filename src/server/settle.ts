import Decimal from "decimal.js";
import { sum, toDecimal, toMoney } from "@/lib/calculations";
import type { DecimalString, IBCommissionRule, LossHandling, SplitPercent } from "@/lib/types";

/** A client's month, aggregated from `daily_allocations`. */
export interface ClientMonthAllocation {
  clientId: string;
  /** Sum of the client's unrounded daily shares. */
  gross: DecimalString;
}

export interface SettledClient {
  clientId: string;
  /** Monthly gross rounded to cents — the client's slice of the pool's net. */
  grossProfit: DecimalString;
  /** Unrecovered loss brought in from earlier months (≤ 0). */
  carryIn: DecimalString;
  /** Unrecovered loss carried to next month (≤ 0). */
  carryOut: DecimalString;
  trader: DecimalString;
  company: DecimalString;
  /** Client's result: their split share, plus any recovered loss, or the loss itself. */
  client: DecimalString;
  /** Introducing broker's commission. */
  ib: DecimalString;
}

export interface SettledMonth {
  clients: SettledClient[];
  /**
   * Pool net minus the sum of clients' rounded gross: rounding cents plus any
   * profit from days when no client had capital. Booked on the company line.
   */
  companyAdjustment: DecimalString;
}

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);
const NO_COMMISSION: IBCommissionRule = { percent: 0, source: "from_company_share" };

const cents = (value: Decimal.Value) => new Decimal(toMoney(value));
const pct = (amount: Decimal, percent: number) => cents(amount.times(percent).dividedBy(HUNDRED));

/**
 * Settle one month.
 *
 * 1. Each client's unrounded monthly gross is rounded to cents once.
 * 2. Carry-forward: earlier unrecovered losses are netted first. Only profit
 *    beyond full recovery ("splittable profit") is shared; the recovered part
 *    goes back to the client. No trader, company or IB share until then.
 * 3. IB commission = rule % of the splittable profit. `additional`: taken off
 *    before the split. `from_company_share`: taken out of the company's share.
 * 4. Trader and client are rounded to cents; the company gets the remainder, so
 *    trader + company + client + ib = the client's gross exactly.
 * 5. Whatever the pool made that no client's rounded gross covers goes to the
 *    company too, so the month always reconciles to the real net profit.
 */
export function settleMonth(input: {
  netProfit: DecimalString;
  allocations: ClientMonthAllocation[];
  splits: ReadonlyMap<string, SplitPercent>;
  /** IB commission rule per client (from the client's IB). Missing = no commission. */
  ibRules?: ReadonlyMap<string, IBCommissionRule>;
  /** Unrecovered losses (≤ 0) from previous months, by client. */
  carryIn: ReadonlyMap<string, DecimalString>;
  lossHandling: LossHandling;
}): SettledMonth {
  const clients = input.allocations.map(({ clientId, gross }): SettledClient => {
    const split = input.splits.get(clientId);
    if (!split) throw new Error(`No split for client ${clientId}`);
    const rule = input.ibRules?.get(clientId) ?? NO_COMMISSION;

    const g = cents(gross);
    const carry = input.lossHandling === "carry_forward" ? toDecimal(input.carryIn.get(clientId) ?? 0) : ZERO;
    const splittable = g.plus(carry); // profit left after recovering earlier losses

    if (splittable.lessThanOrEqualTo(0)) {
      // Nothing to share: the client keeps (or absorbs) the whole gross.
      return {
        clientId,
        grossProfit: toMoney(g),
        carryIn: toMoney(carry),
        carryOut: toMoney(input.lossHandling === "carry_forward" ? splittable : ZERO),
        trader: toMoney(0),
        company: toMoney(0),
        client: toMoney(g),
        ib: toMoney(0),
      };
    }

    const ib = pct(splittable, rule.percent);
    const base = rule.source === "additional" ? splittable.minus(ib) : splittable;
    const trader = pct(base, split.trader);
    const recovered = carry.negated(); // ≥ 0: earlier loss paid back to the client first
    const client = pct(base, split.client).plus(recovered);
    return {
      clientId,
      grossProfit: toMoney(g),
      carryIn: toMoney(carry),
      carryOut: toMoney(0),
      trader: toMoney(trader),
      company: toMoney(g.minus(trader).minus(client).minus(ib)),
      client: toMoney(client),
      ib: toMoney(ib),
    };
  });

  return {
    clients,
    companyAdjustment: toMoney(toDecimal(input.netProfit).minus(sum(clients.map((c) => c.grossProfit)))),
  };
}

/** Carry losses forward across consecutive months (oldest first). */
export function nextCarry(
  previous: ReadonlyMap<string, DecimalString>,
  settled: { clients: readonly Pick<SettledClient, "clientId" | "carryOut">[] },
): Map<string, DecimalString> {
  const carry = new Map(previous);
  for (const c of settled.clients) carry.set(c.clientId, c.carryOut);
  return carry;
}
