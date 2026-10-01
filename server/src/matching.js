export const MATCH_ALGORITHM_VERSION = 'baseline-v1'
export const MATCH_THRESHOLD = 70

export function evaluateMatch(lost, found) {
  const categoryMatches = Boolean(lost?.category && lost.category === found?.category)
  const time = timeComponent(lost?.occurred_at, found?.occurred_at)
  const geo = geoComponent(lost?.lat, lost?.lng, found?.lat, found?.lng)
  const text = textComponent(lost?.title, found?.title)

  const breakdown = {
    category: { score: categoryMatches ? 25 : 0, maximum: 25, matched: categoryMatches },
    time,
    geo,
    text
  }
  const rawScore = Object.values(breakdown).reduce((total, component) => total + component.score, 0)
  const score = categoryMatches ? rawScore : 0

  return {
    score,
    algorithmVersion: MATCH_ALGORITHM_VERSION,
    eligible: categoryMatches,
    breakdown: { ...breakdown, total: score, maximum: 100 }
  }
}

// Compatibility wrapper for legacy callers while new code stores full evaluation metadata.
export function score(lost, found) {
  return evaluateMatch(lost, found).score
}

function timeComponent(left, right) {
  if (left == null || right == null || left === '' || right === '') {
    return { score: 0, maximum: 20, available: false, hoursApart: null }
  }
  const leftTime = new Date(left).getTime()
  const rightTime = new Date(right).getTime()
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return { score: 0, maximum: 20, available: false, hoursApart: null }
  }
  const hoursApart = Math.abs(leftTime - rightTime) / 3600000
  return {
    score: Math.max(0, 20 - Math.min(20, Math.floor(hoursApart / 6))),
    maximum: 20,
    available: true,
    hoursApart: round(hoursApart, 2)
  }
}

function geoComponent(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(value => value == null || value === '')) {
    return { score: 0, maximum: 30, available: false, distanceKm: null }
  }
  const coordinates = [lat1, lon1, lat2, lon2].map(Number)
  if (!coordinates.every(Number.isFinite)) {
    return { score: 0, maximum: 30, available: false, distanceKm: null }
  }
  const distanceKm = haversine(...coordinates)
  let componentScore = 0
  if (distanceKm <= 0.3) componentScore = 30
  else if (distanceKm <= 1) componentScore = 20
  else if (distanceKm <= 3) componentScore = 10
  return { score: componentScore, maximum: 30, available: true, distanceKm: round(distanceKm, 3) }
}

function textComponent(left, right) {
  const leftTokens = tokens(left)
  const rightTokens = new Set(tokens(right))
  const matchedTokens = [...new Set(leftTokens)].filter(token => rightTokens.has(token)).sort()
  return {
    score: Math.min(25, matchedTokens.length * 5),
    maximum: 25,
    available: leftTokens.length > 0 && rightTokens.size > 0,
    matchedTokens
  }
}

function tokens(value = '') {
  return String(value).toLocaleLowerCase('ru-RU').split(/[^a-zа-яё0-9]+/iu).filter(Boolean)
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = value => value * Math.PI / 180
  const earthRadiusKm = 6371
  const latitudeDelta = toRad(lat2 - lat1)
  const longitudeDelta = toRad(lon2 - lon1)
  const haversineValue = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversineValue))
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
