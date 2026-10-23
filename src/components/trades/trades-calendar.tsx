import { formatCurrency, formatLots, signOf, toDecimal } from "@/lib/calculations";
import { daysInMonth, formatMonth, monthOf, shiftMonth, weekdayIndex } from "@/lib/dates";
import type { DailyPerformance, ISODate, MonthKey } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface TradesCalendarProps {
  /** Per-day totals in the business timezone, from the API. */
  days: DailyPerformance[];
  from: ISODate;
  to: ISODate;
}

/** Month grids where each day shows net profit (tinted green/red) and lots traded. */
export function TradesCalendar({ days: dayList, from, to }: TradesCalendarProps) {
  const days = new Map(dayList.map((d) => [d.date, d]));
  const largest = [...days.values()].reduce(
    (max, d) => (toDecimal(d.netProfit).abs().greaterThan(max) ? toDecimal(d.netProfit).abs() : max),
    toDecimal(0),
  );

  const months: MonthKey[] = [];
  for (let m = monthOf(from); m <= monthOf(to) && months.length < 12; m = shiftMonth(m, 1)) months.push(m);

  return (
    <div className="space-y-8 p-5">
      {months.map((month) => (
        <MonthGrid key={month} month={month} days={days} largest={largest.toNumber()} from={from} to={to} />
      ))}
      <p className="text-xs text-muted-foreground">
        Days are grouped by trade close time in the business timezone. Stronger colour = larger result.
      </p>
    </div>
  );
}

interface MonthGridProps {
  month: MonthKey;
  days: Map<ISODate, DailyPerformance>;
  largest: number;
  from: ISODate;
  to: ISODate;
}

function MonthGrid({ month, days, largest, from, to }: MonthGridProps) {
  const total = daysInMonth(month);
  const offset = weekdayIndex(`${month}-01`);
  const cells: (ISODate | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];

  return (
    <section aria-label={formatMonth(month)}>
      <h3 className="mb-3 text-sm font-bold">{formatMonth(month)}</h3>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 gap-1.5" role="grid">
          {WEEKDAYS.map((d) => (
            <div key={d} className="eyebrow px-1 pb-1 text-[10px]" role="columnheader">
              {d}
            </div>
          ))}
          {cells.map((date, i) =>
            date ? (
              <DayCell key={date} date={date} day={days.get(date)} largest={largest} inRange={date >= from && date <= to} />
            ) : (
              <div key={`pad-${i}`} aria-hidden />
            ),
          )}
        </div>
      </div>
    </section>
  );
}

function DayCell({ date, day, largest, inRange }: { date: ISODate; day?: DailyPerformance; largest: number; inRange: boolean }) {
  const dayNumber = Number(date.slice(8));
  const sign = day ? signOf(day.netProfit) : 0;
  // Tint opacity scales with the size of the day's result (plotting only).
  const strength = day && largest > 0 ? 0.12 + 0.5 * (Math.abs(Number(day.netProfit)) / largest) : 0;
  const tint = sign > 0 ? `rgba(22,163,74,${strength})` : sign < 0 ? `rgba(220,38,38,${strength})` : undefined;

  return (
    <div
      role="gridcell"
      className={cn(
        "flex min-h-20 flex-col rounded-lg border p-2 text-xs",
        !inRange && "opacity-40",
        !day && "bg-muted/30",
      )}
      style={tint ? { backgroundColor: tint } : undefined}
      aria-label={
        day
          ? `${date}: ${formatCurrency(day.netProfit, { signed: true })}, ${formatLots(day.lots)} lots, ${day.trades} trades`
          : `${date}: no trades`
      }
    >
      <span className="num font-semibold text-muted-foreground">{dayNumber}</span>
      {day ? (
        <div className="mt-auto space-y-0.5">
          <p className={cn("num text-[13px] font-bold", sign >= 0 ? "text-profit-ink" : "text-loss")}>
            {formatCurrency(day.netProfit, { signed: true, compact: true })}
          </p>
          <p className="num text-[11px] text-foreground/70">
            {formatLots(day.lots)} lots · {day.trades}
          </p>
        </div>
      ) : null}
    </div>
  );
}
