-- Gold symbols: which MT5 symbols count as pool trading. Brokers differ in case
-- ("xauusd") and suffix ("XAUUSDm", "XAUUSD.r", "GOLD.pro"), so matching ignores both.

ALTER TABLE settings ADD COLUMN gold_symbols text[] NOT NULL DEFAULT ARRAY['XAUUSD', 'GOLD'];

-- The configured list (defaults if the settings row is missing).
CREATE FUNCTION gold_symbols() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT gold_symbols FROM settings WHERE id = 1), ARRAY['XAUUSD', 'GOLD'])
$$;

-- True when `symbol` is one of `gold`, ignoring case and a broker suffix:
-- a separator plus up to 8 letters/digits (".r", ".pro", "-ecn", "_i") or 1–2 letters ("m", "c", "mi").
-- Keep in sync with isGoldSymbol() in src/lib/symbols.ts.
CREATE FUNCTION is_gold_symbol(symbol text, gold text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM unnest(gold) AS g(base)
     WHERE btrim(base) <> ''
       AND left(upper(btrim(symbol)), length(btrim(base))) = upper(btrim(base))
       AND substr(upper(btrim(symbol)), length(btrim(base)) + 1) ~ '^([._#+!-][A-Z0-9]{0,8}|[A-Z]{0,2})$')
$$;

-- Symbols are stored upper-case from now on.
UPDATE mt5_deals SET symbol = upper(btrim(symbol)) WHERE symbol <> upper(btrim(symbol));
UPDATE mt5_positions SET symbol = upper(btrim(symbol)) WHERE symbol <> upper(btrim(symbol));

-- Trades page: gold positions only (other symbols never count as pool profit).
DROP VIEW trades;
CREATE VIEW trades AS
SELECT
  d.position_id                                                                     AS ticket,
  d.account_login,
  upper(min(d.symbol))                                                              AS symbol,
  CASE COALESCE((array_agg(d.type ORDER BY d.time, d.deal_ticket) FILTER (WHERE d.entry = 0))[1],
                1 - (array_agg(d.type ORDER BY d.time, d.deal_ticket) FILTER (WHERE d.entry <> 0))[1])
       WHEN 0 THEN 'buy' ELSE 'sell' END                                             AS type,
  COALESCE(sum(d.volume) FILTER (WHERE d.entry = 0),
           sum(d.volume) FILTER (WHERE d.entry <> 0))                               AS lots,
  COALESCE(min(d.time) FILTER (WHERE d.entry = 0), min(d.time))                     AS open_time,
  max(d.time) FILTER (WHERE d.entry <> 0)                                           AS close_time,
  COALESCE((array_agg(d.price ORDER BY d.time, d.deal_ticket) FILTER (WHERE d.entry = 0))[1],
           (array_agg(d.price ORDER BY d.time, d.deal_ticket))[1])                  AS open_price,
  (array_agg(d.price ORDER BY d.time DESC, d.deal_ticket DESC) FILTER (WHERE d.entry <> 0))[1] AS close_price,
  sum(d.profit)                                                                     AS profit,
  sum(d.swap)                                                                       AS swap,
  sum(d.commission + d.fee)                                                         AS commission
FROM mt5_deals d
JOIN mt5_accounts a ON a.login = d.account_login AND a.is_active
WHERE is_gold_symbol(d.symbol, gold_symbols())
GROUP BY d.account_login, d.position_id
HAVING count(*) FILTER (WHERE d.entry <> 0) > 0;
