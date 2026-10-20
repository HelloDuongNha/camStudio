CREATE TABLE IF NOT EXISTS studio_users (
  id UUID PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_logins (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_logins_expiry ON studio_logins(expires_at);
CREATE TABLE IF NOT EXISTS studio_oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS studio_pairings (
  user_id UUID PRIMARY KEY REFERENCES studio_users(id) ON DELETE CASCADE,
  room TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
