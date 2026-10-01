const API_BASE = import.meta.env.VITE_API_BASE ?? ''

let accessToken = null
let refreshPromise = null

export function setAccessToken(token) {
  accessToken = token || null
}

export async function apiRequest(path, options = {}) {
  const response = await send(path, options)
  if (response.status !== 401 || options.skipRefresh) return response
  const refreshed = await refreshAccessToken()
  if (!refreshed) return response
  return send(path, options)
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = send('/api/v1/auth/refresh', { method: 'POST', skipRefresh: true })
      .then(async response => {
        if (!response.ok) {
          accessToken = null
          return null
        }
        const data = await response.json()
        accessToken = data.accessToken
        return data
      })
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

async function send(path, options) {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' })
}
