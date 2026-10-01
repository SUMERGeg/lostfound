import { AuthError } from './errors.js'

export const CONSENT_TYPES = Object.freeze({
  TERMS: 'TERMS',
  PERSONAL_DATA: 'PERSONAL_DATA'
})

export const CURRENT_CONSENT_VERSIONS = Object.freeze({
  [CONSENT_TYPES.TERMS]: 'terms-draft-2026-08-13.1',
  [CONSENT_TYPES.PERSONAL_DATA]: 'personal-data-draft-2026-08-13.1'
})

export function validateRegistrationConsents(value) {
  if (!Array.isArray(value)) {
    throw new AuthError('consents_required', 'Terms and personal data consent are required')
  }

  const acceptedByType = new Map()
  for (const consent of value) {
    const type = String(consent?.type ?? '').trim().toUpperCase()
    if (!Object.hasOwn(CURRENT_CONSENT_VERSIONS, type) || acceptedByType.has(type)) {
      throw new AuthError('invalid_consents', 'Registration consents are invalid')
    }
    acceptedByType.set(type, consent)
  }

  return Object.entries(CURRENT_CONSENT_VERSIONS).map(([type, documentVersion]) => {
    const consent = acceptedByType.get(type)
    if (consent?.accepted !== true) {
      const code = type === CONSENT_TYPES.TERMS
        ? 'terms_consent_required'
        : 'personal_data_consent_required'
      throw new AuthError(code, `${type} consent is required`)
    }
    if (consent.documentVersion !== documentVersion) {
      throw new AuthError('consent_version_outdated', `${type} document version is outdated`)
    }
    return { type, documentVersion }
  })
}
