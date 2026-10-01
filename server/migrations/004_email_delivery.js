export const migration = {
  id: '004_email_delivery',
  async up(connection) {
    if (!(await columnExists(connection, 'outbox_events', 'locked_at'))) {
      await connection.query('ALTER TABLE outbox_events ADD COLUMN locked_at DATETIME NULL AFTER available_at')
    }
    if (!(await columnExists(connection, 'outbox_events', 'lock_token'))) {
      await connection.query('ALTER TABLE outbox_events ADD COLUMN lock_token VARCHAR(36) NULL AFTER locked_at')
    }
    if (!(await columnExists(connection, 'users', 'auth_version'))) {
      await connection.query('ALTER TABLE users ADD COLUMN auth_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER email_verified_at')
    }
    // Accounts created before verification existed are grandfathered to avoid an accidental lockout.
    await connection.query(
      `UPDATE users
       SET email_verified_at = created_at
       WHERE email IS NOT NULL
         AND password_hash IS NOT NULL
         AND email_verified_at IS NULL`
    )
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
