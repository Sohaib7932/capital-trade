import { Document, Page, Path, Rect, renderToBuffer, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { formatCurrency, formatPercent, signOf } from "@/lib/calculations";
import { formatDate, formatDateTimeIn, formatMonth, monthOf } from "@/lib/dates";
import type { ClientDetail, MonthKey } from "@/lib/types";

const C = {
  ink: "#1c1a17",
  muted: "#6b6860",
  line: "#eceae4",
  gold: "#b8862b",
  goldInk: "#8a6420",
  goldSoft: "#fbf3e2",
  green: "#15803d",
  red: "#dc2626",
};

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9.5, fontFamily: "Helvetica", color: C.ink },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  brandSub: { fontSize: 7, color: C.goldInk, letterSpacing: 1.2, marginTop: 2 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "right" },
  subtitle: { fontSize: 9, color: C.muted, textAlign: "right", marginTop: 3 },
  banner: { backgroundColor: C.goldSoft, color: C.goldInk, padding: 8, borderRadius: 4, marginBottom: 14, fontSize: 9 },
  card: { borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 12, marginBottom: 12 },
  cardTitle: { fontSize: 8, color: C.muted, letterSpacing: 0.8, marginBottom: 8, fontFamily: "Helvetica-Bold" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  field: { width: "50%", marginBottom: 6 },
  label: { fontSize: 7.5, color: C.muted, marginBottom: 1.5 },
  value: { fontSize: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.line },
  rowLast: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6 },
  bold: { fontFamily: "Helvetica-Bold" },
  big: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.ink, paddingBottom: 3, marginBottom: 2 },
  footer: { position: "absolute", bottom: 28, left: 40, right: 40, fontSize: 7.5, color: C.muted, textAlign: "center" },
});

/** Helvetica has no U+2212 minus sign; use a hyphen in the PDF. */
const money = (value: string, signed = false) => formatCurrency(value, { signed }).replace("−", "-");
const tone = (value: string) => (signOf(value) > 0 ? C.green : signOf(value) < 0 ? C.red : C.ink);

function Logo() {
  return (
    <Svg width={28} height={28} viewBox="0 0 28 28">
      <Rect x={0} y={0} width={28} height={28} rx={6} fill={C.ink} />
      <Path d="M6 18 L11.5 12.5 L15 16 L22 9 M17 9 H22 V14" stroke={C.gold} strokeWidth={2.2} fill="none" />
    </Svg>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

function Line({ label, value, color, bold, last }: { label: string; value: string; color?: string; bold?: boolean; last?: boolean }) {
  return (
    <View style={last ? s.rowLast : s.row}>
      <Text style={bold ? s.bold : undefined}>{label}</Text>
      <Text style={[bold ? s.bold : {}, { color: color ?? C.ink }]}>{value}</Text>
    </View>
  );
}

interface StatementProps {
  client: Omit<ClientDetail, "accountDetails">;
  month: MonthKey;
  timeZone: string;
  generatedAt: Date;
}

function Statement({ client, month, timeZone, generatedAt }: StatementProps) {
  const record = client.history.find((h) => h.month === month);
  const transactions = client.transactions.filter((t) => monthOf(t.date) === month).reverse();
  const open = record?.monthStatus !== "finalized";

  const payout = !record
    ? "No allocation this month"
    : open
      ? "Month still open — not yet payable"
      : signOf(record.payoutAmount) <= 0
        ? "Nothing due this month"
        : record.payoutStatus === "paid"
          ? `Paid ${money(record.payoutAmount)} on ${formatDate(record.paidAt!)}`
          : `Pending — ${money(record.payoutAmount)} due`;

  return (
    <Document title={`Statement ${client.code} ${month}`} author="CapitalTrade Advisor">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.brand}>
            <Logo />
            <View>
              <Text style={s.brandName}>CapitalTrade</Text>
              <Text style={s.brandSub}>ADVISOR · XAUUSD</Text>
            </View>
          </View>
          <View>
            <Text style={s.title}>Monthly statement</Text>
            <Text style={s.subtitle}>{formatMonth(month)}</Text>
          </View>
        </View>

        {open ? (
          <Text style={s.banner}>Provisional: this month is still open, so these figures can change until it is finalized.</Text>
        ) : null}

        <View style={s.card}>
          <Text style={s.cardTitle}>CLIENT</Text>
          <View style={s.grid}>
            <Field label="Name" value={client.fullName} />
            <Field label="Client ID" value={client.code} />
            <Field label="Email" value={client.email} />
            <Field label="Phone" value={client.phone} />
            <Field label="Introduced by" value={client.ibName} />
            <Field label="Client since" value={formatDate(client.joinedAt)} />
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>CAPITAL</Text>
          <Line label="Invested capital today" value={money(client.investedCapital)} />
          <Line label={`Average capital in ${formatMonth(month)}`} value={record ? money(record.capital) : "—"} last />
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>PROFIT FOR {formatMonth(month).toUpperCase()}</Text>
          {record ? (
            <>
              <Line label="Your share of the pool's net profit" value={money(record.grossProfit, true)} color={tone(record.grossProfit)} />
              {signOf(record.carryIn) < 0 ? (
                <Line label="Loss carried in from earlier months" value={money(record.carryIn)} color={C.red} />
              ) : null}
              <Line label={`Trader (${formatPercent(record.split.trader)})`} value={money(record.trader)} />
              <Line label={`Company (${formatPercent(record.split.company)})`} value={money(record.company)} />
              {signOf(record.ib) !== 0 ? <Line label="Introducing broker" value={money(record.ib)} /> : null}
              <Line label={`Your result (${formatPercent(record.split.client)} share)`} value={money(record.client, true)} color={tone(record.client)} bold />
              {signOf(record.carryOut) < 0 ? (
                <Line label="Loss carried to next month" value={money(record.carryOut)} color={C.red} />
              ) : null}
              <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                <Text style={{ color: C.muted }}>Payout</Text>
                <Text style={s.bold}>{payout}</Text>
              </View>
            </>
          ) : (
            <Text style={{ color: C.muted }}>You had no capital in the pool on this month&apos;s trading days.</Text>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>DEPOSITS AND WITHDRAWALS THIS MONTH</Text>
          {transactions.length ? (
            <>
              <View style={s.tableHead}>
                <Text style={{ width: "25%" }}>Effective date</Text>
                <Text style={{ width: "25%" }}>Type</Text>
                <Text style={{ width: "25%", textAlign: "right" }}>Amount</Text>
                <Text style={{ width: "25%", paddingLeft: 10 }}>Note</Text>
              </View>
              {transactions.map((t) => (
                <View key={t.id} style={{ flexDirection: "row", paddingVertical: 3 }}>
                  <Text style={{ width: "25%" }}>{formatDate(t.date)}</Text>
                  <Text style={{ width: "25%" }}>{t.type === "deposit" ? "Deposit" : "Withdrawal"}</Text>
                  <Text style={{ width: "25%", textAlign: "right" }}>{money(t.type === "deposit" ? t.amount : `-${t.amount}`, true)}</Text>
                  <Text style={{ width: "25%", paddingLeft: 10, color: C.muted }}>{t.note ?? ""}</Text>
                </View>
              ))}
            </>
          ) : (
            <Text style={{ color: C.muted }}>None.</Text>
          )}
        </View>

        <Text style={s.footer} fixed>
          Generated {formatDateTimeIn(generatedAt.toISOString(), timeZone)} ({timeZone}) · Amounts in USD · Only trading
          profit is shared; invested capital is never part of the split.
        </Text>
      </Page>
    </Document>
  );
}

export function renderStatement(props: StatementProps): Promise<Buffer> {
  return renderToBuffer(<Statement {...props} />);
}
