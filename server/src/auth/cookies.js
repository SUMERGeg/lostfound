export const REFRESH_COOKIE_NAME = 'lf_refresh'

export function readCookie(header, name = REFRESH_COOKIE_NAME) {
  if (typeof header !== 'string') return null
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=')
    if (separator < 0) continue
    const key = pair.slice(0, separator).trim()
    if (key === name) return decodeURIComponent(pair.slice(separator + 1).trim())
  }
  return null
}

export function refreshCookie(token, { production = process.env.NODE_ENV === 'production' } = {}) {
  const attributes = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/v1/auth',
    `Max-Age=${30 * 24 * 60 * 60}`
  ]
  if (production) attributes.push('Secure')
  return attributes.join('; ')
}

export function clearRefreshCookie({ production = process.env.NODE_ENV === 'production' } = {}) {
  const attributes = [
    `${REFRESH_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/v1/auth',
    'Max-Age=0'
  ]
  if (production) attributes.push('Secure')
  return attributes.join('; ')
}
