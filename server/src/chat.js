import crypto from 'node:crypto'
import pool from './db.js'

export async function getOrCreateOwnerCheckChat({
  lostListingId,
  foundListingId,
  initiatorId,
  holderId,
  claimantId
}) {
  const [rows] = await pool.query(
    `SELECT * FROM chats
     WHERE lost_listing_id = ? AND found_listing_id = ? AND type = 'OWNER_CHECK' AND status IN ('PENDING','ACTIVE')
     LIMIT 1`,
    [lostListingId, foundListingId]
  )

  if (rows.length > 0) {
    const chat = rows[0]
    await ensureMember(chat.id, claimantId, 'CLAIMANT')
    await ensureMember(chat.id, holderId, 'HOLDER')
    return chat
  }

  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO chats (id, lost_listing_id, found_listing_id, initiator_id, holder_id, claimant_id, type, status)
     VALUES (?,?,?,?,?,?, 'OWNER_CHECK','PENDING')`,
    [id, lostListingId, foundListingId, initiatorId, holderId, claimantId]
  )

  await ensureMember(id, claimantId, 'CLAIMANT')
  await ensureMember(id, holderId, 'HOLDER')

  return {
    id,
    lost_listing_id: lostListingId,
    found_listing_id: foundListingId,
    initiator_id: initiatorId,
    holder_id: holderId,
    claimant_id: claimantId,
    type: 'OWNER_CHECK',
    status: 'PENDING'
  }
}

export async function getOrCreateDialogChat({
  lostListingId,
  foundListingId,
  initiatorId,
  holderId,
  claimantId
}) {
  const [rows] = await pool.query(
    `SELECT * FROM chats
     WHERE lost_listing_id = ? AND found_listing_id = ? AND type = 'DIALOG' AND status IN ('ACTIVE','PENDING')
     LIMIT 1`,
    [lostListingId, foundListingId]
  )

  if (rows.length > 0) {
    const chat = rows[0]
    await ensureMember(chat.id, claimantId, 'CLAIMANT')
    await ensureMember(chat.id, holderId, 'HOLDER')
    return chat
  }

  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO chats (id, lost_listing_id, found_listing_id, initiator_id, holder_id, claimant_id, type, status)
     VALUES (?,?,?,?,?,?, 'DIALOG','ACTIVE')`,
    [id, lostListingId, foundListingId, initiatorId, holderId, claimantId]
  )

  await ensureMember(id, claimantId, 'CLAIMANT')
  await ensureMember(id, holderId, 'HOLDER')

  return {
    id,
    lost_listing_id: lostListingId,
    found_listing_id: foundListingId,
    initiator_id: initiatorId,
    holder_id: holderId,
    claimant_id: claimantId,
    type: 'DIALOG',
    status: 'ACTIVE'
  }
}

export async function ensureMember(chatId, userId, role = 'CLAIMANT') {
  await pool.query(
    `INSERT INTO chat_members (chat_id, user_id, role)
     VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE role = VALUES(role)`,
    [chatId, userId, role]
  )
}

export async function createChatMessage(chatId, senderId, body, meta = {}, status = 'SENT') {
  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO chat_messages (id, chat_id, sender_id, body, meta, status)
     VALUES (?,?,?,?,?,?)`,
    [id, chatId, senderId, body, JSON.stringify(meta ?? {}), status]
  )

  await pool.query(
    `UPDATE chats SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [chatId]
  )

  return id
}

export async function updateChatStatus(chatId, status) {
  await pool.query(
    `UPDATE chats SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, chatId]
  )
}

export async function fetchChatById(chatId) {
  const [rows] = await pool.query(`SELECT * FROM chats WHERE id = ? LIMIT 1`, [chatId])
  return rows[0] ?? null
}

export async function fetchChatMembers(chatId) {
  const [rows] = await pool.query(
    `SELECT cm.chat_id, cm.user_id, cm.role, u.max_id
     FROM chat_members cm
     LEFT JOIN users u ON u.id = cm.user_id
     WHERE cm.chat_id = ?`,
    [chatId]
  )
  return rows
}

export async function appendSystemMessage(chatId, body, meta = {}) {
  return createChatMessage(chatId, 'system', body, { ...meta, system: true })
}


