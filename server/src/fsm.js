import crypto from 'node:crypto'
import { Keyboard } from '@maxhub/max-bot-api'
import pool from './db.js'
import { ensureUser } from './users.js'
import { encryptSecrets } from './security.js'
import { score as computeMatchScore } from './matching.js'

const { inlineKeyboard, button } = Keyboard

const FRONT_URL = (process.env.FRONT_ORIGIN || 'http://localhost:5173').trim()
const IS_FRONT_LINK_ALLOWED = FRONT_URL.startsWith('https://')

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
  { id: 'pet', title: 'Животные', emoji: '🐾' },
  { id: 'electronics', title: 'Электроника', emoji: '📱' },
  { id: 'wear', title: 'Одежда и аксессуары', emoji: '👜' },
  { id: 'document', title: 'Документы', emoji: '📄' },
  { id: 'valuable', title: 'Ценности', emoji: '💍' },
  { id: 'keys', title: 'Ключи', emoji: '🔑' },
  { id: 'other', title: 'Другое', emoji: '❓' }
]

const CATEGORY_ALIASES = {
  phone: 'electronics',
  electronics: 'electronics',
  gadget: 'electronics',
  bag: 'wear',
  clothes: 'wear',
  clothing: 'wear',
  wallet: 'valuable',
  valuables: 'valuable',
  jewelry: 'valuable',
  misc: 'other',
  unknown: 'other'
}

const CATEGORY_FIELD_SETS = {
  pet: [
    {
      key: 'species',
      label: 'Вид',
      question: {
        lost: 'Какое животное потерялось? (вид)',
        found: 'Какое животное нашли? (вид)'
      },
      hint: 'Например: кошка, собака, хорёк.',
      required: true
    },
    {
      key: 'breed',
      label: 'Порода',
      question: 'Какая порода? Если не знаете — напишите «не знаю» или /skip.',
      required: false
    },
    {
      key: 'color',
      label: 'Окрас / приметы',
      question: 'Опишите окрас или особые приметы. Можно несколько слов.',
      required: true
    },
    {
      key: 'size',
      label: 'Размер',
      question: 'Размер животного (крупный, средний, маленький).',
      required: false
    },
    {
      key: 'nickname',
      label: 'Кличка / опознавательные знаки',
      question: {
        lost: 'Какая кличка у питомца? (если есть)',
        found: 'Есть ли ошейник, жетон или другая опознавательная метка?'
      },
      required: false
    }
  ],
  electronics: [
    {
      key: 'device',
      label: 'Устройство',
      question: {
        lost: 'Что за устройство потерялось? (тип, модель)',
        found: 'Что за устройство нашли? (тип, модель)'
      },
      hint: 'Например: смартфон iPhone 13, планшет Samsung Tab S7.',
      required: true
    },
    {
      key: 'color',
      label: 'Цвет',
      question: 'Какой цвет корпуса/чехла?',
      required: true
    },
    {
      key: 'condition',
      label: 'Особенности',
      question: 'Есть ли особенности: трещины, наклейки, чехол?',
      required: false
    },
    {
      key: 'serial_hint',
      label: 'Уникальная метка',
      question: {
        lost: 'Укажите уникальную метку (последние цифры IMEI/серийника или защитный знак). Она сохранится в секретах.',
        found: 'Опишите уникальные метки (не раскрывая полностью). Например, наклейка или часть серийника.'
      },
      hint: 'Например: IMEI заканчивается на 4821, наклейка внизу.',
      required: false,
      store: 'secret_hint'
    }
  ],
  wear: [
    {
      key: 'item_type',
      label: 'Тип предмета',
      question: 'Что именно? (куртка, шарф, рюкзак, портфель и т.п.)',
      required: true
    },
    {
      key: 'brand',
      label: 'Бренд / марка',
      question: 'Если есть бренд/марка — напишите.',
      required: false
    },
    {
      key: 'color',
      label: 'Цвет / материал',
      question: 'Цвет и материал? (например, чёрная кожа, синяя ткань)',
      required: true
    },
    {
      key: 'features',
      label: 'Отличительные приметы',
      question: 'Есть ли отличительные приметы: нашивки, брелоки, содержимое?',
      required: false
    }
  ],
  document: [
    {
      key: 'doc_type',
      label: 'Тип документа',
      question: 'Какой документ? (паспорт, ВУ, студенческий и т.д.)',
      required: true
    },
    {
      key: 'name_hint',
      label: 'Фамилия/инициалы',
      question: {
        lost: 'Укажите инициалы или фамилию (без полного номера).',
        found: 'Укажите, на какую фамилию оформлен документ (если видно).'
      },
      required: true
    },
    {
      key: 'extra',
      label: 'Дополнительные данные',
      question: {
        lost: 'Есть ли характерная особенность? (серия начинается на 45 XX, выдан в МФЦ и т.п.)',
        found: 'Есть ли характерная особенность? (печати, отметки, часть номера).'
      },
      hint: 'Полные серии/номера писать не нужно — используйте подсказки для секрета.',
      required: false,
      store: 'secret_hint'
    }
  ],
  valuable: [
    {
      key: 'item',
      label: 'Предмет',
      question: 'Что за ценность? (кошелёк, украшение, техника и т.д.)',
      required: true
    },
    {
      key: 'looks',
      label: 'Внешний вид',
      question: 'Как выглядит предмет? Цвет, материал, форма.',
      required: true
    },
    {
      key: 'value_hint',
      label: 'Уникальные детали',
      question: {
        lost: 'Какие уникальные детали есть? (внутри записка, гравировка — можно упомянуть частично)',
        found: 'Опишите без раскрытия полной информации: гравировка, инициалы, особенность упаковки.'
      },
      required: false,
      store: 'secret_hint'
    }
  ],
  keys: [
    {
      key: 'key_type',
      label: 'Тип ключей',
      question: 'Какие ключи? (квартира, авто, домофон, сейф...)',
      required: true
    },
    {
      key: 'bundle',
      label: 'Связка / аксессуары',
      question: 'Есть ли связка, брелок, чехол? Опишите.',
      required: false
    },
    {
      key: 'unique',
      label: 'Уникальные признаки',
      question: {
        lost: 'Опишите отличительные зубья/метки (если можно рассказать безопасно).',
        found: 'Опишите отличительные признаки (без возможности изготовить копию).'
      },
      required: false
    }
  ],
  other: [
    {
      key: 'item',
      label: 'Что за предмет',
      question: 'Опишите предмет: что это и для чего нужно.',
      required: true
    },
    {
      key: 'appearance',
      label: 'Внешний вид',
      question: 'Как выглядит предмет? Цвет, форма, размер.',
      required: true
    },
    {
      key: 'tags',
      label: 'Дополнительные приметы',
      question: 'Укажите до трёх примет через запятую (например: «новый, в коробке, с чеком»).',
      required: false
    }
  ]
}

function normalizeCategoryId(category) {
  if (!category) {
    return category
  }
  const lower = String(category).toLowerCase()
  return CATEGORY_ALIASES[lower] ?? lower
}

function getCategoryOption(categoryId) {
  const normalized = normalizeCategoryId(categoryId)
  return CATEGORY_OPTIONS.find(option => option.id === normalized) ?? null
}

const ATTRIBUTE_STEP_LABEL = 'Шаг 2/6 — описание'

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
  const rows = [
    [
      button.callback('🆘 Потерял', buildFlowPayload(FLOWS.LOST, 'start')),
      button.callback('📦 Нашёл', buildFlowPayload(FLOWS.FOUND, 'start'))
    ],
  ]

  if (IS_FRONT_LINK_ALLOWED) {
    rows.push([button.link('🗺️ Открыть карту', FRONT_URL)])
  }

  return inlineKeyboard(rows)
}

export async function sendMainMenu(ctx, intro = 'Выберите действие:') {
  await ctx.reply(intro, {
    attachments: [buildMainMenuKeyboard()]
  })

  if (!IS_FRONT_LINK_ALLOWED && FRONT_URL) {
    await ctx.reply(`Мини-приложение: ${FRONT_URL}`)
  }
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

      const nextPayload = withListing(runtime, (listing, payload) => {
        listing.category = option.id
        listing.details = ''
        listing.attributes = {}
        listing.pendingSecrets = []
        payload.meta = payload.meta ?? {}
        delete payload.meta.currentAttributeKey
      })

      await safeAnswerOnCallback(ctx, { notification: `${option.emoji} ${option.title}` })
      await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].ATTRIBUTES, nextPayload)
    }
  }
}

function createAttributesHandler(flow) {
  const config = FLOW_COPY[flow]

  return {
    enter: async (ctx, runtime) => {
      const listing = runtime.payload?.listing
      const category = listing?.category

      if (!category) {
        await ctx.reply('Сначала выберите категорию.')
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].CATEGORY, runtime.payload)
        return
      }

      const currentKey = runtime.payload?.meta?.currentAttributeKey
      const field = getAttributeField(flow, category, currentKey)

      if (!field) {
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].PHOTO, runtime.payload, { skipIntro: true })
        return
      }

      const isFirstQuestion = !listing?.attributes || Object.keys(listing.attributes).length === 0

      const lines = []
      if (isFirstQuestion) {
        lines.push(`${config.emoji} ${ATTRIBUTE_STEP_LABEL}`, '', config.attributesPrompt, '')
      }

      lines.push(formatAttributeQuestion(field, flow))
      const hint = formatAttributeHint(field, flow)
      if (hint) {
        lines.push(hint)
      }

      if (!field.required) {
        lines.push('', 'Можно пропустить командой /skip.')
      }

      await ctx.reply(lines.join('\n'))
    },
    onMessage: async (ctx, runtime, message) => {
      const listing = runtime.payload?.listing
      const category = listing?.category

      if (!category) {
        await ctx.reply('Сначала выберите категорию.')
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].CATEGORY, runtime.payload)
        return
      }

      const currentKey = runtime.payload?.meta?.currentAttributeKey
      if (!currentKey) {
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].ATTRIBUTES, runtime.payload, { skipIntro: true })
        return
      }

      const field = getAttributeField(flow, category, currentKey)
      if (!field) {
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].ATTRIBUTES, runtime.payload, { skipIntro: true })
        return
      }

      const text = message.text?.trim?.() ?? ''
      const isSkip = message.lower === '/skip'

      if (!isSkip && field.required && text.length < 2) {
        await ctx.reply('Нужно добавить чуть больше деталей. Если не хотите отвечать — отправьте /skip.')
        return
      }

      if (!isSkip && !text) {
        if (field.required) {
          await ctx.reply('Ответ не распознан. Напишите текст или используйте /skip.')
        } else {
          await ctx.reply('Если нет данных — отправьте /skip.')
        }
        return
      }

      const value = isSkip ? null : text

      const nextPayload = withListing(runtime, (listing, payload) => {
        listing.attributes = listing.attributes ?? {}
        listing.attributes[currentKey] = value

        if (field.store === 'secret_hint') {
          listing.pendingSecrets = listing.pendingSecrets ?? []
          listing.pendingSecrets = listing.pendingSecrets.filter(item => item.key !== currentKey)
          if (value && listing.pendingSecrets.length < 3) {
            listing.pendingSecrets.push({ key: currentKey, value })
          }
        }

        payload.meta = payload.meta ?? {}
        delete payload.meta.currentAttributeKey
      })

      await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].ATTRIBUTES, nextPayload, { skipIntro: true })
    }
  }
}

function createPhotoHandler(flow) {
  const photoLimit = 3
  const isFound = flow === FLOWS.FOUND

  return {
    enter: async (ctx, runtime) => {
      const currentCount = runtime.payload?.listing?.photos?.length ?? 0

      const lines = [
        '📸 Шаг 3/6 — фото',
        isFound
          ? 'Прикрепите до 3 нейтральных фото найденного предмета (без серийников и уникальных меток).'
          : 'Прикрепите до 3 фото, которые помогут опознать предмет.',
        'Можно отправлять по одному снимку в нескольких сообщениях.',
        'Если хотите пропустить — отправьте /skip.'
      ]

      if (currentCount > 0) {
        lines.push('', `Уже загружено: ${currentCount}/${photoLimit}. Добавьте ещё или напишите /next, чтобы продолжить.`)
      }

      await ctx.reply(lines.join('\n'))
    },
    onMessage: async (ctx, runtime, message) => {
      const listing = runtime.payload?.listing ?? {}
      const lower = message.lower ?? ''
      const photos = listing.photos ?? []

      if (['/skip'].includes(lower)) {
        await ctx.reply('Хорошо, пропускаем шаг с фото.')
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].LOCATION, runtime.payload, { skipIntro: true })
        return
      }

      if (['/next', 'готово', 'готов', 'dalee', 'далее'].includes(lower)) {
        if ((photos?.length ?? 0) === 0) {
          await ctx.reply('Пока нет ни одного фото. Прикрепите хотя бы одно или отправьте /skip.')
          return
        }

        await ctx.reply('Фото сохранены. Переходим к следующему шагу.')
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].LOCATION, runtime.payload, { skipIntro: true })
        return
      }

      const attachments = extractPhotoAttachments(ctx.message)

      if (attachments.length === 0) {
        await ctx.reply('Не вижу фото. Прикрепите изображение или отправьте /skip.')
        return
      }

      let appendMeta = { added: 0, skipped: 0 }
      const nextPayload = withListing(runtime, listing => {
        listing.photos = listing.photos ?? []
        appendMeta = appendPhotoAttachments(listing, attachments, photoLimit)
      })

      const newCount = nextPayload.listing.photos.length

      if (appendMeta.added === 0) {
        await ctx.reply('Лимит достигнут или фото уже добавлены. Если всё готово, отправьте /next или /skip.')
        return
      }

      if (newCount >= photoLimit) {
        await ctx.reply(`Отлично! Достигли лимита ${photoLimit} фото. Переходим к локации.`)
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].LOCATION, nextPayload, { skipIntro: true })
      } else {
        await saveStateRecord(runtime.user.userId, FLOW_STEP_MAP[flow].PHOTO, nextPayload)
        const extra =
          appendMeta.skipped > 0
            ? ` Некоторые фото не сохранились: достигнут лимит ${photoLimit}.`
            : ''
        await ctx.reply(`Фото сохранены: ${newCount}/${photoLimit}. Можно добавить ещё или написать /next.${extra}`)
      }
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
      const note = message.text?.trim?.() ?? ''
      const point =
        message.location ??
        extractLocationAttachment(ctx.message)
      const lower = message.lower ?? ''

      if (lower === '/skip') {
        const nextPayload = withListing(runtime, listing => {
          if (note) {
            listing.locationNote = note
          }
        })
        await ctx.reply('Хорошо, пропускаем указание места. Вы всегда можете уточнить позже.')
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].SECRETS, nextPayload, { skipIntro: true })
        return
      }

      if (!note && !point) {
        await ctx.reply('Укажите место текстом или пришлите геопозицию.')
        return
      }

      const nextPayload = withListing(runtime, listing => {
        if (note) {
          listing.locationNote = note
        }

        if (point) {
          const { public: generalized, original } = generalizeLocation(flow, point)
          if (generalized) {
            listing.location = generalized
          }
          if (original) {
            listing.locationOriginal = original
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
    enter: async (ctx, runtime) => {
      const listing = runtime.payload?.listing ?? {}
      const hints = listing.pendingSecrets ?? []

      const lines = [
        `${config.emoji} Шаг 5/6 — ${config.secretsLabel.toLowerCase()}`,
        '',
        config.secretsPrompt
      ]

      if (hints.length > 0) {
        lines.push('', 'Подсказки (из предыдущих шагов):')
        hints.slice(0, 3).forEach(item => {
          lines.push(` - ${item.value}`)
        })
      }

      lines.push('', 'Отправьте каждый секрет отдельной строкой. Чтобы пропустить — /skip.')

      await ctx.reply(lines.join('\n'))
    },
    onMessage: async (ctx, runtime, message) => {
      const lower = message.lower

      const secrets = lower === '/skip'
        ? []
        : splitSecrets(message.text || '').slice(0, 3)

      let encryptedSecrets = []
      try {
        encryptedSecrets = encryptSecrets(secrets)
      } catch (error) {
        console.error('[FSM] Ошибка шифрования секретов:', error)
      }

      const nextPayload = withListing(runtime, listing => {
        listing.secrets = secrets
        listing.encryptedSecrets = encryptedSecrets
        listing.pendingSecrets = []
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

      const attributeLines = buildAttributeLines(flow, listing)

      const summaryLines = [
        `Категория: ${categoryLabel}`,
        attributeLines.length
          ? 'Характеристики:\n - ' + attributeLines.join('\n - ')
          : 'Характеристики: —',
        `Фото: ${listing.photos?.length ?? 0} шт`,
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
        await safeAnswerOnCallback(ctx, { notification: 'Публикуем...' })
        try {
          const { listingId, matches } = await publishListing(runtime)
          await ctx.reply(`✅ Объявление опубликовано!\nID: ${listingId}`)

          if (matches.length > 0) {
            const heading = runtime.flow === FLOWS.LOST ? 'Похожие находки' : 'Похожие потери'
            const items = matches
              .map(match => ` • ${Math.round(match.score)} баллов — ${match.title}`)
              .join('\n')
            await ctx.reply(`${heading} поблизости:\n${items}`)
          } else {
            await ctx.reply('Пока совпадений не найдено. Мы пришлём уведомление, как только появятся подходящие варианты.')
          }

          await sendMainMenu(ctx, 'Что делаем дальше?')
        } catch (error) {
          console.error('[FSM] Ошибка публикации объявления:', error)
          await ctx.reply('⚠️ Не удалось опубликовать объявление. Попробуйте ещё раз или позже.')
        }
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

export function buildFlowPayload(flow, action, value = '') {
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
  const option = getCategoryOption(categoryId)
  return option ? `${option.emoji} ${option.title}` : categoryId
}

function matchesFlowKeyword(lower, flow) {
  return FLOW_KEYWORDS[flow]?.some(keyword => lower === keyword || lower.startsWith(`${keyword} `))
}

function isAttributesStep(step) {
  return step === STEPS.LOST_ATTRIBUTES || step === STEPS.FOUND_ATTRIBUTES
}

function getCategoryFields(flow, category) {
  const normalized = normalizeCategoryId(category)
  if (!normalized) {
    return []
  }
  return CATEGORY_FIELD_SETS[normalized] ?? []
}

function getAttributeField(flow, category, key) {
  if (!key) {
    return null
  }
  return getCategoryFields(flow, category).find(field => field.key === key) ?? null
}

function prepareAttributesPayload(payload, flow) {
  const nextPayload = clonePayload(payload ?? createInitialPayload(flow))
  nextPayload.meta = nextPayload.meta ?? {}
  nextPayload.listing = nextPayload.listing ?? createEmptyListing(flow)
  nextPayload.listing.attributes = nextPayload.listing.attributes ?? {}

  const normalizedCategory = normalizeCategoryId(nextPayload.listing.category)
  if (normalizedCategory) {
    nextPayload.listing.category = normalizedCategory
  }

  const fields = getCategoryFields(flow, normalizedCategory)

  if (fields.length === 0) {
    delete nextPayload.meta.currentAttributeKey
    return { payload: nextPayload, field: null }
  }

  const currentKey = nextPayload.meta.currentAttributeKey
  if (currentKey && !hasAttributeAnswer(nextPayload.listing.attributes, currentKey)) {
    const currentField = fields.find(field => field.key === currentKey)
    if (currentField) {
      return { payload: nextPayload, field: currentField }
    }
  }

  const nextField = fields.find(field => !hasAttributeAnswer(nextPayload.listing.attributes, field.key))

  if (!nextField) {
    delete nextPayload.meta.currentAttributeKey
    return { payload: nextPayload, field: null }
  }

  nextPayload.meta.currentAttributeKey = nextField.key
  return { payload: nextPayload, field: nextField }
}

function hasAttributeAnswer(attributes = {}, key) {
  return Object.prototype.hasOwnProperty.call(attributes ?? {}, key)
}

function formatAttributeQuestion(field, flow) {
  if (!field) {
    return ''
  }

  if (typeof field.question === 'string') {
    return field.question
  }

  return field.question?.[flow] ?? field.question?.default ?? ''
}

function formatAttributeHint(field, flow) {
  if (!field?.hint) {
    return ''
  }

  const hint = typeof field.hint === 'string'
    ? field.hint
    : field.hint?.[flow] ?? field.hint?.default ?? ''

  return hint ? `💡 ${hint}` : ''
}

function buildAttributeLines(flow, listing = {}) {
  const attributes = listing.attributes ?? {}
  const category = listing.category
  const fields = getCategoryFields(flow, category)

  return fields
    .filter(field => hasAttributeAnswer(attributes, field.key))
    .map(field => {
      const value = attributes[field.key]
      if (value === null || value === undefined || String(value).trim() === '') {
        return `${field.label ?? field.key}: (пропущено)`
      }
      return `${field.label ?? field.key}: ${String(value).trim()}`
    })
}

function extractPhotoAttachments(message) {
  const attachments = message?.body?.attachments ?? []
  if (!Array.isArray(attachments)) {
    return []
  }

  return attachments
    .filter(att => att && att.type === 'image' && att.payload)
    .map(att => ({
      id: String(att.payload.photo_id ?? att.payload.token ?? `${Date.now()}-${Math.random()}`),
      type: 'image',
      url: att.payload.url,
      token: att.payload.token
    }))
}

function appendPhotoAttachments(listing, attachments, limit) {
  const existing = new Set((listing.photos ?? []).map(photo => photo.id))
  let added = 0
  let skipped = 0

  for (const attachment of attachments) {
    if (listing.photos.length >= limit) {
      skipped += 1
      continue
    }

    if (existing.has(attachment.id)) {
      skipped += 1
      continue
    }

    listing.photos.push(attachment)
    existing.add(attachment.id)
    added += 1
  }

  return { added, skipped }
}

function extractLocationAttachment(message) {
  const attachments = message?.body?.attachments ?? []
  if (!Array.isArray(attachments)) {
    return null
  }

  const locationAttachment = attachments.find(att => att && att.type === 'location')
  if (!locationAttachment) {
    return null
  }

  const latitude = Number(locationAttachment.latitude)
  const longitude = Number(locationAttachment.longitude)

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return null
  }

  return { latitude, longitude }
}

function generalizeLocation(flow, point) {
  if (!point) {
    return { public: null, original: null }
  }

  const original = {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude)
  }

  if (flow === FLOWS.FOUND) {
    const lat = roundCoordinate(original.latitude, 0.01)
    const lng = roundCoordinate(original.longitude, 0.01)
    return {
      public: {
        latitude: lat,
        longitude: lng,
        precision: 'area'
      },
      original: original
    }
  }

  return {
    public: {
      latitude: original.latitude,
      longitude: original.longitude,
      precision: 'point'
    },
    original: original
  }
}

function roundCoordinate(value, step) {
  return Math.round(value / step) * step
}

async function publishListing(runtime) {
  const listing = runtime.payload?.listing
  if (!listing) {
    throw new Error('Пустой черновик объявления')
  }

  const flow = runtime.flow ?? (listing.type === 'LOST' ? FLOWS.LOST : FLOWS.FOUND)
  const payload = buildListingPayload(flow, listing)
  const authorId = runtime.user?.userId

  if (!authorId) {
    throw new Error('Не удалось определить пользователя')
  }

  const listingId = await persistListing(authorId, payload)
  const matches = await findPotentialMatches({
    id: listingId,
    ...payload
  })

  await clearStateRecord(authorId)

  return { listingId, matches }
}

function buildListingPayload(flow, listing) {
  if (!listing?.category) {
    throw new Error('Категория не выбрана')
  }

  const type = listing.type ?? (flow === FLOWS.LOST ? 'LOST' : 'FOUND')
  const category = normalizeCategoryId(listing.category)

  if (!category) {
    throw new Error('Категория не распознана')
  }

  listing.category = category
  const attributes = listing.attributes ?? {}
  const fields = getCategoryFields(flow, category)

  const primaryField = fields.find(field => {
    const value = attributes[field.key]
    return value !== null && value !== undefined && String(value).trim() !== ''
  })

  const subject = primaryField
    ? String(attributes[primaryField.key]).trim()
    : categoryTitle(category)

  const verb = flow === FLOWS.LOST ? 'Потеряно' : 'Найдено'
  const title = `${verb}: ${subject}`

  const attributeLines = buildAttributeLines(flow, listing)
  const descriptionParts = []

  if (attributeLines.length > 0) {
    descriptionParts.push('Характеристики:')
    attributeLines.forEach(line => descriptionParts.push(`- ${line}`))
  }

  if (listing.locationNote) {
    descriptionParts.push(`Локация: ${listing.locationNote}`)
  }

  if (flow === FLOWS.FOUND) {
    descriptionParts.push('Точная точка будет доступна владельцу после проверки.')
  }

  const description = descriptionParts.join('\n')
  listing.details = description

  const lat = normalizeCoordinate(listing.location?.latitude)
  const lng = normalizeCoordinate(listing.location?.longitude)
  const occurredAt = formatMysqlDatetime(listing.occurredAt)

  const photos = (listing.photos ?? [])
    .map(extractPhotoUrl)
    .filter(Boolean)
    .slice(0, 3)

  const secrets = Array.isArray(listing.encryptedSecrets)
    ? listing.encryptedSecrets.filter(Boolean).slice(0, 3)
    : []

  return {
    type,
    category,
    title,
    description,
    lat,
    lng,
    occurredAt,
    photos,
    secrets
  }
}

function categoryTitle(categoryId) {
  return getCategoryOption(categoryId)?.title ?? categoryId
}

function extractPhotoUrl(photo) {
  if (!photo) {
    return null
  }

  if (photo.url) {
    return photo.url
  }

  if (photo.token) {
    return `max-photo-token:${photo.token}`
  }

  return null
}

function normalizeCoordinate(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return null
  }
  return num
}

async function persistListing(authorId, payload) {
  const id = crypto.randomUUID()

  await pool.query(
    'INSERT INTO listings (id, author_id, type, category, title, description, lat, lng, occurred_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [
      id,
      authorId,
      payload.type,
      payload.category,
      payload.title,
      payload.description,
      payload.lat,
      payload.lng,
      payload.occurredAt
    ]
  )

  for (const url of payload.photos) {
    await pool.query(
      'INSERT INTO photos (id, listing_id, url) VALUES (?,?,?)',
      [crypto.randomUUID(), id, url]
    )
  }

  for (const secret of payload.secrets) {
    await pool.query(
      'INSERT INTO secrets (id, listing_id, cipher) VALUES (?,?,?)',
      [crypto.randomUUID(), id, JSON.stringify(secret)]
    )
  }

  return id
}

async function findPotentialMatches(newListing) {
  if (newListing.lat === null || newListing.lng === null || newListing.lat === undefined || newListing.lng === undefined) {
    return []
  }

  const oppositeType = newListing.type === 'LOST' ? 'FOUND' : 'LOST'
  const params = [oppositeType]
  let where = 'status="ACTIVE" AND type=?'

  if (newListing.category) {
    where += ' AND category=?'
    params.push(newListing.category)
  }

  const radiusKm = 5
  const radiusDeg = radiusKm / 111
  where += ' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?'
  params.push(
    newListing.lat - radiusDeg,
    newListing.lat + radiusDeg,
    newListing.lng - radiusDeg,
    newListing.lng + radiusDeg
  )

  const [rows] = await pool.query(
    `SELECT id, type, category, title, description, lat, lng, occurred_at, created_at 
     FROM listings 
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT 50`,
    params
  )

  const baseListing = {
    id: newListing.id ?? '',
    type: newListing.type,
    category: newListing.category,
    title: newListing.title,
    occurred_at: newListing.occurredAt,
    lat: newListing.lat,
    lng: newListing.lng
  }

  return rows
    .map(row => ({
      id: row.id,
      type: row.type,
      category: row.category,
      title: row.title,
      description: row.description,
      lat: Number(row.lat),
      lng: Number(row.lng),
      occurred_at: row.occurred_at ?? row.created_at
    }))
    .map(candidate => {
      const score = baseListing.type === 'LOST'
        ? computeMatchScore(baseListing, candidate)
        : computeMatchScore(candidate, baseListing)

      return {
        id: candidate.id,
        title: candidate.title ?? 'Без названия',
        score
      }
    })
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .filter(item => item.score >= 50)
    .slice(0, 3)
}

function formatMysqlDatetime(value) {
  const date = value ? new Date(value) : new Date()

  if (Number.isNaN(date.getTime())) {
    return null
  }

  const iso = date.toISOString()
  return iso.slice(0, 19).replace('T', ' ')
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
    attributes: {},
    photos: [],
    location: null,
    locationOriginal: null,
    locationNote: '',
    secrets: [],
    encryptedSecrets: [],
    pendingSecrets: []
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
  if (payload.listing?.category) {
    payload.listing.category = normalizeCategoryId(payload.listing.category)
  }
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

  let effectiveStep = step
  let effectivePayload = payload ?? createInitialPayload(flow)

  if (isAttributesStep(effectiveStep)) {
    const prepared = prepareAttributesPayload(effectivePayload, flow)
    effectivePayload = prepared.payload

    if (!prepared.field) {
      const nextStep = FLOW_STEP_MAP[flow].PHOTO
      return transitionToStep(ctx, userProfile, nextStep, effectivePayload, options)
    }
  }

  await saveStateRecord(userProfile.userId, effectiveStep, effectivePayload)

  if (skipIntro) {
    const handler = StepHandlers[effectiveStep]
    if (handler?.enter) {
      await handler.enter(ctx, createRuntime(userProfile, { step: effectiveStep, payload: effectivePayload }))
    }
    return
  }

  if (withIntro) {
    await ctx.reply(`${FLOW_COPY[flow].emoji} Начинаем сценарий «${FLOW_COPY[flow].label}».`)
  }

  const handler = StepHandlers[effectiveStep]
  if (handler?.enter) {
    await handler.enter(ctx, createRuntime(userProfile, { step: effectiveStep, payload: effectivePayload }))
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

