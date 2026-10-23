-- Initial schema for CapitalTrade Advisor.
-- Money and prices are NUMERIC (exact). The app reads them as strings.

CREATE TABLE ibs (
  id          text PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  phone       text NOT NULL,
  email       text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  joined_at   date NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id             text PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  full_name      text NOT NULL,
  phone          text NOT NULL,
  email          text NOT NULL,
  ib_id          text NOT NULL REFERENCES ibs (id),
  joined_at      date NOT NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  split_trader   numeric(5, 2) NOT NULL CHECK (split_trader >= 0),
  split_company  numeric(5, 2) NOT NULL CHECK (split_company >= 0),
  split_client   numeric(5, 2) NOT NULL CHECK (split_client >= 0),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_split_total CHECK (split_trader + split_company + split_client = 100)
);
CREATE INDEX clients_ib_id_idx ON clients (ib_id);

CREATE TABLE transactions (
  id          text PRIMARY KEY,
  client_id   text NOT NULL REFERENCES clients (id),
  type        text NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
  amount      numeric(14, 2) NOT NULL CHECK (amount > 0),
  date        date NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transactions_client_id_idx ON transactions (client_id);

-- Closed MT5 deals, upserted by ticket.
CREATE TABLE trades (
  ticket       bigint PRIMARY KEY,
  symbol       text NOT NULL,
  type         text NOT NULL CHECK (type IN ('buy', 'sell')),
  lots         numeric(10, 2) NOT NULL,
  open_time    timestamptz NOT NULL,
  close_time   timestamptz NOT NULL,
  open_price   numeric(12, 2) NOT NULL,
  close_price  numeric(12, 2) NOT NULL,
  profit       numeric(14, 2) NOT NULL,
  swap         numeric(14, 2) NOT NULL DEFAULT 0,
  commission   numeric(14, 2) NOT NULL DEFAULT 0
);
CREATE INDEX trades_close_time_idx ON trades (close_time);

CREATE TABLE months (
  month         char(7) PRIMARY KEY CHECK (month ~ '^\d{4}-\d{2}$'),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finalized')),
  finalized_at  date
);

CREATE TABLE payouts (
  month      char(7) NOT NULL REFERENCES months (month),
  client_id  text NOT NULL REFERENCES clients (id),
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at    date,
  PRIMARY KEY (month, client_id)
);

-- Single-row table.
CREATE TABLE settings (
  id                 int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  split_trader       numeric(5, 2) NOT NULL DEFAULT 30,
  split_company      numeric(5, 2) NOT NULL DEFAULT 5,
  split_client       numeric(5, 2) NOT NULL DEFAULT 65,
  mt5_account        text NOT NULL DEFAULT '',
  mt5_server         text NOT NULL DEFAULT '',
  mt5_status         text NOT NULL DEFAULT 'disconnected' CHECK (mt5_status IN ('connected', 'disconnected')),
  mt5_last_sync_at   timestamptz,
  CONSTRAINT settings_split_total CHECK (split_trader + split_company + split_client = 100)
);

CREATE TABLE admin_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  email          text NOT NULL,
  role           text NOT NULL DEFAULT 'Administrator',
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_users_email_idx ON admin_users (lower(email));

-- Only a SHA-256 of the session token is stored; the token itself lives in the cookie.
CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
