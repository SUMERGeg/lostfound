export function legacyMutationGuard(req, res, next) {
  const enabled = process.env.ENABLE_LEGACY_MUTATIONS === 'true'
  const production = process.env.NODE_ENV === 'production'

  if (!enabled || production) {
    return res.status(503).json({
      error: 'mutations_unavailable',
      message: 'Web mutations are disabled until standalone authentication is configured.'
    })
  }

  const userId = req.get('x-legacy-user-id')?.trim()
  if (!userId) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Legacy development user header is required.'
    })
  }

  req.auth = { userId, legacyDevelopment: true }
  next()
}
