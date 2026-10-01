import { randomUUID } from 'node:crypto'
import pool from '../db.js'
import { insertNotification, NotificationStatus, NotificationType } from '../notifications.js'

export class OwnerCheckError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export async function replaceOwnerQuestions({ listingId, holderId, prompts }, { database = pool } = {}) {
  if (!Array.isArray(prompts) || prompts.length < 1 || prompts.length > 3) {
    throw new OwnerCheckError('invalid_questions', 'Provide between one and three questions')
  }
  const normalized = prompts.map((prompt, index) => boundedText(prompt, `question ${index + 1}`, 500))
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [listings] = await connection.query(
      "SELECT 1 FROM listings WHERE id = ? AND author_id = ? AND type = 'FOUND' AND status = 'ACTIVE' LIMIT 1 FOR UPDATE",
      [listingId, holderId]
    )
    if (!listings.length) {
      await connection.rollback()
      return false
    }
    const [checks] = await connection.query(
      "SELECT 1 FROM owner_checks WHERE listing_id = ? AND status IN ('PENDING','APPROVED') LIMIT 1",
      [listingId]
    )
    if (checks.length) throw new OwnerCheckError('questions_locked', 'Questions cannot change after a claim is submitted', 409)
    await connection.query('DELETE FROM owner_questions WHERE listing_id = ?', [listingId])
    for (let index = 0; index < normalized.length; index += 1) {
      await connection.query(
        'INSERT INTO owner_questions (id, listing_id, position, prompt) VALUES (?, ?, ?, ?)',
        [randomUUID(), listingId, index + 1, normalized[index]]
      )
    }
    await connection.commit()
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function getPublicQuestions({ listingId, claimantId }, { database = pool } = {}) {
  const [listings] = await database.query(
    "SELECT author_id FROM listings WHERE id = ? AND type = 'FOUND' AND status = 'ACTIVE' LIMIT 1",
    [listingId]
  )
  if (!listings.length) throw new OwnerCheckError('not_found', 'Advertisement not found', 404)
  if (listings[0].author_id === claimantId) throw new OwnerCheckError('self_claim', 'You cannot claim your own advertisement', 409)
  const [rows] = await database.query(
    'SELECT id, prompt, position FROM owner_questions WHERE listing_id = ? ORDER BY position ASC',
    [listingId]
  )
  if (!rows.length) throw new OwnerCheckError('owner_check_unavailable', 'Owner check is not configured', 409)
  return rows
}

export async function submitOwnerCheck({ listingId, claimantId, answers }, { database = pool } = {}) {
  if (!Array.isArray(answers)) throw new OwnerCheckError('invalid_answers', 'Answers are required')
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [listings] = await connection.query(
      "SELECT author_id FROM listings WHERE id = ? AND type = 'FOUND' AND status = 'ACTIVE' LIMIT 1 FOR UPDATE",
      [listingId]
    )
    const listing = listings[0]
    if (!listing) throw new OwnerCheckError('not_found', 'Advertisement not found', 404)
    if (listing.author_id === claimantId) throw new OwnerCheckError('self_claim', 'You cannot claim your own advertisement', 409)
    const [questions] = await connection.query(
      'SELECT id, prompt FROM owner_questions WHERE listing_id = ? ORDER BY position ASC FOR UPDATE',
      [listingId]
    )
    if (!questions.length || answers.length !== questions.length) {
      throw new OwnerCheckError('invalid_answers', 'Every owner question must be answered')
    }
    const byQuestion = new Map(answers.map(answer => [answer.questionId, answer.answer]))
    const checkId = randomUUID()
    await connection.query(
      'INSERT INTO owner_checks (id, listing_id, holder_id, claimant_id) VALUES (?, ?, ?, ?)',
      [checkId, listingId, listing.author_id, claimantId]
    )
    for (const question of questions) {
      if (!byQuestion.has(question.id)) throw new OwnerCheckError('invalid_answers', 'Every owner question must be answered')
      await connection.query(
        `INSERT INTO owner_answers
          (id, owner_check_id, question_id, prompt_snapshot, answer_text)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), checkId, question.id, question.prompt, boundedText(byQuestion.get(question.id), 'answer', 2000)]
      )
    }
    await insertNotification(connection, {
      userId: listing.author_id,
      type: NotificationType.OWNER_REVIEW,
      title: 'Новая заявка на найденную вещь',
      body: 'Проверьте ответы заявителя.',
      status: NotificationStatus.ACTION,
      listingId,
      payload: { ownerCheckId: checkId }
    })
    await connection.commit()
    return checkId
  } catch (error) {
    await connection.rollback()
    if (error?.code === 'ER_DUP_ENTRY') throw new OwnerCheckError('claim_exists', 'A claim already exists', 409)
    throw error
  } finally {
    connection.release()
  }
}

export async function decideOwnerCheck({ checkId, holderId, decision }, { database = pool } = {}) {
  const status = String(decision ?? '').toUpperCase()
  if (!['APPROVED', 'DECLINED'].includes(status)) throw new OwnerCheckError('invalid_decision', 'Decision must be APPROVED or DECLINED')
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [checks] = await connection.query(
      "SELECT listing_id FROM owner_checks WHERE id = ? AND holder_id = ? AND status = 'PENDING' LIMIT 1 FOR UPDATE",
      [checkId, holderId]
    )
    if (!checks.length) {
      await connection.rollback()
      return false
    }
    await connection.query(
      'UPDATE owner_checks SET status = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND holder_id = ?',
      [status, checkId, holderId]
    )
    if (status === 'APPROVED') {
      const [contacts] = await connection.query(
        `SELECT u.email, u.phone, u.telegram,
                p.allow_email, p.allow_phone, p.allow_telegram
         FROM users u
         JOIN listing_contact_preferences p ON p.listing_id = ?
         WHERE u.id = ? AND u.status = 'ACTIVE' LIMIT 1`,
        [checks[0].listing_id, holderId]
      )
      const contact = contacts[0] ?? {}
      const disclosed = {
        email: contact.allow_email ? contact.email : null,
        phone: contact.allow_phone ? contact.phone : null,
        telegram: contact.allow_telegram ? contact.telegram : null
      }
      if (!disclosed.email && !disclosed.phone && !disclosed.telegram) {
        throw new OwnerCheckError('contact_disclosure_unconfigured', 'Select at least one available contact before approval', 409)
      }
      await connection.query(
        `INSERT INTO owner_check_contacts (owner_check_id, email, phone, telegram)
         VALUES (?, ?, ?, ?)`,
        [checkId, disclosed.email, disclosed.phone, disclosed.telegram]
      )
      await connection.query("UPDATE listings SET status = 'CLOSED' WHERE id = ? AND author_id = ?", [checks[0].listing_id, holderId])
    }
    const [participants] = await connection.query(
      'SELECT claimant_id FROM owner_checks WHERE id = ? LIMIT 1',
      [checkId]
    )
    await insertNotification(connection, {
      userId: participants[0].claimant_id,
      type: status === 'APPROVED' ? NotificationType.OWNER_APPROVED : NotificationType.OWNER_DECLINED,
      title: status === 'APPROVED' ? 'Владелец подтверждён' : 'Заявка отклонена',
      body: status === 'APPROVED' ? 'Контакты автора теперь доступны.' : 'Автор объявления не подтвердил заявку.',
      status: NotificationStatus.UNREAD,
      listingId: checks[0].listing_id,
      payload: { ownerCheckId: checkId }
    })
    await connection.commit()
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function getOwnerCheckContacts({ checkId, userId }, { database = pool } = {}) {
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.query(
      `SELECT oc.listing_id, c.email, c.phone, c.telegram
       FROM owner_checks oc
       JOIN owner_check_contacts c ON c.owner_check_id = oc.id
       WHERE oc.id = ? AND oc.status = 'APPROVED'
         AND (oc.holder_id = ? OR oc.claimant_id = ?)
       LIMIT 1 FOR UPDATE`,
      [checkId, userId, userId]
    )
    if (!rows.length) throw new OwnerCheckError('contacts_unavailable', 'Contacts are not available', 403)
    const row = rows[0]
    const contactTypes = contactTypesFrom(row)
    await connection.query(
      `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, metadata)
       VALUES (?, ?, 'CONTACT_DISCLOSED', 'OWNER_CHECK', ?, ?)`,
      [randomUUID(), userId, checkId, JSON.stringify({ listingId: row.listing_id, contactTypes })]
    )
    await connection.commit()
    return { email: row.email, phone: row.phone, telegram: row.telegram }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listOwnerChecks(userId, { database = pool } = {}) {
  const [rows] = await database.query(
    `SELECT oc.id, oc.listing_id AS listingId, oc.holder_id AS holderId,
            oc.claimant_id AS claimantId, oc.status, oc.created_at AS createdAt,
            l.title, l.type
     FROM owner_checks oc
     JOIN listings l ON l.id = oc.listing_id
     WHERE oc.holder_id = ? OR oc.claimant_id = ?
     ORDER BY oc.created_at DESC`,
    [userId, userId]
  )
  return rows
}

export async function getOwnerCheck(checkId, userId, { database = pool } = {}) {
  const [checks] = await database.query(
    `SELECT oc.id, oc.listing_id AS listingId, oc.holder_id AS holderId,
            oc.claimant_id AS claimantId, oc.status, l.title,
            COALESCE(p.allow_email, FALSE) AS allowEmail,
            COALESCE(p.allow_phone, FALSE) AS allowPhone,
            COALESCE(p.allow_telegram, FALSE) AS allowTelegram
     FROM owner_checks oc JOIN listings l ON l.id = oc.listing_id
     LEFT JOIN listing_contact_preferences p ON p.listing_id = l.id
     WHERE oc.id = ? AND (oc.holder_id = ? OR oc.claimant_id = ?) LIMIT 1`,
    [checkId, userId, userId]
  )
  if (!checks.length) throw new OwnerCheckError('not_found', 'Owner check not found', 404)
  const [answers] = await database.query(
    'SELECT prompt_snapshot AS prompt, answer_text AS answer FROM owner_answers WHERE owner_check_id = ? ORDER BY created_at ASC',
    [checkId]
  )
  const check = checks[0]
  return {
    id: check.id,
    listingId: check.listingId,
    holderId: check.holderId,
    claimantId: check.claimantId,
    status: check.status,
    title: check.title,
    contactTypes: contactTypesFrom({
      email: check.allowEmail,
      phone: check.allowPhone,
      telegram: check.allowTelegram
    }),
    answers
  }
}

function contactTypesFrom(contact) {
  return [
    contact.email ? 'EMAIL' : null,
    contact.phone ? 'PHONE' : null,
    contact.telegram ? 'TELEGRAM' : null
  ].filter(Boolean)
}

function boundedText(value, field, maximum) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > maximum) throw new OwnerCheckError('invalid_text', `${field} is required and must contain at most ${maximum} characters`)
  return normalized
}
