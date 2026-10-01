export const migration = {
  id: '003_uploads',
  async up(connection) {
    await connection.query('ALTER TABLE listings MODIFY COLUMN title VARCHAR(255) NOT NULL')
    await connection.query(`CREATE TABLE IF NOT EXISTS uploads (
      id            VARCHAR(36) PRIMARY KEY,
      owner_id      VARCHAR(36) NOT NULL,
      listing_id    VARCHAR(36) NULL,
      object_key    VARCHAR(512) NOT NULL,
      public_url    TEXT NOT NULL,
      content_type  VARCHAR(64) NOT NULL,
      byte_size     INT UNSIGNED NOT NULL,
      sha256        CHAR(64) NOT NULL,
      status        ENUM('PENDING','ATTACHED','DELETED') NOT NULL DEFAULT 'PENDING',
      expires_at    DATETIME NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_upload_object_key (object_key),
      INDEX idx_upload_owner_status (owner_id, status, created_at),
      INDEX idx_upload_expiry (status, expires_at),
      INDEX idx_upload_listing (listing_id, status)
    )`)
  }
}
