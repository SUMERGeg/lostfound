import { assetUrl, deployment } from './deployment.js'

// Static hosts use demo builds. Ordinary builds keep the real API.
export const isDemo = deployment.isDemo

export const demoListings = [
  {
    id: 'demo-mona', type: 'LOST', category: 'pet',
    title: 'Пропала бордер-колли Мона',
    description: 'Белая грудка, один глаз голубой. Последний раз её видели на прогулке у Фрунзенской набережной. На ней красная шлейка. Это вымышленный пример для демонстрации сервиса.',
    location_note: 'Фрунзенская набережная, район Хамовники',
    lat: 55.733, lng: 37.5805,
    occurred_at: '2026-10-01T08:30:00+03:00', created_at: '2026-10-01T09:00:00+03:00',
    photos: ['/sample/pet-mona.png', '/sample/pet-mona-close.png'],
    mapPosition: [46, 54]
  },
  {
    id: 'demo-phone', type: 'FOUND', category: 'electronics',
    title: 'Найден смартфон у входа в парк Горького',
    description: 'Чёрный смартфон в сиреневом чехле. Экран цел, телефон был выключен. В рабочем сервисе владелец сможет подтвердить принадлежность вещи, ответив на вопросы. Это демонстрационное объявление.',
    location_note: 'Главный вход в парк Горького',
    lat: 55.7293, lng: 37.6032,
    occurred_at: '2026-09-30T19:10:00+03:00', created_at: '2026-09-30T20:00:00+03:00',
    photos: ['/sample/electronics-phone.png'], mapPosition: [66, 59]
  },
  {
    id: 'demo-backpack-lost', type: 'LOST', category: 'wear',
    title: 'Потерян рюкзак с документами',
    description: 'Тёмно-серый рюкзак Bellroy потерян во время поездки на МЦК «Лужники». В настоящем сервисе поиск подберёт похожие находки поблизости. Объявление создано только для демонстрации.',
    location_note: 'Станция МЦК «Лужники»',
    lat: 55.7157, lng: 37.5598,
    occurred_at: '2026-09-29T22:15:00+03:00', created_at: '2026-09-30T08:00:00+03:00',
    photos: ['/sample/wear-backpack.png'], mapPosition: [29, 74]
  },
  {
    id: 'demo-keys', type: 'FOUND', category: 'keys',
    title: 'Найдена связка ключей у «Авиапарка»',
    description: 'Три ключа на кольце с синим карабином и автомобильным брелоком. В рабочей версии контакты откроются после проверки владельца. Это вымышленный пример, а не реальная находка.',
    location_note: 'Ходынское поле, вход в торговый центр',
    lat: 55.7895, lng: 37.5308,
    occurred_at: '2026-09-30T14:45:00+03:00', created_at: '2026-09-30T15:00:00+03:00',
    photos: ['/sample/keys-bmw.png'], mapPosition: [25, 22]
  },
  {
    id: 'demo-backpack-found', type: 'FOUND', category: 'wear',
    title: 'Найден тёмно-серый рюкзак Bellroy',
    description: 'Рюкзак найден рядом со станцией МЦК «Лужники». Внешние признаки совпадают с примером объявления о пропаже. Содержимое не публикуется. Это демонстрационный пример возможного совпадения.',
    location_note: 'Рядом со станцией МЦК «Лужники»',
    lat: 55.7159, lng: 37.5601,
    occurred_at: '2026-09-29T23:00:00+03:00', created_at: '2026-09-30T08:30:00+03:00',
    photos: ['/sample/wear-backpack.png'], mapPosition: [37, 70]
  }
].map(item => {
  const photos = Object.freeze(item.photos.map(photo => assetUrl(photo)))
  return Object.freeze({ ...item, status: 'ACTIVE', preview_photo: photos[0], photos, mapPosition: Object.freeze(item.mapPosition) })
})
Object.freeze(demoListings)

export function getDemoListings({ type = '', category = '' } = {}) {
  return demoListings.filter(item => (!type || item.type === type) && (!category || item.category === category))
}

export function isDemoPath(path) {
  return ['/', '/ads', '/map', '/privacy', '/terms', '/personal-data-consent', '/publication-rules'].includes(path.replace(/\/$/, '') || '/') || /^\/(ads|listing)\/[^/]+\/?$/.test(path)
}

export async function demoRequest(path, options = {}) {
  options.signal?.throwIfAborted()
  const method = String(options.method || 'GET').toUpperCase()
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  // Never forward any demo request to a live server, even if an API URL is configured.
  if (method !== 'GET') return json({ error: 'demo_read_only', message: 'Демонстрационная версия доступна только для просмотра.' }, 403)
  const url = new URL(path, 'https://demo.invalid')
  if (url.pathname === '/api/v1/ads') {
    const items = getDemoListings({ type: url.searchParams.get('type'), category: url.searchParams.get('category') })
    const limit = Number(url.searchParams.get('limit'))
    return json(limit > 0 && Number.isFinite(limit) ? items.slice(0, Math.floor(limit)) : items)
  }
  const detail = url.pathname.match(/^\/api\/v1\/ads\/([^/]+)$/)
  if (detail) {
    const item = demoListings.find(listing => listing.id === detail[1])
    return item ? json(item) : json({ error: 'not_found' }, 404)
  }
  if (url.pathname === '/api/v1/privacy-requests/config') return json({ privacyEmail: '[PRIVACY_EMAIL]' })
  return json({ error: 'not_found' }, 404)
}
