import 'dotenv/config'
import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3307),
  user: process.env.DB_USER ?? 'dev',
  password: process.env.DB_PASSWORD ?? 'dev',
  database: process.env.DB_NAME ?? 'lostfound',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
})

export async function withConnection(callback) {
  const connection = await pool.getConnection()
  try {
    return await callback(connection)
  } finally {
    connection.release()
  }
}

export { pool }
export default pool

