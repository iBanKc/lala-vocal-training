-- Let's Sing — schema (รันครั้งเดียวใน Neon SQL console หรือผ่าน scripts/run-sql.mjs)

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       TEXT UNIQUE NOT NULL,
  display_name   TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','teacher')),
  xp             INTEGER NOT NULL DEFAULT 0,
  streak_days    INTEGER NOT NULL DEFAULT 0,
  last_practice_date DATE,
  voice_low_midi  INTEGER,
  voice_high_midi INTEGER,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id       TEXT NOT NULL,
  level         INTEGER NOT NULL DEFAULT 1,
  score         INTEGER NOT NULL,
  stars         SMALLINT NOT NULL DEFAULT 0,
  accuracy_pct  REAL,
  avg_cents_off REAL,
  duration_sec  REAL,
  xp_earned     INTEGER NOT NULL DEFAULT 0,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_time ON game_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_time ON game_sessions (created_at DESC);

CREATE TABLE IF NOT EXISTS game_progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    TEXT NOT NULL,
  level      INTEGER NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  best_stars SMALLINT NOT NULL DEFAULT 0,
  plays      INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id, level)
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id  TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);
