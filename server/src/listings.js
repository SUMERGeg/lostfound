import express from 'express';
import { pool } from './db.js';
import {
  createListing,
  ListingValidationError,
  setListingStatus,
  updateListingDetails
} from './listingService.js';
import { authenticateAccessToken, requireVerifiedEmail } from './auth/middleware.js';
import { attachImages, UploadValidationError } from './uploads/service.js';

export const listings = express.Router();

// GET /listings?type=LOST&category=keys&lat=..&lng=..&radius=2000
listings.get('/', async (req, res) => {
  const { type, category, lat, lng, radius = 5000, limit = 200 } = req.query;
  const params = [];
  let where = 'status="ACTIVE"';

  if (type) { where += ' AND type=?'; params.push(type); }
  if (category) { where += ' AND category=?'; params.push(category); }

  // фильтр по кругу — грубая оценка через bounding box
  if (lat !== undefined || lng !== undefined) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    const radiusMeters = Number(radius);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      return res.status(400).json({ error: 'invalid_geo_filter' });
    }
    const R = Math.min(radiusMeters, 50000) / 111320; // ~ градусы широты
    where += ' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?';
    params.push(latitude-R, latitude+R, longitude-R, longitude+R);
  }

  const pageSize = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);

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
    [...params, pageSize]
  );
  res.json(rows);
});

listings.get('/mine', authenticateAccessToken, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, type, category, title, description, lat, lng, occurred_at,
            status, created_at, updated_at,
            COALESCE((SELECT allow_email FROM listing_contact_preferences WHERE listing_id = listings.id), FALSE) AS allowEmailDisclosure,
            COALESCE((SELECT allow_phone FROM listing_contact_preferences WHERE listing_id = listings.id), FALSE) AS allowPhoneDisclosure,
            COALESCE((SELECT allow_telegram FROM listing_contact_preferences WHERE listing_id = listings.id), FALSE) AS allowTelegramDisclosure,
            (SELECT url FROM photos WHERE listing_id = listings.id ORDER BY created_at ASC LIMIT 1) AS preview_photo
     FROM listings
     WHERE author_id = ?
     ORDER BY created_at DESC`,
    [req.auth.userId]
  );
  res.json(rows);
});

listings.get('/mine/:id', authenticateAccessToken, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, type, category, title, description, lat, lng, occurred_at,
            status, created_at, updated_at,
            COALESCE((SELECT allow_email FROM listing_contact_preferences WHERE listing_id = listings.id), FALSE) AS allowEmailDisclosure,
            COALESCE((SELECT allow_phone FROM listing_contact_preferences WHERE listing_id = listings.id), FALSE) AS allowPhoneDisclosure,
            COALESCE((SELECT allow_telegram FROM listing_contact_preferences WHERE listing_id = listings.id), FALSE) AS allowTelegramDisclosure
     FROM listings
     WHERE id = ? AND author_id = ?
     LIMIT 1`,
    [req.params.id, req.auth.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

listings.get('/:id', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, type, category, title, description, lat, lng, district,
            occurred_at, status, created_at, updated_at
     FROM listings
     WHERE id = ? AND status = 'ACTIVE'
     LIMIT 1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({error:'not found'});
  const [photos] = await pool.query('SELECT url FROM photos WHERE listing_id=?', [req.params.id]);
  res.json({ ...rows[0], photos: photos.map(p=>p.url) });
});

listings.post('/', authenticateAccessToken, requireVerifiedEmail, async (req, res) => {
  const {
    type,
    category,
    title,
    description = '',
    lat = null,
    lng = null,
    occurredAt = null,
    photos = [],
    secrets = [],
    contactChannels = []
  } = req.body;
  try {
    const [contacts] = await pool.query(
      'SELECT email, phone, telegram FROM users WHERE id = ? AND status = \'ACTIVE\' LIMIT 1',
      [req.auth.userId]
    );
    const contact = contacts[0];
    if (!contact || (!contact.email && !contact.phone && !contact.telegram)) {
      return res.status(409).json({ error: 'contact_required', message: 'Add at least one contact in your profile' });
    }
    if (photos.length > 0 || secrets.length > 0) {
      throw new ListingValidationError('photos and owner-check secrets require dedicated protected endpoints');
    }
    if (String(type).toUpperCase() === 'FOUND') {
      const selected = new Set(Array.isArray(contactChannels) ? contactChannels.map(value => String(value).toUpperCase()) : [])
      const values = { EMAIL: contact.email, PHONE: contact.phone, TELEGRAM: contact.telegram }
      if (![...selected].length || [...selected].some(channel => !values[channel])) {
        throw new ListingValidationError('Select at least one contact channel configured in your profile')
      }
    }
    const id = await createListing({
      authorId: req.auth.userId,
      payload: { type, category, title, description, lat, lng, occurredAt, photos, secrets, contactChannels }
    });
    res.status(201).json({ id });
  } catch (error) {
    if (error instanceof ListingValidationError) {
      return res.status(400).json({ error: 'bad payload', message: error.message });
    }
    throw error;
  }
});

listings.patch('/:id', authenticateAccessToken, requireVerifiedEmail, async (req, res) => {
  try {
    const updated = await updateListingDetails(req.params.id, req.auth.userId, req.body);
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof ListingValidationError) {
      return res.status(400).json({ error: 'bad_payload', message: error.message });
    }
    throw error;
  }
});

listings.patch('/:id/close', authenticateAccessToken, requireVerifiedEmail, async (req, res) => {
  const updated = await setListingStatus(req.params.id, req.auth.userId, 'CLOSED');
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json({ ok:true });
});

listings.put('/:id/images', authenticateAccessToken, requireVerifiedEmail, async (req, res) => {
  try {
    const updated = await attachImages({
      ownerId: req.auth.userId,
      listingId: req.params.id,
      uploadIds: req.body.uploadIds
    });
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return res.status(400).json({ error: 'invalid_uploads', message: error.message });
    }
    throw error;
  }
});

export default listings;
