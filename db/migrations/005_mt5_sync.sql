-- MetaTrader 5 sync: accounts, raw deals, open positions, cash events, sync warnings.
-- Trades become a view over deals grouped by position.

CREATE TABLE mt5_accounts (
  id                              text PRIMARY KEY DEFAULT ('mt5-' || substr(gen_random_uuid()::text, 1, 8)),
  label                           text NOT NULL,
  login                           bigint NOT NULL UNIQUE,
  server                          text NOT NULL,
  -- MT5 reports times in broker server time; UTC = server time − this offset.
  broker_timezone_offset_minutes  integer NOT NULL DEFAULT 0 CHECK (broker_timezone_offset_minutes BETWEEN -720 AND 840),
  -- Offset the worker measured on its last sync (null if the market was closed).
  detected_offset_minutes         integer,
  is_active                       boolean NOT NULL DEFAULT true,
  -- Seeded demo data; removed automatically when a real account syncs.
  is_demo                         boolean NOT NULL DEFAULT false,
  -- Null = the pooled account shared by all clients; otherwise all its profit belongs to this client.
  linked_client_id                text REFERENCES clients (id),
  last_sync_at                    timestamptz,
  last_sync_status                text CHECK (last_sync_status IN ('ok', 'error')),
  last_error                      text,
  balance                         numeric(16, 2),
  equity                          numeric(16, 2),
  margin                          numeric(16, 2),
  floating_pl                     numeric(16, 2),
  created_at                      timestamptz NOT NULL DEFAULT now()
);
-- The MT5 password is never stored here: it lives only on the VPS running the worker.

-- Trading deals (MT5 deal types BUY = 0 / SELL = 1). Times are UTC.
CREATE TABLE mt5_deals (
  account_login  bigint NOT NULL REFERENCES mt5_accounts (login) ON DELETE CASCADE,
  deal_ticket    bigint NOT NULL,
  order_ticket   bigint,
  position_id    bigint NOT NULL,
  time           timestamptz NOT NULL,
  type           smallint NOT NULL CHECK (type IN (0, 1)),
  entry          smallint NOT NULL CHECK (entry IN (0, 1, 2, 3)),  -- IN, OUT, INOUT, OUT_BY
  symbol         text NOT NULL,
  volume         numeric(12, 2) NOT NULL,
  price          numeric(14, 5) NOT NULL,
  profit         numeric(16, 2) NOT NULL DEFAULT 0,
  swap           numeric(16, 2) NOT NULL DEFAULT 0,
  commission     numeric(16, 2) NOT NULL DEFAULT 0,
  fee            numeric(16, 2) NOT NULL DEFAULT 0,
  magic          bigint,
  comment        text,
  received_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz,
  PRIMARY KEY (account_login, deal_ticket)
);
CREATE INDEX mt5_deals_time_idx ON mt5_deals (time);
CREATE INDEX mt5_deals_position_idx ON mt5_deals (account_login, position_id);

-- Balance operations (deposits, credit, bonus, charges, …). Never trading profit; shown for review.
CREATE TABLE account_cash_events (
  account_login  bigint NOT NULL REFERENCES mt5_accounts (login) ON DELETE CASCADE,
  deal_ticket    bigint NOT NULL,
  time           timestamptz NOT NULL,
  deal_type      smallint NOT NULL,
  kind           text NOT NULL,
  amount         numeric(16, 2) NOT NULL,
  comment        text,
  reviewed_at    timestamptz,
  reviewed_by    text,
  received_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_login, deal_ticket)
);
CREATE INDEX account_cash_events_time_idx ON account_cash_events (time DESC);

-- Snapshot of open positions, replaced on every sync.
CREATE TABLE mt5_positions (
  account_login  bigint NOT NULL REFERENCES mt5_accounts (login) ON DELETE CASCADE,
  ticket         bigint NOT NULL,
  symbol         text NOT NULL,
  type           text NOT NULL CHECK (type IN ('buy', 'sell')),
  volume         numeric(12, 2) NOT NULL,
  open_time      timestamptz NOT NULL,
  open_price     numeric(14, 5) NOT NULL,
  current_price  numeric(14, 5) NOT NULL,
  profit         numeric(16, 2) NOT NULL,
  swap           numeric(16, 2) NOT NULL,
  PRIMARY KEY (account_login, ticket)
);

-- Things an admin should look at: deals for finalized months, clock offset mismatches, …
CREATE TABLE sync_warnings (
  id             bigserial PRIMARY KEY,
  account_login  bigint NOT NULL,
  kind           text NOT NULL,          -- 'finalized_month_deals', 'offset_mismatch', 'demo_removed'
  month          char(7) NOT NULL DEFAULT '',
  message        text NOT NULL,
  occurrences    integer NOT NULL DEFAULT 1,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolved_by    text
);
-- One open warning per account/kind/month; repeats bump `occurrences`.
CREATE UNIQUE INDEX sync_warnings_open_idx ON sync_warnings (account_login, kind, month) WHERE resolved_at IS NULL;

-- Pool vs dedicated-account profit, per day.
ALTER TABLE daily_pnl ADD COLUMN linked_net numeric(16, 2) NOT NULL DEFAULT 0;

-- Move existing (demo) trades into deals: one opening and one closing deal per trade.
INSERT INTO mt5_accounts (id, label, login, server, is_demo, last_sync_at, last_sync_status)
SELECT 'mt5-demo', 'Demo data', 0, 'demo', true, mt5_last_sync_at, 'ok' FROM settings
WHERE EXISTS (SELECT 1 FROM trades);

INSERT INTO mt5_deals (account_login, deal_ticket, order_ticket, position_id, time, type, entry, symbol, volume, price, commission)
SELECT 0, ticket * 2, ticket * 2, ticket, open_time, CASE WHEN type = 'buy' THEN 0 ELSE 1 END, 0, symbol, lots, open_price, 0
  FROM trades;
INSERT INTO mt5_deals (account_login, deal_ticket, order_ticket, position_id, time, type, entry, symbol, volume, price, profit, swap, commission)
SELECT 0, ticket * 2 + 1, ticket * 2 + 1, ticket, close_time, CASE WHEN type = 'buy' THEN 1 ELSE 0 END, 1, symbol, lots,
       close_price, profit, swap, commission
  FROM trades;

DROP TABLE trades;

ALTER TABLE settings
  DROP COLUMN mt5_account,
  DROP COLUMN mt5_server,
  DROP COLUMN mt5_status,
  DROP COLUMN mt5_last_sync_at;

-- Closed trades for the Trades page: deals grouped by position (active accounts only).
-- Open = first IN deal; close = last closing deal. Lots = opening volume, so nothing is counted twice.
-- `commission` includes MT5's separate `fee` field.
CREATE VIEW trades AS
SELECT
  d.position_id                                                                     AS ticket,
  d.account_login,
  min(d.symbol)                                                                     AS symbol,
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
GROUP BY d.account_login, d.position_id
HAVING count(*) FILTER (WHERE d.entry <> 0) > 0;
