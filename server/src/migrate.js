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

CREATE TABLE IF NOT EXISTS chats (
  id               VARCHAR(36) PRIMARY KEY,
  lost_listing_id  VARCHAR(36),
  found_listing_id VARCHAR(36),
  initiator_id     VARCHAR(36) NOT NULL,
  holder_id        VARCHAR(36) NOT NULL,
  claimant_id      VARCHAR(36) NOT NULL,
  type ENUM('OWNER_CHECK','DIALOG') NOT NULL,
  status ENUM('PENDING','ACTIVE','DECLINED','CLOSED') DEFAULT 'PENDING',
  last_message_at  TIMESTAMP NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_chats_status (status, updated_at),
  INDEX idx_chats_listings (lost_listing_id, found_listing_id)
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id    VARCHAR(36) NOT NULL,
  user_id    VARCHAR(36) NOT NULL,
  role       ENUM('CLAIMANT','HOLDER','OBSERVER') NOT NULL,
  joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         VARCHAR(36) PRIMARY KEY,
  chat_id    VARCHAR(36) NOT NULL,
  sender_id  VARCHAR(36) NOT NULL,
  body       TEXT,
  meta       JSON,
  status     ENUM('SENT','BLOCKED') DEFAULT 'SENT',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chat_messages_chat (chat_id, created_at)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          VARCHAR(36) PRIMARY KEY,
  user_id     VARCHAR(36) NOT NULL,
  chat_id     VARCHAR(36),
  listing_id  VARCHAR(36),
  type        VARCHAR(64) NOT NULL,
  title       VARCHAR(160),
  body        TEXT,
  payload     JSON,
  status      ENUM('UNREAD','ACTION','READ','RESOLVED','ARCHIVED') DEFAULT 'UNREAD',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  read_at     TIMESTAMP NULL,
  INDEX idx_notifications_user (user_id, status, created_at),
  INDEX idx_notifications_chat (chat_id, status)
);

CREATE TABLE IF NOT EXISTS volunteer_assignments (
  id              VARCHAR(36) PRIMARY KEY,
  listing_id      VARCHAR(36) NOT NULL,
  volunteer_id    VARCHAR(36) NOT NULL,
  status          ENUM('ACTIVE','COMPLETED','CANCELLED') DEFAULT 'ACTIVE',
  owner_notified_at     TIMESTAMP NULL,
  volunteer_notified_at TIMESTAMP NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_assignment (listing_id, volunteer_id),
  INDEX idx_assignment_listing (listing_id, status),
  INDEX idx_assignment_volunteer (volunteer_id, status)
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

