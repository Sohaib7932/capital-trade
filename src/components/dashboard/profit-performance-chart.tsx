"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { formatCurrency, formatLots } from "@/lib/calculations";
import { formatDayShort } from "@/lib/dates";
import type { DailyPerformance } from "@/lib/types";

const COLORS = {
  bar: "#7dd3fc",
  barNegative: "#fca5a5",
  line: "#B8862B",
  grid: "#ECEAE4",
  axis: "#8a867c",
};

interface ChartPoint {
  date: string;
  label: string;
  /** Numbers for plotting only — tooltips format the original decimal strings. */
  net: number;
  cumulative: number;
  source: DailyPerformance;
}

function ChartTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as ChartPoint | undefined;
  if (!active || !point) return null;
  const { source } = point;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-gold-ink">{point.label}</p>
      <p className="num">
        Day net: <span className="font-semibold">{formatCurrency(source.netProfit, { signed: true })}</span>
      </p>
      <p className="num">
        Cumulative: <span className="font-semibold">{formatCurrency(source.cumulative, { signed: true })}</span>
      </p>
      <p className="num text-muted-foreground">
        {source.trades} trades · {formatLots(source.lots, { unit: true })}
      </p>
    </div>
  );
}

export function ProfitPerformanceChart({ data }: { data: DailyPerformance[] }) {
  const points: ChartPoint[] = data.map((d) => ({
    date: d.date,
    label: formatDayShort(d.date),
    net: Number(d.netProfit),
    cumulative: Number(d.cumulative),
    source: d,
  }));

  return (
    <div className="h-80 w-full" role="img" aria-label="Daily net profit bars with cumulative profit line">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: COLORS.axis, fontSize: 11, fontFamily: "var(--font-mono)" }}
            minTickGap={16}
          />
          <YAxis
            yAxisId="daily"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fill: "#38bdf8", fontSize: 11, fontFamily: "var(--font-mono)" }}
            tickFormatter={(v: number) => formatCurrency(v, { compact: true })}
          />
          <YAxis
            yAxisId="cumulative"
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ fill: COLORS.axis, fontSize: 11, fontFamily: "var(--font-mono)" }}
            tickFormatter={(v: number) => formatCurrency(v, { compact: true })}
          />
          <Tooltip content={ChartTooltip} cursor={{ fill: "rgba(184,134,43,0.06)" }} />
          <Bar yAxisId="daily" dataKey="net" radius={[3, 3, 0, 0]} maxBarSize={14} name="Daily net profit" isAnimationActive={false}>
            {points.map((p) => (
              <Cell key={p.date} fill={p.net >= 0 ? COLORS.bar : COLORS.barNegative} />
            ))}
          </Bar>
          <Line
            yAxisId="cumulative"
            type="monotone"
            dataKey="cumulative"
            stroke={COLORS.line}
            strokeWidth={2.25}
            dot={{ r: 2.5, fill: "#fff", stroke: COLORS.line, strokeWidth: 1.5 }}
            activeDot={{ r: 4.5, fill: COLORS.line }}
            name="Cumulative net profit"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
