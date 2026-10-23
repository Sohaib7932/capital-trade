import ExcelJS from "exceljs";
import { netProfit } from "@/lib/calculations";
import { formatDateTimeIn, formatMonth } from "@/lib/dates";
import type { ClientSummary, MonthKey, MonthlySplit, Trade, TradeSummary } from "@/lib/types";

const MONEY = '#,##0.00;[Red]-#,##0.00';
const GOLD = "FFB8862B";

/** Excel stores numbers as doubles; values are exact to the cent coming in. */
const num = (value: string) => Number(value);

interface Column {
  header: string;
  key: string;
  width: number;
  money?: boolean;
}

function sheet(workbook: ExcelJS.Workbook, name: string, title: string, columns: Column[]): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width, style: c.money ? { numFmt: MONEY } : {} }));
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 14 };
  const header = ws.getRow(3);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD } };
    cell.alignment = { vertical: "middle", horizontal: c.money ? "right" : "left" };
  });
  header.height = 20;
  return ws;
}

function addTotalRow(ws: ExcelJS.Worksheet, values: Record<string, unknown>) {
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.border = { top: { style: "thin" } };
  });
}

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CapitalTrade Advisor";
  wb.created = new Date();
  return wb;
}

export async function profitSplitWorkbook(split: MonthlySplit): Promise<Buffer> {
  const wb = newWorkbook();
  const ws = sheet(wb, "Profit split", `Profit split — ${formatMonth(split.month)} (${split.status})`, [
    { header: "Client ID", key: "code", width: 11 },
    { header: "Client", key: "name", width: 24 },
    { header: "IB", key: "ib", width: 22 },
    { header: "Avg. capital", key: "capital", width: 15, money: true },
    { header: "Pool share %", key: "share", width: 12 },
    { header: "Active days", key: "days", width: 11 },
    { header: "Gross profit", key: "gross", width: 14, money: true },
    { header: "Carried in", key: "carryIn", width: 12, money: true },
    { header: "Trader %", key: "traderPct", width: 9 },
    { header: "Trader", key: "trader", width: 13, money: true },
    { header: "Company %", key: "companyPct", width: 10 },
    { header: "Company", key: "company", width: 13, money: true },
    { header: "IB commission", key: "ibAmount", width: 14, money: true },
    { header: "Client %", key: "clientPct", width: 9 },
    { header: "Client", key: "client", width: 13, money: true },
    { header: "Carried out", key: "carryOut", width: 12, money: true },
    { header: "Payout", key: "payout", width: 13, money: true },
    { header: "Status", key: "status", width: 11 },
    { header: "Paid on", key: "paidAt", width: 12 },
  ]);
  for (const r of split.rows) {
    ws.addRow({
      code: r.clientCode,
      name: r.clientName,
      ib: r.ibName,
      capital: num(r.capital),
      share: Number(r.poolShare),
      days: r.activeDays,
      gross: num(r.grossProfit),
      carryIn: num(r.carryIn),
      traderPct: r.split.trader,
      trader: num(r.trader),
      companyPct: r.split.company,
      company: num(r.company),
      ibAmount: num(r.ib),
      clientPct: r.split.client,
      client: num(r.client),
      carryOut: num(r.carryOut),
      payout: num(r.payoutAmount),
      status: split.status === "open" ? "open" : r.payoutStatus,
      paidAt: r.paidAt ?? "",
    });
  }
  addTotalRow(ws, {
    name: "Total",
    capital: num(split.totalCapital),
    gross: num(split.netProfit),
    trader: num(split.trader),
    company: num(split.company),
    ibAmount: num(split.ib),
    client: num(split.client),
  });
  ws.addRow({});
  ws.addRow({ name: `Company includes ${split.companyAdjustment} adjustment (rounding cents / days with no invested client).` });

  const payouts = sheet(wb, "Trader & IB payouts", `Trader and IB payouts — ${formatMonth(split.month)}`, [
    { header: "Party", key: "party", width: 12 },
    { header: "Name", key: "name", width: 26 },
    { header: "Amount", key: "amount", width: 14, money: true },
    { header: "Status", key: "status", width: 11 },
    { header: "Paid on", key: "paidAt", width: 12 },
  ]);
  for (const p of split.partyPayouts) {
    payouts.addRow({ party: p.partyType, name: p.name, amount: num(p.amount), status: split.status === "open" ? "open" : p.status, paidAt: p.paidAt ?? "" });
  }
  return toBuffer(wb);
}

export async function tradesWorkbook(trades: Trade[], summary: TradeSummary, timeZone: string, title: string): Promise<Buffer> {
  const wb = newWorkbook();
  const ws = sheet(wb, "Trades", title, [
    { header: "Ticket", key: "ticket", width: 11 },
    { header: `Open time (${timeZone})`, key: "openTime", width: 21 },
    { header: `Close time (${timeZone})`, key: "closeTime", width: 21 },
    { header: "Symbol", key: "symbol", width: 9 },
    { header: "Type", key: "type", width: 7 },
    { header: "Lots", key: "lots", width: 8, money: true },
    { header: "Open price", key: "openPrice", width: 12, money: true },
    { header: "Close price", key: "closePrice", width: 12, money: true },
    { header: "Profit", key: "profit", width: 12, money: true },
    { header: "Swap", key: "swap", width: 10, money: true },
    { header: "Commission", key: "commission", width: 12, money: true },
    { header: "Net", key: "net", width: 12, money: true },
  ]);
  for (const t of trades) {
    ws.addRow({
      ticket: t.ticket,
      openTime: formatDateTimeIn(t.openTime, timeZone),
      closeTime: formatDateTimeIn(t.closeTime, timeZone),
      symbol: t.symbol,
      type: t.type,
      lots: num(t.lots),
      openPrice: num(t.openPrice),
      closePrice: num(t.closePrice),
      profit: num(t.profit),
      swap: num(t.swap),
      commission: num(t.commission),
      net: num(netProfit(t)),
    });
  }
  addTotalRow(ws, {
    ticket: `${summary.count} trades`,
    lots: num(summary.lots),
    profit: num(summary.profit),
    swap: num(summary.swap),
    commission: num(summary.commission),
    net: num(summary.net),
  });
  return toBuffer(wb);
}

export async function clientsWorkbook(clients: ClientSummary[], month: MonthKey): Promise<Buffer> {
  const wb = newWorkbook();
  const ws = sheet(wb, "Clients", `Clients — results for ${formatMonth(month)}`, [
    { header: "Client ID", key: "code", width: 11 },
    { header: "Name", key: "name", width: 24 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Email", key: "email", width: 30 },
    { header: "IB", key: "ib", width: 22 },
    { header: "Status", key: "status", width: 10 },
    { header: "Joined", key: "joined", width: 12 },
    { header: "Split (T/C/C %)", key: "split", width: 14 },
    { header: "Invested capital", key: "capital", width: 16, money: true },
    { header: `Result ${month}`, key: "month", width: 14, money: true },
    { header: "Total result", key: "total", width: 14, money: true },
    { header: "Carried loss", key: "carry", width: 13, money: true },
  ]);
  for (const c of clients) {
    ws.addRow({
      code: c.code,
      name: c.fullName,
      phone: c.phone,
      email: c.email,
      ib: c.ibName,
      status: c.status,
      joined: c.joinedAt,
      split: `${c.split.trader}/${c.split.company}/${c.split.client}`,
      capital: num(c.investedCapital),
      month: num(c.monthProfit),
      total: num(c.totalProfit),
      carry: num(c.carriedLoss),
    });
  }
  return toBuffer(wb);
}

export function xlsxResponse(buffer: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
