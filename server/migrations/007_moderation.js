export const migration = {
  id: '007_moderation',
  async up(connection) {
    await connection.query("ALTER TABLE listings MODIFY COLUMN status ENUM('ACTIVE','CLOSED','HIDDEN','DELETED') NOT NULL DEFAULT 'ACTIVE'")
    await connection.query(`CREATE TABLE IF NOT EXISTS reports (
      id               VARCHAR(36) PRIMARY KEY,
      reporter_id      VARCHAR(36) NOT NULL,
      listing_id       VARCHAR(36) NOT NULL,
      reason           ENUM('SPAM','FRAUD','INAPPROPRIATE','DUPLICATE','OTHER') NOT NULL,
      details          VARCHAR(2000) NULL,
      status           ENUM('OPEN','IN_REVIEW','RESOLVED','REJECTED') NOT NULL DEFAULT 'OPEN',
      resolution_note  VARCHAR(2000) NULL,
      resolved_by      VARCHAR(36) NULL,
      resolved_at      DATETIME NULL,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_reporter_listing (reporter_id, listing_id),
      INDEX idx_reports_queue (status, created_at),
      INDEX idx_reports_listing (listing_id, status)
    )`)
    await connection.query(`CREATE TABLE IF NOT EXISTS audit_log (
      id           VARCHAR(36) PRIMARY KEY,
      actor_id     VARCHAR(36) NOT NULL,
      action       VARCHAR(128) NOT NULL,
      target_type  VARCHAR(64) NOT NULL,
      target_id    VARCHAR(36) NOT NULL,
      metadata     JSON NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_target (target_type, target_id, created_at),
      INDEX idx_audit_actor (actor_id, created_at)
    )`)
  }
}
