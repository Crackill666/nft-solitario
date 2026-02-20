-- D1 migration: historial + rate-limit
-- Ejecutar en D1 Console (Cloudflare) o con wrangler d1 execute --remote.

CREATE TABLE IF NOT EXISTS scores (
  wallet TEXT NOT NULL,
  day TEXT NOT NULL,
  score INTEGER NOT NULL,
  moves INTEGER NOT NULL,
  time_seconds INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (wallet, day)
);

CREATE TABLE IF NOT EXISTS score_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  day TEXT NOT NULL,
  score INTEGER NOT NULL,
  moves INTEGER NOT NULL,
  time_seconds INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_score_runs_wallet ON score_runs(wallet);
CREATE INDEX IF NOT EXISTS idx_score_runs_day ON score_runs(day);
CREATE INDEX IF NOT EXISTS idx_score_runs_wallet_day ON score_runs(wallet, day);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);

CREATE INDEX IF NOT EXISTS idx_scores_day_score ON scores(day, score);

CREATE TABLE IF NOT EXISTS auth_nonces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  nonce TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  used_at_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wallet, nonce)
);

CREATE INDEX IF NOT EXISTS idx_auth_nonces_wallet_created ON auth_nonces(wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires ON auth_nonces(expires_at_ms);
