export function loadRuntimeConfig(environment = process.env) {
  const nodeEnvironment = environment.NODE_ENV ?? 'development'
  const frontOrigin = environment.FRONT_ORIGIN ?? 'http://localhost:5173'
  const jwtAccessSecret = environment.JWT_ACCESS_SECRET
  const emailTokenSecret = environment.EMAIL_TOKEN_SECRET

  if (typeof jwtAccessSecret !== 'string' || Buffer.byteLength(jwtAccessSecret) < 32) {
    throw new Error('JWT_ACCESS_SECRET must contain at least 32 bytes')
  }
  if (typeof emailTokenSecret !== 'string' || Buffer.byteLength(emailTokenSecret) < 32) {
    throw new Error('EMAIL_TOKEN_SECRET must contain at least 32 bytes')
  }
  if (nodeEnvironment === 'production' && (!environment.EMAIL_API_URL || !environment.EMAIL_API_TOKEN || !environment.EMAIL_FROM)) {
    throw new Error('EMAIL_API_URL, EMAIL_API_TOKEN and EMAIL_FROM are required in production')
  }

  return {
    nodeEnvironment,
    frontOrigin,
    allowedOrigins: nodeEnvironment === 'production'
      ? [frontOrigin]
      : Array.from(new Set([frontOrigin, 'http://localhost:5173'])),
    port: Number(environment.PORT ?? 8080)
  }
}
