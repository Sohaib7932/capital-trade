-- Daily profit allocation.
--
-- A "day" is a calendar day in settings.business_timezone. Each day's pool net
-- profit (closed trades) is shared across clients in proportion to the capital
-- each had active that day. Rows are rebuilt for open months only.

ALTER TABLE settings
  ADD COLUMN loss_handling text NOT NULL DEFAULT 'carry_forward'
    CHECK (loss_handling IN ('carry_forward', 'reset_monthly')),
  ADD COLUMN business_timezone text NOT NULL DEFAULT 'Asia/Karachi';

COMMENT ON COLUMN transactions.date IS
  'Effective date. A deposit earns from the next day; a withdrawal stops earning on this day.';

-- One row per business day that had closed trades.
CREATE TABLE daily_pnl (
  day           date PRIMARY KEY,
  month         char(7) NOT NULL,
  net           numeric(16, 2) NOT NULL,  -- profit + swap + commission
  lots          numeric(12, 2) NOT NULL,
  trades        integer NOT NULL,
  pool_capital  numeric(16, 2) NOT NULL DEFAULT 0  -- all clients' active capital that day
);
CREATE INDEX daily_pnl_month_idx ON daily_pnl (month);

-- Each client's unrounded share of a day's net profit.
CREATE TABLE daily_allocations (
  day           date NOT NULL REFERENCES daily_pnl (day) ON DELETE CASCADE,
  client_id     text NOT NULL REFERENCES clients (id),
  month         char(7) NOT NULL,
  capital       numeric(16, 2) NOT NULL,   -- client's active capital that day
  gross         numeric(34, 16) NOT NULL,  -- net * capital / pool_capital, not rounded
  PRIMARY KEY (day, client_id)
);
CREATE INDEX daily_allocations_month_client_idx ON daily_allocations (month, client_id);

CREATE INDEX transactions_date_idx ON transactions (date);
