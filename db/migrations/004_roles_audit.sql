-- Roles, audit log and login rate limiting.

UPDATE admin_users SET role = 'admin';
ALTER TABLE admin_users
  ALTER COLUMN role SET DEFAULT 'admin',
  ADD CONSTRAINT admin_users_role_check CHECK (role IN ('admin', 'viewer'));

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  user_id      uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  user_email   text NOT NULL,
  action       text NOT NULL,      -- e.g. 'client.create', 'month.finalize'
  entity_type  text NOT NULL,
  entity_id    text,
  summary      text NOT NULL,
  details      jsonb
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, at DESC);

CREATE TABLE login_attempts (
  id       bigserial PRIMARY KEY,
  email    text NOT NULL,
  ip       text NOT NULL,
  at       timestamptz NOT NULL DEFAULT now(),
  success  boolean NOT NULL
);
CREATE INDEX login_attempts_lookup_idx ON login_attempts (lower(email), ip, at DESC);

CREATE INDEX trades_type_close_time_idx ON trades (type, close_time);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
