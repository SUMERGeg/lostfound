import cron from 'node-cron';
import { pool } from './db.js';
import { score } from './matching.js';
import crypto from 'node:crypto';

export function startMatchingScheduler() {
  cron.schedule('*/10 * * * *', async () => {
    const [losts] = await pool.query('SELECT * FROM listings WHERE type="LOST" AND status="ACTIVE"');
    const [founds] = await pool.query('SELECT * FROM listings WHERE type="FOUND" AND status="ACTIVE"');

    let created = 0;
    for (const L of losts) {
      for (const F of founds) {
        const s = score(L, F);
        if (s >= 70) {
          try {
            await pool.query(
              'INSERT INTO matches (id,lost_id,found_id,score) VALUES (?,?,?,?)',
              [crypto.randomUUID(), L.id, F.id, s]
            );
            created++;
          } catch { /* уникальная пара — пропускаем */ }
        }
      }
    }
    if (created) console.log(`CRON: new matches ${created}`);
  });
  console.log('[cron] Matching scheduler started (every 10 min)');
}
