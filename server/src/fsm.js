const userStates = new Map()

export function setState(userId, state, payload = {}) {
  userStates.set(userId, { state, payload, updatedAt: Date.now() })
}

export function getState(userId) {
  return userStates.get(userId)
}

export function clearState(userId) {
  userStates.delete(userId)
}

export function resetExpiredStates(ttlMs = 1000 * 60 * 30) {
  const now = Date.now()
  for (const [userId, value] of userStates.entries()) {
    if (now - value.updatedAt > ttlMs) {
      userStates.delete(userId)
    }
  }
}

