export const migration = {
  id: '011_privacy_requests',
  async up(connection) {
    await connection.query(`CREATE TABLE IF NOT EXISTS privacy_requests (
      id               VARCHAR(36) PRIMARY KEY,
      user_id          VARCHAR(36) NULL,
      email            VARCHAR(320) NULL,
      request_type     ENUM('ACCESS','CORRECTION','DELETION','WITHDRAW_CONSENT','OTHER') NOT NULL,
      message          VARCHAR(3000) NOT NULL,
      status           ENUM('NEW','IN_PROGRESS','RESOLVED','REJECTED') NOT NULL DEFAULT 'NEW',
      resolution_note  VARCHAR(2000) NULL,
      resolved_by      VARCHAR(36) NULL,
      resolved_at      DATETIME NULL,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_privacy_requests_queue (status, created_at),
      INDEX idx_privacy_requests_user (user_id, created_at),
      INDEX idx_privacy_requests_email (email, created_at)
    )`)
  }
}

