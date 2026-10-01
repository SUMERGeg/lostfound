/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiRequest, refreshAccessToken, setAccessToken } from '../api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    refreshAccessToken().then(data => { if (active && data) setUser(data.user) }).finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [])

  const authenticate = useCallback(async (kind, credentials) => {
      const response = await apiRequest(`/api/v1/auth/${kind}`, { method: 'POST', body: JSON.stringify(credentials), skipRefresh: true })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Не удалось выполнить вход')
      setAccessToken(data.accessToken)
      setUser(data.user)
      return data.user
  }, [])

  const logout = useCallback(async () => {
      await apiRequest('/api/v1/auth/logout', { method: 'POST', skipRefresh: true })
      setAccessToken(null)
      setUser(null)
  }, [])

  const renewSession = useCallback(async () => {
      const data = await refreshAccessToken()
      if (data) setUser(data.user)
      return data?.user ?? null
  }, [])

  const value = useMemo(() => ({ user, ready, authenticate, logout, renewSession }), [authenticate, logout, ready, renewSession, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
