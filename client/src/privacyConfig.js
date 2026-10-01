import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

const FALLBACK_PRIVACY_EMAIL = '[PRIVACY_EMAIL]'
let cachedEmail = FALLBACK_PRIVACY_EMAIL
let requestPromise = null

export function isPrivacyEmailConfigured(email) {
  return Boolean(email && !email.startsWith('['))
}

export function replacePrivacyEmail(value, email) {
  return value.replaceAll(FALLBACK_PRIVACY_EMAIL, email || FALLBACK_PRIVACY_EMAIL)
}

export function usePrivacyEmail() {
  const [email, setEmail] = useState(cachedEmail)

  useEffect(() => {
    let active = true
    if (!requestPromise) {
      requestPromise = apiRequest('/api/v1/privacy-requests/config', { skipRefresh: true })
        .then(async response => response.ok ? response.json() : null)
        .then(data => {
          cachedEmail = data?.privacyEmail || FALLBACK_PRIVACY_EMAIL
          return cachedEmail
        })
        .catch(() => FALLBACK_PRIVACY_EMAIL)
    }
    requestPromise.then(value => { if (active) setEmail(value) })
    return () => { active = false }
  }, [])

  return email
}
