import express from 'express';
import { pool } from './db.js';
import crypto from 'node:crypto';

export const listings = express.Router();

// GET /listings?type=LOST&category=keys&lat=..&lng=..&radius=2000
listings.get('/', async (req, res) => {
  const { type, category, lat, lng, radius = 5000, limit = 200 } = req.query;
  const params = [];
  let where = 'status="ACTIVE"';

  if (type) { where += ' AND type=?'; params.push(type); }
  if (category) { where += ' AND category=?'; params.push(category); }

  // фильтр по кругу — грубая оценка через bounding box
  if (lat && lng) {
    const R = Number(radius) / 111320; // ~ градусы широты
    where += ' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?';
    params.push(Number(lat)-R, Number(lat)+R, Number(lng)-R, Number(lng)+R);
  }

  const [rows] = await pool.query(
    `SELECT
       id,
       type,
       category,
       title,
       description,
       lat,
       lng,
       occurred_at,
       created_at,
       (
         SELECT url
         FROM photos
         WHERE listing_id = listings.id
         ORDER BY created_at ASC
         LIMIT 1
       ) AS preview_photo
     FROM listings
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ?`,
    [...params, Number(limit)]
  );
  res.json(rows);
});

listings.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM listings WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({error:'not found'});
  const [photos] = await pool.query('SELECT url FROM photos WHERE listing_id=?', [req.params.id]);
  res.json({ ...rows[0], photos: photos.map(p=>p.url) });
});

listings.post('/', async (req, res) => {
  const {
    authorId,
    type,
    category,
    title,
    description = '',
    lat = null,
    lng = null,
    occurredAt = null,
    photos = [],
    secrets = []
  } = req.body;
  if (!authorId || !type || !category || !title) return res.status(400).json({error:'bad payload'});
  const id = crypto.randomUUID();

  await pool.query(
    'INSERT INTO listings (id, author_id, type, category, title, description, lat, lng, occurred_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, authorId, type, category, title, description, lat, lng, occurredAt]
  );

  for (const url of photos) {
    await pool.query('INSERT INTO photos (id, listing_id, url) VALUES (?,?,?)',
      [crypto.randomUUID(), id, url]);
  }

  for (const secret of Array.isArray(secrets) ? secrets : []) {
    if (!secret) continue;
    await pool.query(
      'INSERT INTO secrets (id, listing_id, cipher) VALUES (?,?,?)',
      [crypto.randomUUID(), id, JSON.stringify(secret)]
    );
  }
  res.json({ id });
});

listings.patch('/:id/close', async (req, res) => {
  await pool.query('UPDATE listings SET status="CLOSED" WHERE id=?', [req.params.id]);
  res.json({ ok:true });
});

export default listings;
