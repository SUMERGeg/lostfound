import crypto from 'node:crypto';
import { pool } from './db.js';

const categories = ['keys','phone','wallet','document','pet','bag'];
const rnd = (a,b)=> a + Math.random()*(b-a);

async function seed() {
  // один тест-пользователь
  const userId = crypto.randomUUID();
  await pool.query(
    'INSERT IGNORE INTO users (id, max_id, phone) VALUES (?,?,?)',
    [userId, 'peer_demo_1', '+70000000000']
  );

  // 20 объявлений по Москве-центр (меняй координаты на свои)
  for (let i=0;i<20;i++){
    const id = crypto.randomUUID();
    const type = i%2===0 ? 'LOST' : 'FOUND';
    const category = categories[i%categories.length];
    const title = type==='LOST' ? `Потеряно: ${category}` : `Найдено: ${category}`;
    const lat = rnd(55.73, 55.78);
    const lng = rnd(37.58, 37.68);
    const occurred_at = new Date(Date.now()- (i*3600*1000));
    await pool.query(
      'INSERT IGNORE INTO listings (id, author_id, type, category, title, description, lat, lng, occurred_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, userId, type, category, title, 'demo', lat, lng, occurred_at]
    );
  }
  console.log('SEED: done');
}

seed().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});

