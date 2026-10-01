export const migration = {
  id: '008_user_consents',
  async up(connection) {
    await connection.query(`CREATE TABLE IF NOT EXISTS user_consents (
      id                VARCHAR(36) PRIMARY KEY,
      user_id           VARCHAR(36) NOT NULL,
      consent_type      ENUM('TERMS','PERSONAL_DATA') NOT NULL,
      document_version  VARCHAR(128) NOT NULL,
      accepted_at       DATETIME NOT NULL,
      withdrawn_at      DATETIME NULL,
      source            ENUM('REGISTRATION','RECONSENT','PROFILE') NOT NULL,
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_consents_user_type (user_id, consent_type, accepted_at),
      INDEX idx_user_consents_version (consent_type, document_version)
    )`)
  }
}
