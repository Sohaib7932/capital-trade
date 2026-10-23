/** Symbols that count as gold (pool) trading unless Settings say otherwise. */
export const DEFAULT_GOLD_SYMBOLS = ["XAUUSD", "GOLD"];

/** Symbols are case-insensitive: stored and shown upper-case. */
export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/**
 * Broker suffix after the base name: a separator plus up to 8 letters/digits
 * (".r", ".pro", "-ecn", "_i") or 1–2 letters ("m", "c", "mi").
 * Keep in sync with is_gold_symbol() in db/migrations/006_gold_symbols.sql.
 */
const SUFFIX = /^(?:[._#+!-][A-Z0-9]{0,8}|[A-Z]{0,2})$/;

/** True when `symbol` is one of `gold`, ignoring case and a broker suffix ("xauusd", "XAUUSDm", "GOLD.pro"). */
export function isGoldSymbol(symbol: string, gold: readonly string[] = DEFAULT_GOLD_SYMBOLS): boolean {
  const s = normalizeSymbol(symbol);
  return gold.some((g) => {
    const base = normalizeSymbol(g);
    return base !== "" && s.startsWith(base) && SUFFIX.test(s.slice(base.length));
  });
}
