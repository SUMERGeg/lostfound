import { randomUUID } from 'node:crypto'

export function requestContext(req, res, next) {
  const requestId = validRequestId(req.get('x-request-id')) || randomUUID()
  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)
  const startedAt = process.hrtime.bigint()

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    console.log(JSON.stringify({
      level: 'info',
      event: 'http_request',
      requestId,
      method: req.method,
      path: req.originalUrl?.split('?')[0] ?? req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100
    }))
  })
  next()
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
}

export function writeErrorLog(error, req) {
  console.error(JSON.stringify({
    level: 'error',
    event: 'http_error',
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl?.split('?')[0] ?? req.path,
    errorName: error?.name ?? 'Error',
    message: error?.message ?? 'unknown error'
  }))
}

function validRequestId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : null
}
