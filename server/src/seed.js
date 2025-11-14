import crypto from 'node:crypto'
import { pool } from './db.js'

const SAMPLE_PHOTO_BASE = '/sample'

const SAMPLE_USERS = [
  {
    key: 'ownerIrina',
    id: crypto.randomUUID(),
    maxId: 'max.demo.irina',
    phone: '+7 999 111-22-33'
  },
  {
    key: 'ownerAnton',
    id: crypto.randomUUID(),
    maxId: 'max.demo.anton',
    phone: '+7 900 555-66-77'
  }
]

const SAMPLE_LISTINGS = [
  {
    authorKey: 'ownerIrina',
    type: 'LOST',
    category: 'pet',
    title: 'Пропала бордер-колли Мона',
    description: `Белая грудка, гетерохромия (правый глаз голубой). Сбежала утром во дворе дома на Фрунзенской набережной. На ней красный шлейф и адресник с именем.`,
    district: 'Хамовники',
    lat: 55.733,
    lng: 37.5805,
    occurredAt: '2025-11-10T08:30:00+03:00',
    photos: [`${SAMPLE_PHOTO_BASE}/pet-mona.png`, `${SAMPLE_PHOTO_BASE}/pet-mona-close.png`],
    secrets: [
      { question: 'Какой цвет глаз у Моны?', answer: 'Разный, один голубой' },
      { question: 'Что написано на адреснике?', answer: 'Имя MONA и номер телефона' }
    ]
  },
  {
    authorKey: 'ownerIrina',
    type: 'FOUND',
    category: 'electronics',
    title: 'Найден смартфон Samsung у входа в парк Горького',
    description: `Нашла чёрный Samsung Galaxy S23 с силиконовым сиреневым бампером. Экран цел, никаких сколов. Телефон был выключен.`,
    district: 'Парк Горького',
    lat: 55.7293,
    lng: 37.6032,
    occurredAt: '2025-11-11T19:10:00+03:00',
    photos: [`${SAMPLE_PHOTO_BASE}/electronics-phone.png`],
    secrets: [
      { question: 'Какая картинка на обоях экрана?', answer: 'Горный пейзаж в тумане' },
      { question: 'Какой цвет чехла?', answer: 'Сиреневый (лавандовый)' }
    ]
  },
  {
    authorKey: 'ownerAnton',
    type: 'LOST',
    category: 'wear',
    title: 'Потерян рюкзак с документами',
    description: `Тёмно-серый рюкзак Bellroy Transit Workpack. Внутри ноутбук, паспорт и папка с договорами. Исчез во время поездки на МЦК «Лужники».`,
    district: 'Лужники',
    lat: 55.7157,
    lng: 37.5598,
    occurredAt: '2025-11-09T22:15:00+03:00',
    photos: [`${SAMPLE_PHOTO_BASE}/wear-backpack.png`],
    secrets: [
      { question: 'Какой бренд рюкзака?', answer: 'Bellroy' },
      { question: 'Что лежало в маленьком кармане?', answer: 'AirPods и ключи' }
    ]
  },
  {
    authorKey: 'ownerAnton',
    type: 'FOUND',
    category: 'keys',
    title: 'Нашёл связку ключей у входа в «Авиапарк»',
    description: `Связка из трёх ключей: серебристый домофонный, длинный дверной и брелок BMW. На кольце синий карабин и пластиковая бирка с цифрой 804.`,
    district: 'Ходынское поле',
    lat: 55.7895,
    lng: 37.5308,
    occurredAt: '2025-11-12T14:45:00+03:00',
    photos: [`${SAMPLE_PHOTO_BASE}/keys-bmw.png`],
    secrets: [
      { question: 'Что написано на бирке?', answer: '804' },
      { question: 'Какой бренд на брелоке?', answer: 'BMW' }
    ]
  }
]

async function truncateTables() {
  const tables = [
    'chat_messages',
    'chat_members',
    'chats',
    'notifications',
    'volunteer_assignments',
    'matches',
    'secrets',
    'photos',
    'listings',
    'states',
    'users'
  ]
  await pool.query('SET FOREIGN_KEY_CHECKS = 0')
  for (const table of tables) {
    await pool.query(`TRUNCATE TABLE ${table}`)
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1')
}

async function seedUsers() {
  for (const user of SAMPLE_USERS) {
    await pool.query('INSERT INTO users (id, max_id, phone) VALUES (?,?,?)', [user.id, user.maxId, user.phone])
  }

  return SAMPLE_USERS.reduce((acc, user) => {
    acc[user.key] = user.id
    return acc
  }, {})
}

async function seedListings(userMap) {
  for (const sample of SAMPLE_LISTINGS) {
    const listingId = crypto.randomUUID()
    const authorId = userMap[sample.authorKey]
    if (!authorId) {
      throw new Error(`Не найден автор для ключа ${sample.authorKey}`)
    }

    await pool.query(
      `INSERT INTO listings
        (id, author_id, type, category, title, description, lat, lng, district, occurred_at, status)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'ACTIVE')`,
      [
        listingId,
        authorId,
        sample.type,
        sample.category,
        sample.title,
        sample.description,
        sample.lat,
        sample.lng,
        sample.district ?? null,
        sample.occurredAt ? new Date(sample.occurredAt) : null
      ]
    )

    for (const photoUrl of sample.photos ?? []) {
      await pool.query('INSERT INTO photos (id, listing_id, url) VALUES (?,?,?)', [
        crypto.randomUUID(),
        listingId,
        photoUrl
      ])
    }

    for (const secret of sample.secrets ?? []) {
      await pool.query('INSERT INTO secrets (id, listing_id, cipher) VALUES (?,?,?)', [
        crypto.randomUUID(),
        listingId,
        JSON.stringify(secret)
      ])
    }
  }
}

async function seed() {
  console.log('[seed] Чистим таблицы…')
  await truncateTables()
  console.log('[seed] Добавляем пользователей…')
  const userMap = await seedUsers()
  console.log('[seed] Добавляем примерные объявления…')
  await seedListings(userMap)
  console.log('[seed] Готово — примеры загружены.')
}

seed()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('[seed] Ошибка:', error)
    process.exit(1)
  })

