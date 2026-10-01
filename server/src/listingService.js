import crypto from 'node:crypto'

import pool from './db.js'

export class ListingValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ListingValidationError'
  }
}

export async function createListing(
  { authorId, payload },
  { database = pool, idFactory = crypto.randomUUID } = {}
) {
  const normalized = normalizeListingInput(authorId, payload)
  const connection = await database.getConnection()
  const listingId = idFactory()

  try {
    await connection.beginTransaction()
    await connection.query(
      `INSERT INTO listings
        (id, author_id, type, category, title, description, lat, lng, occurred_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        listingId,
        normalized.authorId,
        normalized.type,
        normalized.category,
        normalized.title,
        normalized.description,
        normalized.lat,
        normalized.lng,
        normalized.occurredAt
      ]
    )

    if (normalized.type === 'FOUND') {
      await upsertContactPreferences(connection, listingId, normalized.contactChannels)
    }

    for (const url of normalized.photos) {
      await connection.query(
        'INSERT INTO photos (id, listing_id, url) VALUES (?,?,?)',
        [idFactory(), listingId, url]
      )
    }

    for (const secret of normalized.secrets) {
      await connection.query(
        'INSERT INTO secrets (id, listing_id, cipher) VALUES (?,?,?)',
        [idFactory(), listingId, JSON.stringify(secret)]
      )
    }

    await connection.commit()
    return listingId
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateListingDescription(
  listingId,
  authorId,
  description,
  { database = pool } = {}
) {
  return updateOwnedFields(
    listingId,
    authorId,
    { description: typeof description === 'string' ? description.trim() : '' },
    { database }
  )
}

export async function updateListingTitle(
  listingId,
  authorId,
  title,
  { database = pool } = {}
) {
  return updateOwnedFields(
    listingId,
    authorId,
    { title: requiredText(title, 'title') },
    { database }
  )
}

export async function updateListingCategory(
  listingId,
  authorId,
  category,
  { database = pool } = {}
) {
  return updateOwnedFields(
    listingId,
    authorId,
    { category: requiredText(category, 'category') },
    { database }
  )
}

export async function updateListingOccurredAt(
  listingId,
  authorId,
  occurredAt,
  { database = pool } = {}
) {
  return updateOwnedFields(
    listingId,
    authorId,
    { occurred_at: formatMysqlDatetime(occurredAt) },
    { database }
  )
}

export async function updateListingLocation(
  listingId,
  authorId,
  lat,
  lng,
  { database = pool } = {}
) {
  return updateOwnedFields(
    listingId,
    authorId,
    { lat: finiteNumberOrNull(lat), lng: finiteNumberOrNull(lng) },
    { database }
  )
}

export async function updateListingDetails(
  listingId,
  authorId,
  payload,
  { database = pool } = {}
) {
  if (Object.hasOwn(payload, 'contactChannels')) {
    return updateListingAndDisclosure(listingId, authorId, payload, { database })
  }
  const fields = {}

  if (Object.hasOwn(payload, 'title')) {
    fields.title = boundedText(payload.title, 'title', 255)
  }
  if (Object.hasOwn(payload, 'category')) {
    fields.category = boundedText(payload.category, 'category', 64)
  }
  if (Object.hasOwn(payload, 'description')) {
    fields.description = optionalBoundedText(payload.description, 'description', 3000)
  }
  if (Object.hasOwn(payload, 'occurredAt')) {
    fields.occurred_at = formatMysqlDatetime(payload.occurredAt)
  }

  const hasLat = Object.hasOwn(payload, 'lat')
  const hasLng = Object.hasOwn(payload, 'lng')
  if (hasLat !== hasLng) {
    throw new ListingValidationError('lat and lng must be updated together')
  }
  if (hasLat) {
    fields.lat = coordinateOrNull(payload.lat, 'latitude', -90, 90)
    fields.lng = coordinateOrNull(payload.lng, 'longitude', -180, 180)
  }

  return updateOwnedFields(listingId, authorId, fields, { database })
}

async function updateListingAndDisclosure(listingId, authorId, payload, { database }) {
  const normalizedListingId = requiredText(listingId, 'listingId')
  const normalizedAuthorId = requiredText(authorId, 'authorId')
  const fields = listingUpdateFields(payload)
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.query(
      `SELECT l.type, u.email, u.phone, u.telegram
       FROM listings l JOIN users u ON u.id = l.author_id
       WHERE l.id = ? AND l.author_id = ? LIMIT 1 FOR UPDATE`,
      [normalizedListingId, normalizedAuthorId]
    )
    if (!rows.length) {
      await connection.rollback()
      return false
    }
    const channels = normalizeContactChannels(rows[0].type, payload.contactChannels, rows[0])
    if (Object.keys(fields).length) {
      const updated = await updateOwnedFields(normalizedListingId, normalizedAuthorId, fields, { database: connection })
      if (!updated) throw new ListingValidationError('listing update failed')
    }
    await upsertContactPreferences(connection, normalizedListingId, channels)
    await connection.commit()
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function listingUpdateFields(payload) {
  const fields = {}
  if (Object.hasOwn(payload, 'title')) fields.title = boundedText(payload.title, 'title', 255)
  if (Object.hasOwn(payload, 'category')) fields.category = boundedText(payload.category, 'category', 64)
  if (Object.hasOwn(payload, 'description')) fields.description = optionalBoundedText(payload.description, 'description', 3000)
  if (Object.hasOwn(payload, 'occurredAt')) fields.occurred_at = formatMysqlDatetime(payload.occurredAt)
  const hasLat = Object.hasOwn(payload, 'lat')
  const hasLng = Object.hasOwn(payload, 'lng')
  if (hasLat !== hasLng) throw new ListingValidationError('lat and lng must be updated together')
  if (hasLat) {
    fields.lat = coordinateOrNull(payload.lat, 'latitude', -90, 90)
    fields.lng = coordinateOrNull(payload.lng, 'longitude', -180, 180)
  }
  return fields
}

export async function setListingStatus(
  listingId,
  authorId,
  status,
  { database = pool } = {}
) {
  const normalizedStatus = requiredText(status, 'status').toUpperCase()
  if (normalizedStatus !== 'ACTIVE' && normalizedStatus !== 'CLOSED') {
    throw new ListingValidationError('status must be ACTIVE or CLOSED')
  }
  return updateOwnedFields(
    listingId,
    authorId,
    { status: normalizedStatus },
    { database }
  )
}

export async function toggleListingStatus(
  listingId,
  authorId,
  { database = pool } = {}
) {
  const normalizedListingId = requiredText(listingId, 'listingId')
  const normalizedAuthorId = requiredText(authorId, 'authorId')
  const connection = await database.getConnection()

  try {
    await connection.beginTransaction()
    const [rows] = await connection.query(
      'SELECT status FROM listings WHERE id = ? AND author_id = ? LIMIT 1 FOR UPDATE',
      [normalizedListingId, normalizedAuthorId]
    )
    if (rows.length === 0) {
      await connection.rollback()
      return null
    }

    const nextStatus = rows[0].status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE'
    const [result] = await connection.query(
      'UPDATE listings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? LIMIT 1',
      [nextStatus, normalizedListingId, normalizedAuthorId]
    )
    if (result.affectedRows === 0) {
      await connection.rollback()
      return null
    }

    await connection.commit()
    return nextStatus
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function replaceListingPhotos(
  listingId,
  authorId,
  photoUrls,
  { database = pool, idFactory = crypto.randomUUID } = {}
) {
  const normalizedListingId = requiredText(listingId, 'listingId')
  const normalizedAuthorId = requiredText(authorId, 'authorId')
  const photos = normalizeArray(photoUrls, 'photos', 3)
    .map(value => requiredText(value, 'photo URL'))
  const connection = await database.getConnection()

  try {
    await connection.beginTransaction()
    const [ownerRows] = await connection.query(
      'SELECT 1 FROM listings WHERE id = ? AND author_id = ? LIMIT 1 FOR UPDATE',
      [normalizedListingId, normalizedAuthorId]
    )
    if (ownerRows.length === 0) {
      await connection.rollback()
      return false
    }

    await connection.query('DELETE FROM photos WHERE listing_id = ?', [normalizedListingId])
    for (const url of photos) {
      await connection.query(
        'INSERT INTO photos (id, listing_id, url) VALUES (?,?,?)',
        [idFactory(), normalizedListingId, url]
      )
    }
    await connection.query(
      'UPDATE listings SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? LIMIT 1',
      [normalizedListingId, normalizedAuthorId]
    )
    await connection.commit()
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function updateOwnedFields(
  listingId,
  authorId,
  fields,
  { database = pool } = {}
) {
  const normalizedListingId = requiredText(listingId, 'listingId')
  const normalizedAuthorId = requiredText(authorId, 'authorId')
  const allowedColumns = new Set([
    'title',
    'description',
    'category',
    'occurred_at',
    'lat',
    'lng',
    'status'
  ])
  const entries = Object.entries(fields)
  if (entries.length === 0 || entries.some(([column]) => !allowedColumns.has(column))) {
    throw new ListingValidationError('unsupported listing update')
  }

  const assignments = entries.map(([column]) => `${column} = ?`)
  const values = entries.map(([, value]) => value)
  const [result] = await database.query(
    `UPDATE listings
     SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND author_id = ?
     LIMIT 1`,
    [...values, normalizedListingId, normalizedAuthorId]
  )
  return result.affectedRows > 0
}

function normalizeListingInput(authorId, payload = {}) {
  const normalizedAuthorId = requiredText(authorId, 'authorId')
  const type = requiredText(payload.type, 'type').toUpperCase()
  if (type !== 'LOST' && type !== 'FOUND') {
    throw new ListingValidationError('type must be LOST or FOUND')
  }

  const category = boundedText(payload.category, 'category', 64)
  const title = boundedText(payload.title, 'title', 255)
  const photos = normalizeArray(payload.photos, 'photos', 3)
    .map(value => requiredText(value, 'photo URL'))
  const secrets = normalizeArray(payload.secrets, 'secrets', 3)
    .filter(value => value !== null && value !== undefined)

  return {
    authorId: normalizedAuthorId,
    type,
    category,
    title,
    description: optionalBoundedText(payload.description, 'description', 3000),
    lat: coordinateOrNull(payload.lat, 'latitude', -90, 90),
    lng: coordinateOrNull(payload.lng, 'longitude', -180, 180),
    occurredAt: formatMysqlDatetime(payload.occurredAt),
    contactChannels: normalizeContactChannels(type, payload.contactChannels),
    photos,
    secrets
  }
}

export function normalizeContactChannels(type, value, availableContacts = null) {
  const normalizedType = String(type ?? '').toUpperCase()
  if (normalizedType !== 'FOUND') {
    if (value !== undefined && (!Array.isArray(value) || value.length)) {
      throw new ListingValidationError('contactChannels are supported only for FOUND listings')
    }
    return []
  }
  if (!Array.isArray(value)) throw new ListingValidationError('contactChannels must be an array')
  const allowed = new Set(['EMAIL', 'PHONE', 'TELEGRAM'])
  const channels = [...new Set(value.map(channel => String(channel ?? '').trim().toUpperCase()))]
  if (!channels.length || channels.some(channel => !allowed.has(channel))) {
    throw new ListingValidationError('select at least one supported contact channel')
  }
  if (availableContacts) {
    const values = {
      EMAIL: availableContacts.email,
      PHONE: availableContacts.phone,
      TELEGRAM: availableContacts.telegram
    }
    if (channels.some(channel => !values[channel])) {
      throw new ListingValidationError('selected contact channel is not configured in the profile')
    }
  }
  return channels
}

async function upsertContactPreferences(connection, listingId, channels) {
  const selected = new Set(channels)
  await connection.query(
    `INSERT INTO listing_contact_preferences
       (listing_id, allow_email, allow_phone, allow_telegram)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       allow_email = VALUES(allow_email),
       allow_phone = VALUES(allow_phone),
       allow_telegram = VALUES(allow_telegram),
       updated_at = CURRENT_TIMESTAMP`,
    [listingId, selected.has('EMAIL'), selected.has('PHONE'), selected.has('TELEGRAM')]
  )
}

function requiredText(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  if (!normalized) {
    throw new ListingValidationError(`${field} is required`)
  }
  return normalized
}

function boundedText(value, field, maxLength) {
  const normalized = requiredText(value, field)
  if (normalized.length > maxLength) {
    throw new ListingValidationError(`${field} must contain at most ${maxLength} characters`)
  }
  return normalized
}

function optionalBoundedText(value, field, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length > maxLength) {
    throw new ListingValidationError(`${field} must contain at most ${maxLength} characters`)
  }
  return normalized
}

function normalizeArray(value, field, limit) {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new ListingValidationError(`${field} must be an array`)
  }
  return value.slice(0, limit)
}

function finiteNumberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new ListingValidationError('coordinates must be finite numbers')
  }
  return number
}

function coordinateOrNull(value, field, minimum, maximum) {
  const number = finiteNumberOrNull(value)
  if (number !== null && (number < minimum || number > maximum)) {
    throw new ListingValidationError(`${field} is outside the valid range`)
  }
  return number
}

function formatMysqlDatetime(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new ListingValidationError('occurredAt must be a valid date')
  }
  return date.toISOString().slice(0, 19).replace('T', ' ')
}
