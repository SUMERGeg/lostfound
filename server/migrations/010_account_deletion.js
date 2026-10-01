export const migration = {
  id: '010_account_deletion',
  async up(connection) {
    await connection.query(`CREATE TABLE IF NOT EXISTS account_deletion_jobs (
      id             VARCHAR(36) PRIMARY KEY,
      user_id        VARCHAR(36) NOT NULL,
      status         ENUM('PENDING','COMPLETED') NOT NULL DEFAULT 'PENDING',
      object_count   INT UNSIGNED NOT NULL DEFAULT 0,
      requested_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at   DATETIME NULL,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_account_deletion_user (user_id),
      INDEX idx_account_deletion_status (status, requested_at)
    )`)
    await connection.query(`CREATE TABLE IF NOT EXISTS account_deletion_objects (
      id             VARCHAR(36) PRIMARY KEY,
      job_id         VARCHAR(36) NOT NULL,
      object_key     VARCHAR(512) NOT NULL,
      status         ENUM('PENDING','DELETED') NOT NULL DEFAULT 'PENDING',
      attempt_count  INT UNSIGNED NOT NULL DEFAULT 0,
      available_at   DATETIME NOT NULL,
      locked_at      DATETIME NULL,
      lock_token     VARCHAR(36) NULL,
      last_error     VARCHAR(1000) NULL,
      deleted_at     DATETIME NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_account_deletion_object (object_key),
      INDEX idx_account_deletion_object_pending (status, available_at, locked_at),
      INDEX idx_account_deletion_object_job (job_id, status)
    )`)
  }
}

