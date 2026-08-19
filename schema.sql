-- NEON PATH 12.0.3 · esquema de referência para instalações novas.
-- O server.js também executa migrações idempotentes e preserva bancos antigos.

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  nickname VARCHAR(20) NOT NULL,
  email VARCHAR(160),
  password_hash TEXT,
  ph INTEGER NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  races INTEGER NOT NULL DEFAULT 0,
  bruto_coins INTEGER NOT NULL DEFAULT 15000,
  role VARCHAR(24) NOT NULL DEFAULT 'player',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_nickname_lower ON users(LOWER(nickname));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users(LOWER(email)) WHERE email IS NOT NULL AND email<>'';
CREATE INDEX IF NOT EXISTS idx_users_ph ON users(ph DESC);

CREATE TABLE IF NOT EXISTS race_results (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  nickname VARCHAR(20) NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 8),
  kills INTEGER NOT NULL DEFAULT 0,
  ph_delta INTEGER NOT NULL DEFAULT 0,
  map VARCHAR(40) NOT NULL,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  coins_earned INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  mode VARCHAR(24) NOT NULL DEFAULT 'room',
  character_id INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_results_user_created ON race_results(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS player_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  xp BIGINT NOT NULL DEFAULT 0,
  lifetime_xp BIGINT NOT NULL DEFAULT 0,
  prestige INTEGER NOT NULL DEFAULT 0 CHECK(prestige BETWEEN 0 AND 5),
  character_id INTEGER NOT NULL DEFAULT 1,
  total_wins INTEGER NOT NULL DEFAULT 0,
  total_races INTEGER NOT NULL DEFAULT 0,
  ph INTEGER NOT NULL DEFAULT 1000,
  daily_races INTEGER NOT NULL DEFAULT 0,
  daily_races_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_prestige ON player_profiles(prestige DESC,level DESC,xp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_lifetime_xp ON player_profiles(lifetime_xp DESC);

CREATE TABLE IF NOT EXISTS player_characters (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL CHECK(character_id BETWEEN 1 AND 8),
  unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  selected BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(user_id,character_id)
);

CREATE TABLE IF NOT EXISTS neon_shop_items (
  id SERIAL PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(220),
  type VARCHAR(32) NOT NULL,
  price INTEGER NOT NULL DEFAULT 0 CHECK(price >= 0),
  rarity VARCHAR(24) NOT NULL DEFAULT 'common',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS neon_player_items (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES neon_shop_items(id) ON DELETE CASCADE,
  owned BOOLEAN NOT NULL DEFAULT TRUE,
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(user_id,item_id)
);

CREATE TABLE IF NOT EXISTS bug_reports (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  nickname VARCHAR(20),
  fingerprint VARCHAR(80),
  message TEXT NOT NULL,
  stack TEXT,
  source VARCHAR(80),
  screen VARCHAR(80),
  track VARCHAR(80),
  mode VARCHAR(40),
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_open ON bug_reports(resolved,created_at DESC);
