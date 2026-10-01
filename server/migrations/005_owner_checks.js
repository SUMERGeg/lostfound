export const migration = {
  id: '005_owner_checks',
  async up(connection) {
    await connection.query(`CREATE TABLE IF NOT EXISTS owner_questions (
      id          VARCHAR(36) PRIMARY KEY,
      listing_id  VARCHAR(36) NOT NULL,
      position    TINYINT UNSIGNED NOT NULL,
      prompt      VARCHAR(500) NOT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_owner_question_position (listing_id, position),
      INDEX idx_owner_questions_listing (listing_id)
    )`)
    await connection.query(`CREATE TABLE IF NOT EXISTS owner_checks (
      id             VARCHAR(36) PRIMARY KEY,
      listing_id     VARCHAR(36) NOT NULL,
      holder_id      VARCHAR(36) NOT NULL,
      claimant_id    VARCHAR(36) NOT NULL,
      status         ENUM('PENDING','APPROVED','DECLINED') NOT NULL DEFAULT 'PENDING',
      decided_at     DATETIME NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_owner_check_claimant (listing_id, claimant_id),
      INDEX idx_owner_check_holder (holder_id, status, created_at),
      INDEX idx_owner_check_claimant (claimant_id, status, created_at)
    )`)
    await connection.query(`CREATE TABLE IF NOT EXISTS owner_answers (
      id              VARCHAR(36) PRIMARY KEY,
      owner_check_id  VARCHAR(36) NOT NULL,
      question_id     VARCHAR(36) NOT NULL,
      prompt_snapshot VARCHAR(500) NOT NULL,
      answer_text     VARCHAR(2000) NOT NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_owner_answer_question (owner_check_id, question_id),
      INDEX idx_owner_answers_check (owner_check_id)
    )`)
    await connection.query(`CREATE TABLE IF NOT EXISTS owner_check_contacts (
      owner_check_id  VARCHAR(36) PRIMARY KEY,
      email           VARCHAR(320) NULL,
      phone           VARCHAR(32) NULL,
      telegram        VARCHAR(64) NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`)
  }
}
