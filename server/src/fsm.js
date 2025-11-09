import { Keyboard } from '@maxhub/max-bot-api'
import pool from './db.js'
import { ensureUser } from './users.js'

const { inlineKeyboard, button } = Keyboard

const FRONT_URL = process.env.FRONT_ORIGIN || 'http://localhost:5173'

export const FLOWS = {
  LOST: 'lost',
  FOUND: 'found'
}

export const STEPS = {
  IDLE: 'idle',
  LOST_CATEGORY: 'lost_category',
  LOST_ATTRIBUTES: 'lost_attributes',
  LOST_PHOTO: 'lost_photo',
  LOST_LOCATION: 'lost_location',
  LOST_SECRETS: 'lost_secrets',
  LOST_CONFIRM: 'lost_confirm',
  FOUND_CATEGORY: 'found_category',
  FOUND_ATTRIBUTES: 'found_attributes',
  FOUND_PHOTO: 'found_photo',
  FOUND_LOCATION: 'found_location',
  FOUND_SECRETS: 'found_secrets',
  FOUND_CONFIRM: 'found_confirm'
}

const FLOW_STEP_MAP = {
  [FLOWS.LOST]: {
    CATEGORY: STEPS.LOST_CATEGORY,
    ATTRIBUTES: STEPS.LOST_ATTRIBUTES,
    PHOTO: STEPS.LOST_PHOTO,
    LOCATION: STEPS.LOST_LOCATION,
    SECRETS: STEPS.LOST_SECRETS,
    CONFIRM: STEPS.LOST_CONFIRM
  },
  [FLOWS.FOUND]: {
    CATEGORY: STEPS.FOUND_CATEGORY,
    ATTRIBUTES: STEPS.FOUND_ATTRIBUTES,
    PHOTO: STEPS.FOUND_PHOTO,
    LOCATION: STEPS.FOUND_LOCATION,
    SECRETS: STEPS.FOUND_SECRETS,
    CONFIRM: STEPS.FOUND_CONFIRM
  }
}

const STEP_TO_FLOW = Object.entries(FLOW_STEP_MAP).reduce((acc, [flow, mapping]) => {
  Object.values(mapping).forEach(step => {
    acc[step] = flow
  })
  return acc
}, {})

const FLOW_START_STEP = {
  [FLOWS.LOST]: FLOW_STEP_MAP[FLOWS.LOST].CATEGORY,
  [FLOWS.FOUND]: FLOW_STEP_MAP[FLOWS.FOUND].CATEGORY
}

const CATEGORY_OPTIONS = [
  { id: 'pet', title: 'Животное', emoji: '🐾' },
  { id: 'phone', title: 'Электроника', emoji: '📱' },
  { id: 'bag', title: 'Сумка/аксессуар', emoji: '🎒' },
  { id: 'document', title: 'Документы', emoji: '📄' },
  { id: 'keys', title: 'Ключи', emoji: '🔑' },
  { id: 'wallet', title: 'Ценности', emoji: '💍' }
]

const FLOW_KEYWORDS = {
  [FLOWS.LOST]: ['потерял', 'потеряла', 'потеряли', '/lost'],
  [FLOWS.FOUND]: ['нашёл', 'нашел', 'нашла', 'нашли', '/found']
}

const CANCEL_KEYWORDS = ['/cancel', 'отмена']

const FLOW_COPY = {
  [FLOWS.LOST]: {
    emoji: '🆘',
    label: 'Потерял',
    categoryPrompt: 'Что потерялось? Выберите категорию — так мы подберём правильные вопросы.',
    attributesPrompt: 'Опишите предмет: бренд, цвет, приметы. Можно перечислить несколькими предложениями.',
    locationPrompt: 'Где и когда это произошло? Напишите адрес, ориентиры и время. Можно прикрепить геопозицию.',
    secretsPrompt: 'Придумайте до трёх секретных признаков (каждый с новой строки). Если хотите пропустить, напишите /skip.',
    secretsLabel: 'Секреты',
    confirmPrompt: 'Проверьте данные перед публикацией. Скоро добавим автоматическое создание объявления.',
    summaryTitle: 'Черновик «Потерял»'
  },
  [FLOWS.FOUND]: {
    emoji: '📦',
    label: 'Нашёл',
    categoryPrompt: 'Что нашлось? Выберите категорию, чтобы подсказать владельцу.',
    attributesPrompt: 'Опишите находку безопасно: без серийников и уникальных меток. Добавьте, в каком состоянии она находится.',
    locationPrompt: 'Где нашли предмет и где храните сейчас? Для безопасности укажите район/ориентир.',
    secretsPrompt: 'Задайте до трёх вопросов для владельца (каждый с новой строки). Пример: «Какой брелок был на рюкзаке?»',
    secretsLabel: 'Вопросы',
    confirmPrompt: 'Проверьте карточку перед публикацией. Дальше добавим owner-check и уведомления.',
    summaryTitle: 'Черновик «Нашёл»'
  }
}

const StepHandlers = {
  [STEPS.LOST_CATEGORY]: createCategoryHandler(FLOWS.LOST),
  [STEPS.LOST_ATTRIBUTES]: createAttributesHandler(FLOWS.LOST),
  [STEPS.LOST_PHOTO]: createPhotoHandler(FLOWS.LOST),
  [STEPS.LOST_LOCATION]: createLocationHandler(FLOWS.LOST),
  [STEPS.LOST_SECRETS]: createSecretsHandler(FLOWS.LOST),
  [STEPS.LOST_CONFIRM]: createConfirmHandler(FLOWS.LOST),
  [STEPS.FOUND_CATEGORY]: createCategoryHandler(FLOWS.FOUND),
  [STEPS.FOUND_ATTRIBUTES]: createAttributesHandler(FLOWS.FOUND),
  [STEPS.FOUND_PHOTO]: createPhotoHandler(FLOWS.FOUND),
  [STEPS.FOUND_LOCATION]: createLocationHandler(FLOWS.FOUND),
  [STEPS.FOUND_SECRETS]: createSecretsHandler(FLOWS.FOUND),
  [STEPS.FOUND_CONFIRM]: createConfirmHandler(FLOWS.FOUND)
}

export function buildMainMenuKeyboard() {
  return inlineKeyboard([
    [
      button.callback('🆘 Потерял', buildFlowPayload(FLOWS.LOST, 'start')),
      button.callback('📦 Нашёл', buildFlowPayload(FLOWS.FOUND, 'start'))
    ],
    [
      button.link('🗺️ Открыть карту', FRONT_URL)
    ]
  ])
}

export async function sendMainMenu(ctx, intro = 'Выберите действие:') {
  await ctx.reply(intro, {
    attachments: [buildMainMenuKeyboard()]
  })
}

export async function handleMessage(ctx) {
  const rawText = ctx.message?.body?.text ?? ''
  const text = rawText.trim()
  const lower = text.toLowerCase()
  const location = ctx.location ?? null

  try {
    const userProfile = await resolveUser(ctx)
    const record = await fetchStateRecord(userProfile.userId)
    const runtime = createRuntime(userProfile, record)

    if (lower === '/start') {
      return
    }

    if (CANCEL_KEYWORDS.includes(lower)) {
      await clearStateRecord(userProfile.userId)
      await ctx.reply('Диалог остановлен. Возвращаемся в главное меню.', {
        attachments: [buildMainMenuKeyboard()]
      })
      return
    }

    if (runtime.step === STEPS.IDLE) {
      if (matchesFlowKeyword(lower, FLOWS.LOST)) {
        await ctx.reply('Запускаем сценарий «Потерял».')
        await startFlow(ctx, FLOWS.LOST, userProfile)
        return
      }

      if (matchesFlowKeyword(lower, FLOWS.FOUND)) {
        await ctx.reply('Запускаем сценарий «Нашёл».')
        await startFlow(ctx, FLOWS.FOUND, userProfile)
        return
      }

      if (!text) {
        await sendMainMenu(ctx)
        return
      }

      await ctx.reply('Пока я понимаю только выбор из меню. Нажмите кнопку «Потерял» или «Нашёл».', {
        attachments: [buildMainMenuKeyboard()]
      })
      return
    }

    const handler = StepHandlers[runtime.step]

    if (!handler || !handler.onMessage) {
      await ctx.reply('Этот шаг ещё не реализован. Напишите /cancel, чтобы начать заново.')
      return
    }

    await handler.onMessage(ctx, runtime, { text, lower, location })
  } catch (error) {
    console.error('[FSM] Ошибка обработки сообщения:', error)
    await ctx.reply('Произошла ошибка. Попробуйте снова или введите /cancel.')
  }
}

export async function handleCallback(ctx) {
  const rawPayload = ctx.callback?.payload
  const parsed = parseFlowPayload(rawPayload)

  if (!parsed) {
    await safeAnswerOnCallback(ctx, { notification: 'Неизвестное действие' })
    return
  }

  const { flow, action, value } = parsed

  try {
    const userProfile = await resolveUser(ctx)

    if (action === 'start') {
      await safeAnswerOnCallback(ctx, { notification: `Сценарий «${FLOW_COPY[flow]?.label ?? flow}»` })
      await startFlow(ctx, flow, userProfile)
      return
    }

    if (action === 'menu') {
      await clearStateRecord(userProfile.userId)
      await safeAnswerOnCallback(ctx, { notification: 'Главное меню' })
      await sendMainMenu(ctx)
      return
    }

    if (action === 'cancel') {
      await clearStateRecord(userProfile.userId)
      await safeAnswerOnCallback(ctx, { notification: 'Сценарий отменён' })
      await ctx.reply('Ок, ничего не публикуем. Возвращаемся в меню.', {
        attachments: [buildMainMenuKeyboard()]
      })
      return
    }

    const record = await fetchStateRecord(userProfile.userId)
    const runtime = createRuntime(userProfile, record)

    if (runtime.step === STEPS.IDLE) {
      await safeAnswerOnCallback(ctx, { notification: 'Сначала выберите сценарий' })
      await sendMainMenu(ctx)
      return
    }

    if (runtime.flow !== flow) {
      await safeAnswerOnCallback(ctx, { notification: 'Этот шаг относится к другому сценарию. Введите /cancel.' })
      return
    }

    const handler = StepHandlers[runtime.step]

    if (!handler || !handler.onCallback) {
      await safeAnswerOnCallback(ctx, { notification: 'Для этого шага нет обработчика кнопок' })
      return
    }

    await handler.onCallback(ctx, runtime, parsed)
  } catch (error) {
    console.error('[FSM] Ошибка обработки callback:', error)
    await safeAnswerOnCallback(ctx, { notification: 'Что-то пошло не так, попробуйте позже' })
  }
}

async function startFlow(ctx, flow, userProfile) {
  if (!FLOW_COPY[flow]) {
    await ctx.reply('Этот сценарий ещё в разработке.')
    return
  }

  await clearStateRecord(userProfile.userId)

  const payload = createInitialPayload(flow)
  await transitionToStep(ctx, userProfile, FLOW_START_STEP[flow], payload, { withIntro: true })
}

function createCategoryHandler(flow) {
  const config = FLOW_COPY[flow]

  return {
    enter: async ctx => {
      await ctx.reply(
        `${config.emoji} ${config.label}\n\n${config.categoryPrompt}`,
        { attachments: [buildCategoryKeyboard(flow)] }
      )
    },
    onMessage: async ctx => {
      await ctx.reply('Используйте кнопки, чтобы выбрать категорию.')
    },
    onCallback: async (ctx, runtime, parsed) => {
      const option = CATEGORY_OPTIONS.find(item => item.id === parsed.value)

      if (!option) {
        await safeAnswerOnCallback(ctx, { notification: 'Незнакомая категория' })
        return
      }

      const nextPayload = withListing(runtime, listing => {
        listing.category = option.id
      })

      await safeAnswerOnCallback(ctx, { notification: `${option.emoji} ${option.title}` })
      await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].ATTRIBUTES, nextPayload)
    }
  }
}

function createAttributesHandler(flow) {
  const config = FLOW_COPY[flow]

  return {
    enter: async ctx => {
      await ctx.reply(
        `${config.emoji} Шаг 2/6 — описание\n\n${config.attributesPrompt}`
      )
    },
    onMessage: async (ctx, runtime, message) => {
      if (!message.text || message.text.length < 5) {
        await ctx.reply('Нужно чуть подробнее. Добавьте хотя бы пару слов об особенностях.')
        return
      }

      const nextPayload = withListing(runtime, listing => {
        listing.details = message.text
      })

      await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].PHOTO, nextPayload)
    }
  }
}

function createPhotoHandler(flow) {
  return {
    enter: async (ctx, runtime) => {
      await ctx.reply('📸 Шаг с загрузкой фото ещё в разработке, поэтому мы сразу перейдём далее.')
      await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].LOCATION, runtime.payload, { skipIntro: true })
    },
    onMessage: async () => {
      // до внедрения загрузки фото ничего не делаем
    }
  }
}

function createLocationHandler(flow) {
  const config = FLOW_COPY[flow]

  return {
    enter: async ctx => {
      await ctx.reply(
        `${config.emoji} Шаг 4/6 — локация и время\n\n${config.locationPrompt}`
      )
    },
    onMessage: async (ctx, runtime, message) => {
      if (!message.text && !message.location) {
        await ctx.reply('Укажите место текстом или пришлите геопозицию.')
        return
      }

      const nextPayload = withListing(runtime, listing => {
        listing.locationNote = message.text ?? listing.locationNote ?? ''
        if (message.location) {
          listing.location = {
            latitude: message.location.latitude,
            longitude: message.location.longitude,
            precision: 'point'
          }
        }
      })

      await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].SECRETS, nextPayload)
    }
  }
}

function createSecretsHandler(flow) {
  const config = FLOW_COPY[flow]

  return {
    enter: async ctx => {
      await ctx.reply(
        `${config.emoji} Шаг 5/6 — ${config.secretsLabel.toLowerCase()}\n\n${config.secretsPrompt}`
      )
    },
    onMessage: async (ctx, runtime, message) => {
      const lower = message.lower

      const secrets = lower === '/skip'
        ? []
        : splitSecrets(message.text || '').slice(0, 3)

      const nextPayload = withListing(runtime, listing => {
        listing.secrets = secrets
      })

      await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].CONFIRM, nextPayload)
    }
  }
}

function createConfirmHandler(flow) {
  const config = FLOW_COPY[flow]

  return {
    enter: async (ctx, runtime) => {
      const listing = runtime.payload?.listing ?? {}
      const categoryLabel = describeCategory(listing.category)
      const secretsLabel = config.secretsLabel

      const summaryLines = [
        `Категория: ${categoryLabel}`,
        `Описание: ${listing.details || '—'}`,
        listing.location
          ? `Координаты: ${listing.location.latitude?.toFixed?.(5) ?? '?'}°, ${listing.location.longitude?.toFixed?.(5) ?? '?'}°`
          : `Координаты: —`,
        `Локация (текст): ${listing.locationNote || '—'}`,
        `${secretsLabel}: ${
          listing.secrets?.length
            ? '\n - ' + listing.secrets.map(item => item.replace(/\s+/g, ' ').trim()).join('\n - ')
            : '—'
        }`
      ]

      await ctx.reply(
        `${config.emoji} Шаг 6/6 — подтверждение\n\n${config.summaryTitle}\n\n${summaryLines.join('\n')}`,
        { attachments: [buildConfirmKeyboard(flow)] }
      )
    },
    onCallback: async (ctx, runtime, parsed) => {
      if (parsed.action !== 'confirm') {
        await safeAnswerOnCallback(ctx, { notification: 'Действие недоступно' })
        return
      }

      if (parsed.value === 'publish') {
        await safeAnswerOnCallback(ctx, { notification: 'Скоро' })
        await ctx.reply('Публикация объявлений подключим на следующем этапе. Пока черновик очищен.')
        await clearStateRecord(runtime.user.userId)
        await sendMainMenu(ctx, 'Готово. Вернулись в меню.')
        return
      }

      if (parsed.value === 'edit') {
        await safeAnswerOnCallback(ctx, { notification: 'Вернёмся к описанию' })
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[runtime.flow].ATTRIBUTES, runtime.payload)
        return
      }

      await safeAnswerOnCallback(ctx, { notification: 'Неизвестное действие' })
    }
  }
}

function buildCategoryKeyboard(flow) {
  const buttons = CATEGORY_OPTIONS.map(option =>
    button.callback(`${option.emoji} ${option.title}`, buildFlowPayload(flow, 'category', option.id))
  )

  const rows = []
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2))
  }

  rows.push([button.callback('❌ Отменить', buildFlowPayload(flow, 'cancel'))])

  return inlineKeyboard(rows)
}

function buildConfirmKeyboard(flow) {
  return inlineKeyboard([
    [button.callback('✅ Завершить (скоро)', buildFlowPayload(flow, 'confirm', 'publish'))],
    [
      button.callback('✏️ Изменить описание', buildFlowPayload(flow, 'confirm', 'edit')),
      button.callback('❌ Отменить', buildFlowPayload(flow, 'cancel'))
    ],
    [button.callback('⬅️ Главное меню', buildFlowPayload(flow, 'menu'))]
  ])
}

function buildFlowPayload(flow, action, value = '') {
  const parts = ['flow', flow, action]
  if (value) {
    parts.push(value)
  }
  return parts.join(':')
}

function describeCategory(categoryId) {
  if (!categoryId) {
    return '—'
  }
  const option = CATEGORY_OPTIONS.find(item => item.id === categoryId)
  return option ? `${option.emoji} ${option.title}` : categoryId
}

function matchesFlowKeyword(lower, flow) {
  return FLOW_KEYWORDS[flow]?.some(keyword => lower === keyword || lower.startsWith(`${keyword} `))
}

function parseFlowPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'string') {
    return null
  }

  const parts = rawPayload.split(':')

  if (parts.length < 3 || parts[0] !== 'flow') {
    return null
  }

  const [_, flow, action, value = ''] = parts

  if (!FLOW_COPY[flow] && action !== 'start' && action !== 'menu' && action !== 'cancel') {
    return null
  }

  return { flow, action, value }
}

function splitSecrets(text) {
  return text
    .split(/\r?\n|[,;]/)
    .map(item => item.trim())
    .filter(Boolean)
}

async function resolveUser(ctx) {
  const maxUserId = extractMaxUserId(ctx)

  if (!maxUserId) {
    throw new Error('MAX user id not found in update')
  }

  return ensureUser(maxUserId, {
    phone: ctx.contactInfo?.tel
  })
}

function extractMaxUserId(ctx) {
  return ctx.user?.id ??
    ctx.user?.user_id ??
    ctx.message?.sender?.user_id ??
    ctx.chatId ??
    ctx.callback?.user?.id ??
    ctx.update?.user?.id ??
    null
}

async function fetchStateRecord(userId) {
  const [rows] = await pool.query(
    'SELECT step, payload FROM states WHERE user_id = ? LIMIT 1',
    [userId]
  )

  if (rows.length === 0) {
    return null
  }

  const row = rows[0]
  return {
    step: row.step,
    payload: parsePayload(row.payload)
  }
}

async function saveStateRecord(userId, step, payload) {
  const json = JSON.stringify(payload ?? {})

  await pool.query(
    `INSERT INTO states (user_id, step, payload)
     VALUES (?, ?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       step = VALUES(step),
       payload = VALUES(payload),
       updated_at = CURRENT_TIMESTAMP`,
    [userId, step, json]
  )
}

async function clearStateRecord(userId) {
  await pool.query('DELETE FROM states WHERE user_id = ?', [userId])
}

function createInitialPayload(flow) {
  return {
    flow,
    listing: createEmptyListing(flow),
    meta: {
      startedAt: new Date().toISOString()
    }
  }
}

function createEmptyListing(flow) {
  return {
    type: flow === FLOWS.LOST ? 'LOST' : 'FOUND',
    category: null,
    details: '',
    photos: [],
    location: null,
    locationNote: '',
    secrets: []
  }
}

function createRuntime(userProfile, record) {
  if (!record) {
    return {
      user: userProfile,
      step: STEPS.IDLE,
      flow: null,
      payload: null
    }
  }

  const payload = record.payload ?? {}
  const flow = payload.flow ?? STEP_TO_FLOW[record.step] ?? null

  return {
    user: userProfile,
    step: record.step,
    flow,
    payload
  }
}

async function transitionToStep(ctx, userProfile, step, payload, options = {}) {
  const { skipIntro = false, withIntro = false } = options
  const flow = payload?.flow ?? STEP_TO_FLOW[step]

  if (!flow) {
    await ctx.reply('Сценарий пока не поддерживает этот шаг.')
    return
  }

  await saveStateRecord(userProfile.userId, step, payload)

  if (skipIntro) {
    const handler = StepHandlers[step]
    if (handler?.enter) {
      await handler.enter(ctx, createRuntime(userProfile, { step, payload }))
    }
    return
  }

  if (withIntro) {
    await ctx.reply(`${FLOW_COPY[flow].emoji} Начинаем сценарий «${FLOW_COPY[flow].label}».`)
  }

  const handler = StepHandlers[step]
  if (handler?.enter) {
    await handler.enter(ctx, createRuntime(userProfile, { step, payload }))
  }
}

function withListing(runtime, mutator) {
  const nextPayload = clonePayload(runtime.payload ?? createInitialPayload(runtime.flow))
  if (!nextPayload.flow) {
    nextPayload.flow = runtime.flow
  }
  nextPayload.listing = nextPayload.listing ?? createEmptyListing(runtime.flow)
  mutator(nextPayload.listing, nextPayload)
  return nextPayload
}

function clonePayload(payload) {
  if (!payload) {
    return {}
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(payload)
  }

  return JSON.parse(JSON.stringify(payload))
}

function parsePayload(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  if (Buffer.isBuffer(value)) {
    try {
      return JSON.parse(value.toString('utf-8'))
    } catch {
      return null
    }
  }

  if (typeof value === 'object') {
    return value
  }

  return null
}

async function safeAnswerOnCallback(ctx, extra) {
  try {
    await ctx.answerOnCallback(extra)
  } catch (error) {
    console.error('[FSM] answerOnCallback error:', error)
  }
}

