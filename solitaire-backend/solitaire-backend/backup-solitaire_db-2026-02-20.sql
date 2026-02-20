PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE scores (wallet TEXT NOT NULL, day TEXT NOT NULL, score INTEGER NOT NULL, moves INTEGER NOT NULL, time_seconds INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (wallet, day));
INSERT INTO "scores" VALUES('0x1111111111111111111111111111111111111111','2026-02-10',123,45,120,'2026-02-11 02:01:39','2026-02-11 02:01:39');
INSERT INTO "scores" VALUES('0xa1e301d606f5492e58f615a4fa12e0855ac96326','2026-02-11',4488,166,541,'2026-02-11 18:35:58','2026-02-11 18:35:58');
CREATE TABLE score_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  day TEXT NOT NULL,
  score INTEGER NOT NULL,
  moves INTEGER NOT NULL,
  time_seconds INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO "score_runs" VALUES(1,'0xa1e301d606f5492e58f615a4fa12e0855ac96326','2026-02-11',1234,50,120,'b082f225644f422490ce224ab595c63b3e1f44e21c16c4daa7a92e0e87d9cd6e','2026-02-11 18:35:58');
INSERT INTO "score_runs" VALUES(2,'0xa1e301d606f5492e58f615a4fa12e0855ac96326','2026-02-11',2234,55,120,'b082f225644f422490ce224ab595c63b3e1f44e21c16c4daa7a92e0e87d9cd6e','2026-02-11 18:37:07');
INSERT INTO "score_runs" VALUES(3,'0xa1e301d606f5492e58f615a4fa12e0855ac96326','2026-02-11',4488,166,541,'b082f225644f422490ce224ab595c63b3e1f44e21c16c4daa7a92e0e87d9cd6e','2026-02-11 20:27:14');
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
INSERT INTO "rate_limits" VALUES('ip:2800:810:807:18:fc2e:6808:e3cb:13ea',1770841200000,1);
INSERT INTO "rate_limits" VALUES('wallet:0xa1e301d606f5492e58f615a4fa12e0855ac96326',1770841200000,1);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" VALUES('score_runs',3);
CREATE INDEX idx_scores_day_score ON scores(day, score DESC, updated_at ASC);
CREATE INDEX idx_score_runs_wallet ON score_runs(wallet);
CREATE INDEX idx_score_runs_day ON score_runs(day);
CREATE INDEX idx_score_runs_wallet_day ON score_runs(wallet, day);
CREATE INDEX idx_rate_limits_window_start ON rate_limits(window_start);
