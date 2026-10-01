export const migration = {
  id: '009_contact_disclosure',
  async up(connection) {
    await connection.query(`CREATE TABLE IF NOT EXISTS listing_contact_preferences (
      listing_id          VARCHAR(36) PRIMARY KEY,
      allow_email         BOOLEAN NOT NULL DEFAULT FALSE,
      allow_phone         BOOLEAN NOT NULL DEFAULT FALSE,
      allow_telegram      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_contact_preferences_enabled (allow_email, allow_phone, allow_telegram)
    )`)
  }
}
