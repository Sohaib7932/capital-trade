import type { ISODate, ISODateTime, MonthKey } from "./types";

/**
 * Date helpers. Everything is handled in UTC (MT5 server time) and on ISO
 * strings, so grouping by day or month never depends on the viewer's timezone.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function toISODate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

export function monthOf(date: ISODate | ISODateTime): MonthKey {
  return date.slice(0, 7);
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthStart(month: MonthKey): ISODate {
  return `${month}-01`;
}

export function monthEnd(month: MonthKey): ISODate {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

/** "October 2026", or "Oct 2026" when `short`. */
export function formatMonth(month: MonthKey, options: { short?: boolean } = {}): string {
  const [y, m] = month.split("-").map(Number);
  const name = MONTH_NAMES[m - 1];
  return `${options.short ? name.slice(0, 3) : name} ${y}`;
}

/** "Oct 21, 2026". */
export function formatDate(date: ISODate | ISODateTime): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}, ${y}`;
}

/** "Oct 21" — for chart axes. */
export function formatDayShort(date: ISODate): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${String(d).padStart(2, "0")}`;
}

/** "2026-10-21 15:42:10" in server (UTC) time. */
export function formatDateTime(value: ISODateTime): string {
  return `${value.slice(0, 10)} ${value.slice(11, 19)}`;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: ISODate): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** "2m ago", "3h ago", "4d ago". */
export function formatRelative(value: ISODateTime, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

/** "2026-10-22 17:46:04" in the given IANA timezone (e.g. the business timezone). */
export function formatDateTimeIn(value: ISODateTime, timeZone: string): string {
  let fmt = zonedFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedFormatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Short zone label, e.g. "PKT" or "GMT+5". */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}
