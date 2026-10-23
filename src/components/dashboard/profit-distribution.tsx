"use client";

import { Info, PieChart as PieIcon } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatPercent, percentOf, signOf, sum } from "@/lib/calculations";
import type { SplitAmounts } from "@/lib/types";

const PARTS = [
  { key: "client", label: "Clients share", sub: "Paid out to investors", color: "#0284C7", dot: "bg-share-client" },
  { key: "trader", label: "Trader share", sub: "Performance fee", color: "#B8862B", dot: "bg-share-trader" },
  { key: "company", label: "Company share", sub: "Operations", color: "#94A3B8", dot: "bg-share-company" },
  { key: "ib", label: "IB commission", sub: "Introducing brokers", color: "#0D9488", dot: "bg-share-ib" },
] as const;

export function ProfitDistribution({ distribution }: { distribution: SplitAmounts }) {
  const total = sum([distribution.client, distribution.trader, distribution.company, distribution.ib]);

  if (signOf(total) <= 0) {
    return (
      <EmptyState
        icon={PieIcon}
        title="Nothing to split yet"
        description="The pool has no net profit for this month. Only profit is split — capital is never touched."
      />
    );
  }

  const data = PARTS.map((p) => ({ name: p.label, value: Number(distribution[p.key]), color: p.color }));

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative mx-auto h-48 w-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius="72%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={1.5}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="eyebrow text-[10px]">Net profit</p>
          <p className="num text-base font-bold">{formatCurrency(total)}</p>
        </div>
      </div>

      <ul className="mt-5 space-y-2" aria-label="Profit distribution">
        {PARTS.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className={`size-2.5 shrink-0 rounded-sm ${p.dot}`} aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{p.label}</p>
                <p className="truncate text-xs text-muted-foreground">{p.sub}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="num text-sm font-bold">{formatCurrency(distribution[p.key])}</p>
              <p className="num text-xs text-muted-foreground">
                {formatPercent(percentOf(distribution[p.key], total, 2), { places: 2 })}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 flex gap-2 rounded-lg border border-gold/25 bg-gold-soft/70 p-3 text-xs leading-relaxed text-gold-ink">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Only the net trading profit is split. Invested capital is never part of the split.
      </p>
    </div>
  );
}
