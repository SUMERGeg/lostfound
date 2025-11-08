import { pool } from './db.js';

const sql = `
CREATE TABLE IF NOT EXISTS users (
  id           VARCHAR(36) PRIMARY KEY,
  max_id       VARCHAR(64) UNIQUE NOT NULL,
  phone        VARCHAR(32),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listings (
  id           VARCHAR(36) PRIMARY KEY,
  author_id    VARCHAR(36) NOT NULL,
  type         ENUM('LOST','FOUND') NOT NULL,
  category     VARCHAR(64) NOT NULL,
  title        VARCHAR(128) NOT NULL,
  description  TEXT,
  lat          DOUBLE,
  lng          DOUBLE,
  district     VARCHAR(128),
  occurred_at  DATETIME,
  status       ENUM('ACTIVE','CLOSED') DEFAULT 'ACTIVE',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tcs (type, category, status, created_at)
);

CREATE TABLE IF NOT EXISTS photos (
  id          VARCHAR(36) PRIMARY KEY,
  listing_id  VARCHAR(36) NOT NULL,
  url         TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS secrets (
  id          VARCHAR(36) PRIMARY KEY,
  listing_id  VARCHAR(36) NOT NULL,
  cipher      TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches (
  id          VARCHAR(36) PRIMARY KEY,
  lost_id     VARCHAR(36) NOT NULL,
  found_id    VARCHAR(36) NOT NULL,
  score       INT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_pair (lost_id, found_id)
);

CREATE TABLE IF NOT EXISTS states (
  user_id     VARCHAR(36) PRIMARY KEY,
  step        VARCHAR(64) NOT NULL,
  payload     JSON NOT NULL,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
`;

(async () => {
  try {
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const s of statements) await pool.query(s);
    console.log('MIGRATE: done');
    process.exit(0);
  } catch (e) {
    console.error('MIGRATE ERROR', e);
    process.exit(1);
  }
})();

