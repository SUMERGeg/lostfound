export const migration = {
  id: '006_matching_v1',
  async up(connection) {
    if (!(await columnExists(connection, 'matches', 'algorithm_version'))) {
      await connection.query("ALTER TABLE matches ADD COLUMN algorithm_version VARCHAR(64) NOT NULL DEFAULT 'legacy-v0' AFTER score")
    }
    if (!(await columnExists(connection, 'matches', 'score_breakdown'))) {
      await connection.query('ALTER TABLE matches ADD COLUMN score_breakdown JSON NULL AFTER algorithm_version')
    }
    if (!(await columnExists(connection, 'matches', 'updated_at'))) {
      await connection.query('ALTER TABLE matches ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at')
    }
    if (!(await indexExists(connection, 'matches', 'idx_matches_version_score'))) {
      await connection.query('CREATE INDEX idx_matches_version_score ON matches (algorithm_version, score, created_at)')
    }
    await connection.query(`CREATE TABLE IF NOT EXISTS match_feedback (
      id          VARCHAR(36) PRIMARY KEY,
      match_id    VARCHAR(36) NOT NULL,
      user_id     VARCHAR(36) NOT NULL,
      feedback    ENUM('CONFIRMED','SIMILAR_NOT_MINE','NOT_RELEVANT') NOT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_match_feedback_user (match_id, user_id),
      INDEX idx_match_feedback_dataset (feedback, created_at),
      INDEX idx_match_feedback_user (user_id, created_at)
    )`)
  }
}

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [tableName, columnName]
  )
  return rows.length > 0
}

async function indexExists(connection, tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [tableName, indexName]
  )
  return rows.length > 0
}
