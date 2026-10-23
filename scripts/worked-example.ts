/**
 * Print the worked example (tests/fixtures/worked-example.ts) as computed by the
 * real allocation SQL and ledger, on an in-process Postgres.
 *
 *   npm run example
 */
import Decimal from "decimal.js";
import { formatCurrency } from "../src/lib/calculations";
import { createTestDb } from "../tests/helpers/db";
import { EXAMPLE_MONTH, loadWorkedExample } from "../tests/fixtures/worked-example";

const pad = (s: string, n: number) => s.padStart(n);

async function main() {
  const db = await createTestDb();
  await loadWorkedExample(db);
  await db.recompute();

  const days = await db.dailyPnl(EXAMPLE_MONTH);
  const allocations = await db.dailyAllocations(EXAMPLE_MONTH);
  const clients = ["A", "B", "C"];

  console.log(`\nDaily allocation — ${EXAMPLE_MONTH} (Asia/Karachi days)\n`);
  console.log(
    ["Day       ", pad("Pool net", 10), pad("Pool cap", 10), ...clients.flatMap((c) => [pad(`${c} cap`, 9), pad(`${c} share`, 12)])].join(" "),
  );
  for (const d of days) {
    const cells = clients.flatMap((c) => {
      const a = allocations.find((x) => x.day === d.day && x.client_id === c);
      return a
        ? [pad(new Decimal(a.capital).toFixed(0), 9), pad(new Decimal(a.gross).toFixed(4), 12)]
        : [pad("—", 9), pad("—", 12)];
    });
    console.log([d.day, pad(d.net, 10), pad(new Decimal(d.pool_capital).toFixed(0), 10), ...cells].join(" "));
  }

  const split = (await db.ledger()).monthlySplit(EXAMPLE_MONTH);
  console.log(`\nMonth settlement — net ${formatCurrency(split.netProfit)}\n`);
  console.log(["Client", "Split   ", pad("Gross", 10), pad("Trader", 9), pad("Company", 9), pad("Client", 10), "Days"].join(" "));
  for (const r of [...split.rows].sort((a, b) => a.clientId.localeCompare(b.clientId))) {
    console.log(
      [
        r.clientId.padEnd(6),
        `${r.split.trader}/${r.split.company}/${r.split.client}`.padEnd(8),
        pad(r.grossProfit, 10),
        pad(r.trader, 9),
        pad(r.company, 9),
        pad(r.client, 10),
        pad(String(r.activeDays), 4),
      ].join(" "),
    );
  }
  console.log(
    ["Total ", "        ", pad(split.netProfit, 10), pad(split.trader, 9), pad(split.company, 9), pad(split.client, 10)].join(" "),
  );
  console.log(`\nCompany adjustment (rounding / unallocated): ${split.companyAdjustment}`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
