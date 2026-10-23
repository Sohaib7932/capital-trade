-- Per-client MT5 accounts: every client trades in their own account at the broker.
--
-- * A client comes from an IB or is a Direct (company) client: clients.ib_id is optional.
-- * Capital comes from classified balance operations on the client's own accounts
--   (deposit / withdrawal); fee payments mark the client's monthly fee as paid.
-- * Investor passwords are stored only as public-key ciphertext; only the worker can decrypt.
-- * Losses always carry forward per client. IB commissions are kept but switched off.

-- Clients: IB optional (NULL = Direct client of the company).
ALTER TABLE clients ALTER COLUMN ib_id DROP NOT NULL;

-- IB commission rule: percent of client profit (the only type for now), off globally by default.
ALTER TABLE ibs
  ADD COLUMN commission_type text NOT NULL DEFAULT 'percent_of_client_profit'
    CHECK (commission_type IN ('percent_of_client_profit'));

ALTER TABLE settings
  ADD COLUMN ib_commissions_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN sync_interval_seconds integer NOT NULL DEFAULT 300 CHECK (sync_interval_seconds BETWEEN 60 AND 3600);

-- Losses carry forward per client: that is the rule, not a choice.
UPDATE settings SET loss_handling = 'carry_forward';
ALTER TABLE settings ADD CONSTRAINT settings_loss_carry_forward CHECK (loss_handling = 'carry_forward');

-- MT5 accounts: details reported by MT5, the encrypted investor password, and sync state.
-- (is_demo still means "seeded sample data"; `environment` is the broker's demo/live server.)
ALTER TABLE mt5_accounts
  ADD COLUMN environment text NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'demo')),
  ADD COLUMN currency text,
  ADD COLUMN leverage integer,
  -- RSA-OAEP ciphertext ("v1.<key id>.<base64>"). The app can't decrypt it; only the worker's private key can.
  ADD COLUMN investor_password_enc text,
  ADD COLUMN password_updated_at timestamptz,
  -- 'auth' = wrong investor password or server; 'other' = anything else.
  ADD COLUMN last_error_kind text CHECK (last_error_kind IN ('auth', 'other')),
  ADD COLUMN last_attempt_at timestamptz;
UPDATE mt5_accounts SET environment = 'demo' WHERE server ILIKE '%demo%';

-- Balance operations: classified by an admin. Suggested by sign until confirmed.
ALTER TABLE account_cash_events
  ADD COLUMN suggested_class text NOT NULL DEFAULT 'ignore'
    CHECK (suggested_class IN ('deposit', 'withdrawal', 'fee_payment', 'ignore')),
  -- NULL = needs review.
  ADD COLUMN classification text CHECK (classification IN ('deposit', 'withdrawal', 'fee_payment', 'ignore')),
  -- For a fee payment: the month whose fee it pays.
  ADD COLUMN fee_month char(7) CHECK (fee_month ~ '^\d{4}-\d{2}$'),
  ADD CONSTRAINT account_cash_events_fee_month CHECK ((classification = 'fee_payment') = (fee_month IS NOT NULL));
UPDATE account_cash_events
   SET suggested_class = CASE WHEN kind <> 'balance' THEN 'ignore' WHEN amount >= 0 THEN 'deposit' ELSE 'withdrawal' END;
-- Events acknowledged before classification existed changed nothing; keep it that way.
UPDATE account_cash_events SET classification = 'ignore' WHERE reviewed_at IS NOT NULL;

-- Capital: manual entries (pool clients) or generated from a classified cash event.
ALTER TABLE transactions
  ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'mt5')),
  ADD COLUMN account_login bigint,
  ADD COLUMN deal_ticket bigint,
  ADD CONSTRAINT transactions_cash_event_fkey FOREIGN KEY (account_login, deal_ticket)
    REFERENCES account_cash_events (account_login, deal_ticket) ON DELETE CASCADE,
  ADD CONSTRAINT transactions_source_link CHECK ((source = 'mt5') = (deal_ticket IS NOT NULL));
CREATE UNIQUE INDEX transactions_cash_event_idx ON transactions (account_login, deal_ticket) WHERE deal_ticket IS NOT NULL;

-- Payouts: 'fee' = what a client with their own account owes for a finalized month
-- (trader + company [+ IB] share). Fee payments from MT5 add up in paid_amount.
ALTER TABLE payouts DROP CONSTRAINT payouts_v2_party_type_check;
ALTER TABLE payouts
  ADD CONSTRAINT payouts_party_type_check CHECK (party_type IN ('client', 'trader', 'ib', 'fee')),
  ADD COLUMN paid_amount numeric(16, 2) NOT NULL DEFAULT 0,
  -- 'manual' = an admin clicked "Mark paid"; 'mt5' = fee-payment cash events cover the amount.
  ADD COLUMN paid_via text CHECK (paid_via IN ('manual', 'mt5'));
UPDATE payouts SET paid_via = 'manual' WHERE status = 'paid';

CREATE INDEX mt5_accounts_linked_client_idx ON mt5_accounts (linked_client_id);
