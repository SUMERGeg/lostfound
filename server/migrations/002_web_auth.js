const columnMigrations = [
  ['email', 'ALTER TABLE users ADD COLUMN email VARCHAR(320) NULL AFTER max_id'],
  ['password_hash', 'ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER email'],
  ['display_name', 'ALTER TABLE users ADD COLUMN display_name VARCHAR(120) NULL AFTER password_hash'],
  ['telegram', 'ALTER TABLE users ADD COLUMN telegram VARCHAR(64) NULL AFTER phone'],
  ['status', "ALTER TABLE users ADD COLUMN status ENUM('ACTIVE','BLOCKED','DELETED') NOT NULL DEFAULT 'ACTIVE' AFTER telegram"],
  ['role', "ALTER TABLE users ADD COLUMN role ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER' AFTER status"],
  ['email_verified_at', 'ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP NULL AFTER role'],
  ['updated_at', 'ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at']
]

const tableStatements = [
  `CREATE TABLE IF NOT EXISTS refresh_sessions (
    id              VARCHAR(36) PRIMARY KEY,
    user_id         VARCHAR(36) NOT NULL,
    token_hash      CHAR(64) NOT NULL,
    family_id       VARCHAR(36) NOT NULL,
    expires_at      DATETIME NOT NULL,
    revoked_at      DATETIME NULL,
    replaced_by_id  VARCHAR(36) NULL,
    user_agent      VARCHAR(512) NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_refresh_token_hash (token_hash),
    INDEX idx_refresh_user_active (user_id, revoked_at, expires_at),
    INDEX idx_refresh_family (family_id)
  )`,
  `CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id          VARCHAR(36) PRIMARY KEY,
    user_id     VARCHAR(36) NOT NULL,
    token_hash  CHAR(64) NOT NULL,
    expires_at  DATETIME NOT NULL,
    used_at     DATETIME NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_email_verification_hash (token_hash),
    INDEX idx_email_verification_user (user_id, used_at, expires_at)
  )`,
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          VARCHAR(36) PRIMARY KEY,
    user_id     VARCHAR(36) NOT NULL,
    token_hash  CHAR(64) NOT NULL,
    expires_at  DATETIME NOT NULL,
    used_at     DATETIME NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_password_reset_hash (token_hash),
    INDEX idx_password_reset_user (user_id, used_at, expires_at)
  )`,
  `CREATE TABLE IF NOT EXISTS outbox_events (
    id             VARCHAR(36) PRIMARY KEY,
    event_type     VARCHAR(128) NOT NULL,
    aggregate_type VARCHAR(64) NULL,
    aggregate_id   VARCHAR(36) NULL,
    payload        JSON NOT NULL,
    available_at   DATETIME NOT NULL,
    attempt_count  INT NOT NULL DEFAULT 0,
    processed_at   DATETIME NULL,
    last_error     TEXT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_outbox_pending (processed_at, available_at)
  )`
]

export const migration = {
  id: '002_web_auth',
  async up(connection) {
    await connection.query('ALTER TABLE users MODIFY COLUMN max_id VARCHAR(64) NULL')

    for (const [columnName, statement] of columnMigrations) {
      if (!(await columnExists(connection, 'users', columnName))) {
        await connection.query(statement)
      }
    }

    if (!(await indexExists(connection, 'users', 'uniq_users_email'))) {
      await connection.query('CREATE UNIQUE INDEX uniq_users_email ON users (email)')
    }

    for (const statement of tableStatements) {
      await connection.query(statement)
    }
  }
}

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
     LIMIT 1`,
    [tableName, columnName]
  )
  return rows.length > 0
}

async function indexExists(connection, tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?
     LIMIT 1`,
    [tableName, indexName]
  )
  return rows.length > 0
}
