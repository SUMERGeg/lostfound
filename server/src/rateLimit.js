export function createRateLimit({ windowMs, max, keyPrefix, now = Date.now } = {}) {
  const attempts = new Map()

  return function rateLimit(req, res, next) {
    const currentTime = now()
    const subject = req.auth?.userId ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    const key = `${keyPrefix}:${subject}`
    const current = attempts.get(key)

    if (!current || current.resetAt <= currentTime) {
      attempts.set(key, { count: 1, resetAt: currentTime + windowMs })
      return next()
    }

    current.count += 1
    if (current.count <= max) return next()

    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((current.resetAt - currentTime) / 1000))))
    return res.status(429).json({ error: 'rate_limited' })
  }
}
