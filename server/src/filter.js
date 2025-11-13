const PHONE_REGEX = /(?:\+7|8)?[\s-]?(?:\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g
const CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/g
const LINK_REGEX = /(https?:\/\/|www\.)\S+/gi
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

export function filterChatMessage(text = '') {
  const normalized = text.trim()

  if (!normalized) {
    return { ok: false, reason: 'empty', sanitized: '' }
  }

  if (PHONE_REGEX.test(normalized)) {
    return { ok: false, reason: 'phone_forbidden', sanitized: '' }
  }

  if (CARD_REGEX.test(normalized)) {
    return { ok: false, reason: 'card_forbidden', sanitized: '' }
  }

  if (EMAIL_REGEX.test(normalized)) {
    return { ok: false, reason: 'email_forbidden', sanitized: '' }
  }

  const sanitized = normalized.replace(LINK_REGEX, '[ссылка скрыта]')
  return { ok: true, reason: null, sanitized }
}



