-- Month locking, IB commission, and payouts for clients, the trader and IBs.

-- IB commission rule: a percentage of each client's splittable profit.
ALTER TABLE ibs
  ADD COLUMN commission_percent numeric(5, 2) NOT NULL DEFAULT 0
    CHECK (commission_percent >= 0 AND commission_percent <= 100),
  ADD COLUMN commission_source text NOT NULL DEFAULT 'from_company_share'
    CHECK (commission_source IN ('from_company_share', 'additional'));

-- Month totals frozen at finalization.
ALTER TABLE months
  ADD COLUMN net_profit numeric(16, 2),
  ADD COLUMN total_capital numeric(16, 2),
  ADD COLUMN trading_days integer,
  ADD COLUMN lots numeric(12, 2),
  ADD COLUMN trades integer,
  ADD COLUMN company_adjustment numeric(16, 2),
  ADD COLUMN loss_handling text CHECK (loss_handling IN ('carry_forward', 'reset_monthly'));

-- Every client's numbers for a finalized month. Nothing recomputes these.
CREATE TABLE settlements (
  month          char(7) NOT NULL REFERENCES months (month) ON DELETE CASCADE,
  client_id      text NOT NULL REFERENCES clients (id),
  ib_id          text REFERENCES ibs (id),
  capital        numeric(16, 2) NOT NULL,
  pool_share     numeric(12, 4) NOT NULL,
  active_days    integer NOT NULL,
  split_trader   numeric(5, 2) NOT NULL,
  split_company  numeric(5, 2) NOT NULL,
  split_client   numeric(5, 2) NOT NULL,
  ib_percent     numeric(5, 2) NOT NULL,
  ib_source      text NOT NULL,
  gross          numeric(16, 2) NOT NULL,
  carry_in       numeric(16, 2) NOT NULL,
  carry_out      numeric(16, 2) NOT NULL,
  trader         numeric(16, 2) NOT NULL,
  company        numeric(16, 2) NOT NULL,
  client         numeric(16, 2) NOT NULL,
  ib             numeric(16, 2) NOT NULL,
  PRIMARY KEY (month, client_id)
);

-- One payout table for every party. The trader has party_id 'trader'.
CREATE TABLE payouts_v2 (
  month       char(7) NOT NULL REFERENCES months (month),
  party_type  text NOT NULL CHECK (party_type IN ('client', 'trader', 'ib')),
  party_id    text NOT NULL,
  amount      numeric(16, 2),            -- frozen at finalization
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at     date,
  PRIMARY KEY (month, party_type, party_id)
);
INSERT INTO payouts_v2 (month, party_type, party_id, status, paid_at)
SELECT month, 'client', client_id, status, paid_at FROM payouts;
DROP TABLE payouts;
ALTER TABLE payouts_v2 RENAME TO payouts;
ALTER TABLE payouts RENAME CONSTRAINT payouts_v2_pkey TO payouts_pkey;

ALTER TABLE transactions ADD COLUMN updated_at timestamptz;
