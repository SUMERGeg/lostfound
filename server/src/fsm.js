import crypto from 'node:crypto'
import { Keyboard } from '@maxhub/max-bot-api'
import pool from './db.js'
import { ensureUser } from './users.js'
import { encryptSecrets, decryptSecret } from './security.js'
import { score as computeMatchScore } from './matching.js'
import {
  getOrCreateOwnerCheckChat,
  updateChatStatus,
  fetchChatById,
  fetchChatMembers,
  appendSystemMessage
} from './chat.js'
import {
  NotificationStatus,
  NotificationType,
  createNotification,
  upsertNotification,
  listNotifications,
  markNotificationRead
} from './notifications.js'

const { inlineKeyboard, button } = Keyboard

const FRONT_URL = (process.env.FRONT_ORIGIN || 'http://localhost:5173').trim()
const IS_FRONT_LINK_ALLOWED = FRONT_URL.startsWith('https://')
const VK_DOBRO_URL = (process.env.VK_DOBRO_URL || 'https://dobro.mail.ru/projects/?recipient=animals').trim()
const IS_DOBRO_LINK_ALLOWED = VK_DOBRO_URL.startsWith('https://')

export const FLOWS = {
  LOST: 'lost',
  FOUND: 'found',
  OWNER: 'owner',
  VOLUNTEER: 'volunteer',
  MY: 'my'
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
  FOUND_CONFIRM: 'found_confirm',
  OWNER_CHECK_INTRO: 'owner_check_intro',
  OWNER_CHECK_QUESTION: 'owner_check_question',
  OWNER_CHECK_WAITING: 'owner_check_waiting',
  VOLUNTEER_LOCATION: 'volunteer_location',
  VOLUNTEER_INTRO: 'volunteer_intro',
  VOLUNTEER_LIST: 'volunteer_list',
  MY_LIST: 'my_list',
  MY_EDIT_MENU: 'my_edit_menu',
  MY_EDIT_TITLE: 'my_edit_title',
  MY_EDIT_DESCRIPTION: 'my_edit_description',
  MY_EDIT_CATEGORY: 'my_edit_category',
  MY_EDIT_OCCURRED: 'my_edit_occurred',
  MY_EDIT_LOCATION: 'my_edit_location',
  MY_EDIT_PHOTOS: 'my_edit_photos'
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
  },
  [FLOWS.OWNER]: {
    INTRO: STEPS.OWNER_CHECK_INTRO,
    QUESTION: STEPS.OWNER_CHECK_QUESTION,
    WAITING: STEPS.OWNER_CHECK_WAITING
  },
  [FLOWS.VOLUNTEER]: {
    LOCATION: STEPS.VOLUNTEER_LOCATION,
    INTRO: STEPS.VOLUNTEER_INTRO,
    LIST: STEPS.VOLUNTEER_LIST
  },
  [FLOWS.MY]: {
    LIST: STEPS.MY_LIST,
    EDIT_MENU: STEPS.MY_EDIT_MENU,
    EDIT_TITLE: STEPS.MY_EDIT_TITLE,
    EDIT_DESCRIPTION: STEPS.MY_EDIT_DESCRIPTION,
    EDIT_CATEGORY: STEPS.MY_EDIT_CATEGORY,
    EDIT_OCCURRED: STEPS.MY_EDIT_OCCURRED,
    EDIT_LOCATION: STEPS.MY_EDIT_LOCATION,
    EDIT_PHOTOS: STEPS.MY_EDIT_PHOTOS
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
  [FLOWS.FOUND]: FLOW_STEP_MAP[FLOWS.FOUND].CATEGORY,
  [FLOWS.OWNER]: FLOW_STEP_MAP[FLOWS.OWNER].INTRO,
  [FLOWS.VOLUNTEER]: FLOW_STEP_MAP[FLOWS.VOLUNTEER].INTRO,
  [FLOWS.MY]: FLOW_STEP_MAP[FLOWS.MY].LIST
}

const AUXILIARY_FLOWS = new Set(['menu'])

const FLOW_STEP_SEQUENCE = {
  [FLOWS.LOST]: [
    FLOW_STEP_MAP[FLOWS.LOST].CATEGORY,
    FLOW_STEP_MAP[FLOWS.LOST].ATTRIBUTES,
    FLOW_STEP_MAP[FLOWS.LOST].PHOTO,
    FLOW_STEP_MAP[FLOWS.LOST].LOCATION,
    FLOW_STEP_MAP[FLOWS.LOST].SECRETS,
    FLOW_STEP_MAP[FLOWS.LOST].CONFIRM
  ],
  [FLOWS.FOUND]: [
    FLOW_STEP_MAP[FLOWS.FOUND].CATEGORY,
    FLOW_STEP_MAP[FLOWS.FOUND].ATTRIBUTES,
    FLOW_STEP_MAP[FLOWS.FOUND].PHOTO,
    FLOW_STEP_MAP[FLOWS.FOUND].LOCATION,
    FLOW_STEP_MAP[FLOWS.FOUND].SECRETS,
    FLOW_STEP_MAP[FLOWS.FOUND].CONFIRM
  ],
  [FLOWS.OWNER]: [
    FLOW_STEP_MAP[FLOWS.OWNER].INTRO,
    FLOW_STEP_MAP[FLOWS.OWNER].QUESTION,
    FLOW_STEP_MAP[FLOWS.OWNER].WAITING
  ],
  [FLOWS.VOLUNTEER]: [
    FLOW_STEP_MAP[FLOWS.VOLUNTEER].INTRO,
    FLOW_STEP_MAP[FLOWS.VOLUNTEER].LOCATION,
    FLOW_STEP_MAP[FLOWS.VOLUNTEER].LIST
  ]
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

const VOLUNTEER_CATEGORY = 'pet'
const VOLUNTEER_LIST_LIMIT = 5

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
  [FLOWS.FOUND]: ['нашёл', 'нашел', 'нашла', 'нашли', '/found'],
  [FLOWS.VOLUNTEER]: ['волонтёрить', 'волонтерить', '/volunteer'],
  [FLOWS.MY]: ['мои объявления', 'мои объявление', '/my']
}

const NOTIFICATION_KEYWORDS = new Set(['уведомления', 'уведомление', 'notifications', '/notifications'])

const CANCEL_KEYWORDS = ['/cancel', 'отмена']
const BACK_KEYWORDS = ['/back', 'назад']
const PREVIEW_KEYWORDS = ['/preview', 'черновик']

const LOCATION_MODES = {
  EXACT: 'exact',
  APPROX: 'approx',
  TRANSIT: 'transit'
}

const RISKY_CATEGORIES = new Set(['phone', 'wallet', 'document', 'keys'])

const LEGAL_COPY = {
  foundGeneral:
    '⚖️ Если владелец неизвестен, сообщите о находке в полицию или ОМСУ. Если предмет найден в помещении или транспорте — передайте администратору или перевозчику.',
  foundSixMonths:
    'ℹ️ Информируем: если после заявления владелец не найдётся в течение 6 месяцев, находку можно оформить на себя.',
  foundPet:
    '🐾 Животные: сообщите о находке в полицию или ОМСУ в течение 3 дней и постарайтесь обеспечить безопасность питомцу.',
  dangerous:
    '🚨 Опасная находка (взрывоопасная, оружие, подозрительные предметы): не трогайте предмет, отметьте в карточке, что нашли такой тип, и немедленно позвоните 112 или 102.'
}

const CATEGORY_WARNINGS = {
  document:
    '📄 Документы не выкладываем с видимыми персональными данными. Замажьте их на фото и передайте оригинал в полицию или выдавший орган.',
  phone:
    '📱 Для электроники не раскрывайте полный серийный номер. Уникальные детали лучше сохранить в «секретах».',
  bag:
    '🎒 Похоже на обычную находку? Публикуйте с фото. Сумка/пакет/чемодан — снимайте с безопасного расстояния, не вскрывайте, при сомнениях звоните 112/102.',
  wallet:
    '💍 Похоже на обычную находку? Публикуйте с фото. Если вещь может быть подозрительной, сделайте снимок с безопасного расстояния и при сомнениях обратитесь по 112/102.',
  keys:
    '🔑 Похоже на обычную находку? Публикуйте с фото. Связку, которая выглядит подозрительно, лучше не трогать и сообщить по 112/102.'
}

const SECRET_LIMITS = {
  QUESTION: 160,
  ANSWER: 200
}

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
    attributesPrompt: 'Опишите находку так, чтобы владелец узнал её: внешний вид, состояние, важные детали. Уникальные метки для вещей можно сохранить в «секретах».',
    locationPrompt: 'Где нашли предмет и где храните сейчас? Для безопасности укажите район/ориентир.',
    secretsPrompt: 'Задайте до трёх вопросов для владельца (каждый с новой строки). Пример: «Какой брелок был на рюкзаке?»',
    secretsLabel: 'Вопросы',
    confirmPrompt: 'Проверьте карточку перед публикацией. Дальше добавим owner-check и уведомления.',
    summaryTitle: 'Черновик «Нашёл»'
  },
  [FLOWS.OWNER]: {
    emoji: '🛡️',
    label: 'Проверка владельца',
    summaryTitle: 'Проверка владельца'
  },
  [FLOWS.VOLUNTEER]: {
    emoji: '🐾',
    label: 'Волонтёрить',
    introText:
      'Помогаем искать потерявшихся питомцев. Ниже покажем ближайшие активные заявки по животным. Выберите карточку, чтобы посмотреть детали и связаться с владельцем.',
    emptyText:
      'Сейчас нет активных заявок по животным. Загляните позже или включите уведомления — сообщим, когда появится новая.'
  },
  [FLOWS.MY]: {
    emoji: '📂',
    label: 'Мои объявления',
    emptyText: 'У вас ещё нет объявлений. Нажмите «Потерял» или «Нашёл», чтобы создать первое.'
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
  [STEPS.FOUND_CONFIRM]: createConfirmHandler(FLOWS.FOUND),
  [STEPS.OWNER_CHECK_INTRO]: createOwnerCheckIntroHandler(),
  [STEPS.OWNER_CHECK_QUESTION]: createOwnerCheckQuestionHandler(),
  [STEPS.OWNER_CHECK_WAITING]: createOwnerCheckWaitingHandler(),
  [STEPS.VOLUNTEER_LOCATION]: createVolunteerLocationHandler(),
  [STEPS.VOLUNTEER_INTRO]: createVolunteerIntroHandler(),
  [STEPS.VOLUNTEER_LIST]: createVolunteerListHandler(),
  [STEPS.MY_LIST]: createMyListHandler(),
  [STEPS.MY_EDIT_MENU]: createMyEditMenuHandler(),
  [STEPS.MY_EDIT_TITLE]: createMyEditTitleHandler(),
  [STEPS.MY_EDIT_DESCRIPTION]: createMyEditDescriptionHandler(),
  [STEPS.MY_EDIT_CATEGORY]: createMyEditCategoryHandler(),
  [STEPS.MY_EDIT_OCCURRED]: createMyEditOccurredHandler(),
  [STEPS.MY_EDIT_LOCATION]: createMyEditLocationHandler(),
  [STEPS.MY_EDIT_PHOTOS]: createMyEditPhotosHandler()
}

export function buildMainMenuKeyboard() {
  const rows = [
    [
      button.callback('🆘 Потерял', buildFlowPayload(FLOWS.LOST, 'start')),
      button.callback('📦 Нашёл', buildFlowPayload(FLOWS.FOUND, 'start'))
    ]
  ]

  rows.push([button.callback('📂 Мои объявления', buildFlowPayload(FLOWS.MY, 'start'))])
  rows.push([button.callback('🐾 Волонтёрить', buildFlowPayload(FLOWS.VOLUNTEER, 'start'))])
  rows.push([button.callback('🔔 Уведомления', buildFlowPayload('menu', 'notifications'))])

  if (IS_FRONT_LINK_ALLOWED) {
    rows.push([button.link('🗺️ Открыть карту', FRONT_URL)])
  }

  if (IS_DOBRO_LINK_ALLOWED) {
    rows.push([button.link('❤️ Пожертвовать', VK_DOBRO_URL)])
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

  if (VK_DOBRO_URL && !IS_DOBRO_LINK_ALLOWED) {
    await ctx.reply(`❤️ Поддержите приюты через VK Добро: ${VK_DOBRO_URL}`)
  }
}

async function showNotifications(ctx, userProfile) {
  const notifications = await listNotifications(userProfile.userId, { limit: 10 })

  if (!notifications.length) {
    await ctx.reply(
      '🔔 Уведомлений нет. Как только появятся новые события по вашим объявлениям или заявкам, мы сообщим здесь.'
    )
    return
  }

  await ctx.reply(`🔔 Уведомления (${notifications.length})`)

  for (const notification of notifications) {
    const view = buildNotificationView(notification)

    if (!view?.text) {
      continue
    }

    await ctx.reply(view.text, view.attachments ? { attachments: view.attachments } : undefined)

    if (notification.status === NotificationStatus.UNREAD) {
      await markNotificationRead(notification.id)
    }
  }
}

export async function handleMessage(ctx) {
  const rawText = ctx.message?.body?.text ?? ''
  const text = rawText.trim()
  const lower = text.toLowerCase()
  const location = ctx.location ?? null

  try {
    const userProfile = await resolveUser(ctx)
    const contactShared = Boolean(ctx.contactInfo?.tel)
    if (contactShared) {
      await handleContactShareEvent(userProfile.userId)
    }
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

      if (runtime.step !== STEPS.IDLE && BACK_KEYWORDS.includes(lower)) {
        const previousStep = getPreviousStep(runtime.flow, runtime.step)
        if (!previousStep) {
          await ctx.reply('Вы уже на первом шаге. Используйте /cancel, чтобы начать заново.')
          return
        }
        await ctx.reply('Возвращаемся на предыдущий шаг.')
        await transitionToStep(ctx, runtime.user, previousStep, runtime.payload, { skipIntro: true })
        return
      }

      if (runtime.step !== STEPS.IDLE && PREVIEW_KEYWORDS.includes(lower)) {
        await sendDraftSummary(ctx, runtime)
        return
      }

    if (runtime.step === STEPS.IDLE) {
      if (contactShared && !text) {
        await ctx.reply('📱 Контакт получен. Проверьте уведомления — контакты откроются автоматически.')
        return
      }

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

      if (matchesFlowKeyword(lower, FLOWS.VOLUNTEER)) {
        await ctx.reply('Запускаем сценарий «Волонтёрить».')
        await startFlow(ctx, FLOWS.VOLUNTEER, userProfile)
        return
      }

      if (NOTIFICATION_KEYWORDS.has(lower)) {
        await showNotifications(ctx, userProfile)
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

    if (flow === 'menu') {
      if (action === 'notifications') {
        await safeAnswerOnCallback(ctx, { notification: 'Открываем уведомления' })
        await showNotifications(ctx, userProfile)
        return
      }

      if (action === 'show_listing') {
        await handleShowListingAction(ctx, userProfile, value)
        return
      }

    }

    const record = await fetchStateRecord(userProfile.userId)
    const runtime = createRuntime(userProfile, record)

    if (action === 'match') {
      await handleMatchAction(ctx, userProfile, runtime, parsed)
      return
    }

    if (flow === FLOWS.OWNER) {
      if (action === 'review') {
        await handleOwnerReviewAction(ctx, userProfile, value)
        return
      }

      if (action === 'contact_request') {
        await handleOwnerContactRequest(ctx, userProfile, value)
        return
      }

      if (action === 'share_contact') {
        await handleOwnerShareContactAction(ctx, userProfile, value)
        return
      }
    }

    if (runtime.step === STEPS.IDLE && flow !== FLOWS.OWNER) {
      await safeAnswerOnCallback(ctx, { notification: 'Сначала выберите сценарий' })
      await sendMainMenu(ctx)
      return
    }

    if (runtime.flow !== flow && flow !== FLOWS.OWNER) {
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
        payload.meta.photoAcknowledged = false
        payload.meta.legalAccepted = flow === FLOWS.FOUND ? false : payload.meta?.legalAccepted
        payload.meta.locationMode = null
        payload.meta.locationStage = null
        delete payload.meta.currentAttributeKey
      })

      await safeAnswerOnCallback(ctx, { notification: `${option.emoji} ${option.title}` })
      await sendCategoryHints(ctx, flow, option.id)
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
      const listing = runtime.payload?.listing ?? {}
      const category = listing.category
      const needsAck = isFound && (RISKY_CATEGORIES.has(category) || category === 'bag')
      const meta = runtime.payload?.meta ?? {}

      if (needsAck && !meta.photoAcknowledged) {
        await ctx.reply(buildPhotoAcknowledgementCopy(flow, category), {
          attachments: [
            inlineKeyboard([
              [button.callback('✅ Ознакомлен', buildFlowPayload(flow, 'photo_ack'))],
              [button.callback('❌ Отменить', buildFlowPayload(flow, 'cancel'))]
            ])
          ]
        })
        return
      }

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
    },
    onCallback: async (ctx, runtime, parsed) => {
      if (parsed.action === 'photo_ack') {
        const listing = runtime.payload?.listing ?? {}
        const category = listing.category
        const needsAck = isFound || RISKY_CATEGORIES.has(category)

        if (!needsAck) {
          await safeAnswerOnCallback(ctx, { notification: 'Для этой категории подтверждение не требуется' })
          return
        }

        const nextPayload = withListing(runtime, (_listing, payload) => {
          payload.meta = payload.meta ?? {}
          payload.meta.photoAcknowledged = true
        })

        await safeAnswerOnCallback(ctx, { notification: 'Спасибо, продолжаем' })
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].PHOTO, nextPayload, { skipIntro: true })
        return
      }

      await safeAnswerOnCallback(ctx, { notification: 'Неизвестное действие' })
    }
  }
}

function createLocationHandler(flow) {
  const config = FLOW_COPY[flow]

  return {
    enter: async (ctx, runtime) => {
      const meta = runtime.payload?.meta ?? {}
      const listing = runtime.payload?.listing ?? {}

      if (!meta.locationMode) {
        await ctx.reply(
          `${config.emoji} Шаг 4/6 — локация и время\n\n${config.locationPrompt}\n\nВыберите, как удобнее указать место:`,
          { attachments: [buildLocationModeKeyboard(flow)] }
        )
        if (flow === FLOWS.FOUND) {
          await ctx.reply(`${LEGAL_COPY.foundGeneral}\n\n${LEGAL_COPY.foundSixMonths}`)
          if (listing.category === 'pet') {
            await ctx.reply(LEGAL_COPY.foundPet)
          }
        }
        return
      }

      const stage = meta.locationStage ?? 'details'

      if (stage === 'transitRoute') {
        await ctx.reply(buildTransitPrompt())
        return
      }

      if (stage === 'details') {
        await ctx.reply(buildLocationDetailsPrompt(flow, meta.locationMode))
        return
      }

      if (stage === 'time') {
        await ctx.reply(buildTimePrompt())
        return
      }

      await ctx.reply('Локация почти готова. Если нужно изменить режим — используйте /back.')
    },
    onCallback: async (ctx, runtime, parsed) => {
      if (parsed.action === 'location_mode') {
        const mode = parsed.value
        if (!Object.values(LOCATION_MODES).includes(mode)) {
          await safeAnswerOnCallback(ctx, { notification: 'Неизвестный режим' })
          return
        }

        const nextPayload = withListing(runtime, (listing, payload) => {
          payload.meta = payload.meta ?? {}
          payload.meta.locationMode = mode
          payload.meta.locationStage = mode === LOCATION_MODES.TRANSIT ? 'transitRoute' : 'details'
          listing.locationMode = mode
        })

        await safeAnswerOnCallback(ctx, { notification: 'Режим выбран' })
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].LOCATION, nextPayload, { skipIntro: true })
        return
      }

      await safeAnswerOnCallback(ctx, { notification: 'Действие не поддерживается' })
    },
    onMessage: async (ctx, runtime, message) => {
      const meta = runtime.payload?.meta ?? {}
      const mode = meta.locationMode
      if (!mode) {
        await ctx.reply('Сначала выберите режим указания места с помощью кнопок.')
        return
      }

      const stage = meta.locationStage ?? 'details'
      const text = message.text?.trim?.() ?? ''
      const lower = message.lower ?? ''
      const point = message.location ?? extractLocationAttachment(ctx.message)

      if (stage === 'transitRoute') {
        if (lower === '/skip') {
          const nextPayload = withListing(runtime, (listing, payload) => {
            listing.transit = null
            payload.meta.locationStage = 'details'
          })
          await ctx.reply('Хорошо, пропускаем детали маршрута.')
          await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].LOCATION, nextPayload, { skipIntro: true })
          return
        }

        if (!text || text.length < 4) {
          await ctx.reply('Опишите маршрут, номер рейса или транспорт. Если информации нет — отправьте /skip.')
          return
        }

        const nextPayload = withListing(runtime, (listing, payload) => {
          listing.transit = text.slice(0, 200)
          payload.meta.locationStage = 'details'
        })

        await ctx.reply('Принял данные о маршруте.')
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].LOCATION, nextPayload, { skipIntro: true })
        return
      }

      if (stage === 'details') {
        if (lower === '/skip') {
          const nextPayload = withListing(runtime, (listing, payload) => {
            payload.meta.locationStage = 'time'
          })
          await ctx.reply('Можно пропустить конкретное место. Тогда укажите хотя бы время.')
          await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].LOCATION, nextPayload, { skipIntro: true })
          return
        }

        if (!text && !point) {
          await ctx.reply('Укажите место текстом или прикрепите геопозицию. Если нет данных — отправьте /skip.')
          return
        }

        const nextPayload = withListing(runtime, (listing, payload) => {
          listing.locationMode = mode
          if (text) {
            listing.locationNote = text.slice(0, 500)
          }

          if (point) {
            const { public: generalized, original } = generalizeLocation(flow, point, mode)
            if (generalized) {
              listing.location = generalized
            }
            if (original) {
              listing.locationOriginal = original
            }
          }

          payload.meta.locationStage = 'time'
        })

        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].LOCATION, nextPayload, { skipIntro: true })
        return
      }

      if (stage === 'time') {
        if (lower === '/skip') {
          const nextPayload = withListing(runtime, (listing, payload) => {
            listing.occurredAt = null
            payload.meta.locationStage = 'complete'
          })
          await ctx.reply('Время пропустим. Если вспомните позже — можно отредактировать объявление.')
          await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].SECRETS, nextPayload, { skipIntro: true })
          return
        }

        const parsed = parseDateTimeInput(text)
        if (!parsed) {
          await ctx.reply('Не удалось распознать дату и время. Пример: 12.11.2025 18:30 или «вчера 15:00». Либо отправьте /skip.')
          return
        }

        const nextPayload = withListing(runtime, (listing, payload) => {
          listing.occurredAt = parsed.toISOString()
          payload.meta.locationStage = 'complete'
        })

        await ctx.reply(`Запомнил время: ${formatDisplayDate(parsed)}.`)
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].SECRETS, nextPayload, { skipIntro: true })
        return
      }

      await ctx.reply('Этот шаг уже завершён. Используйте /back, если нужно исправить данные.')
    }
  }
}

function createSecretsHandler(flow) {
  const config = FLOW_COPY[flow]

  return {
    enter: async (ctx, runtime) => {
      if (flow === FLOWS.LOST) {
        const nextPayload = withListing(runtime, listing => {
          listing.secretEntries = []
          listing.encryptedSecrets = []
          listing.pendingSecrets = []
        })
        await ctx.reply('Этот шаг пропускаем: секретные вопросы задаёт тот, кто нашёл находку.')
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].CONFIRM, nextPayload, { skipIntro: true })
        return
      }

      const listing = runtime.payload?.listing ?? {}
      const hints = listing.pendingSecrets ?? []

      const lines = [
        `${config.emoji} Шаг 5/6 — ${config.secretsLabel.toLowerCase()}`,
        '',
        config.secretsPrompt,
        '',
        getSecretsFormatHint(flow)
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
      if (flow === FLOWS.LOST) {
        await ctx.reply('Секретные признаки заполняют те, кто нашёл. Продолжаем.')
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].CONFIRM, runtime.payload, { skipIntro: true })
        return
      }

      const lower = message.lower
      const rawText = message.text ?? ''

      let entries = []
      if (lower === '/skip') {
        entries = []
      } else {
        const parseResult = parseSecretEntries(flow, rawText)
        if (parseResult.error) {
          await ctx.reply(parseResult.error)
          return
        }
        entries = parseResult.entries
      }

      let encryptedSecrets = []
      try {
        encryptedSecrets = encryptSecrets(entries)
      } catch (error) {
        console.error('[FSM] Ошибка шифрования секретов:', error)
      }

      const nextPayload = withListing(runtime, listing => {
        listing.secretEntries = entries
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
      const meta = runtime.payload?.meta ?? {}

      if (flow === FLOWS.FOUND && !meta.legalAccepted) {
        await sendLegalAcknowledgement(ctx, runtime)
        return
      }

      const attributeLines = buildAttributeLines(flow, listing)
      const secretsSummary = buildSecretsSummary(flow, listing.secretEntries ?? [])

      const summaryLines = [
        `Категория: ${categoryLabel}`,
        attributeLines.length
          ? 'Характеристики:\n - ' + attributeLines.join('\n - ')
          : 'Характеристики: —',
        `Фото: ${listing.photos?.length ?? 0} шт`,
        `Режим локации: ${describeLocationMode(listing.locationMode)}`,
        listing.location
          ? `Координаты: ${listing.location.latitude?.toFixed?.(5) ?? '?'}°, ${listing.location.longitude?.toFixed?.(5) ?? '?'}°`
          : `Координаты: —`,
        `Локация (текст): ${listing.locationNote || '—'}`,
        `Время: ${formatDisplayDate(listing.occurredAt)}`,
        `${secretsLabel}: ${secretsSummary}`
      ]

      await ctx.reply(
        `${config.emoji} Шаг 6/6 — подтверждение\n\n${config.summaryTitle}\n\n${summaryLines.join('\n')}\n\n${config.confirmPrompt}`,
        { attachments: [buildConfirmKeyboard(flow)] }
      )
    },
    onCallback: async (ctx, runtime, parsed) => {
      if (parsed.action !== 'confirm') {
        await safeAnswerOnCallback(ctx, { notification: 'Действие недоступно' })
        return
      }

      if (parsed.value === 'legal_ack') {
        const nextPayload = withListing(runtime, (_listing, payload) => {
          payload.meta = payload.meta ?? {}
          payload.meta.legalAccepted = true
        })
        await safeAnswerOnCallback(ctx, { notification: 'Спасибо! Продолжаем.' })
        await transitionToStep(ctx, runtime.user, FLOW_STEP_MAP[flow].CONFIRM, nextPayload, { skipIntro: true })
        return
      }

      if (parsed.value === 'publish') {
        const meta = runtime.payload?.meta ?? {}
        if (flow === FLOWS.FOUND && !meta.legalAccepted) {
          await safeAnswerOnCallback(ctx, { notification: 'Сначала подтвердите предупреждение' })
          await sendLegalAcknowledgement(ctx, runtime)
          return
        }

        await safeAnswerOnCallback(ctx, { notification: 'Публикуем...' })
        try {
          const { listingId, listingTitle, listingType, matches } = await publishListing(runtime)
          await ctx.reply(`✅ Объявление опубликовано!\nID: ${listingId}`)

          if (runtime.user?.userId) {
            const previewTitle = formatListingTitle(listingTitle)
            await createNotification({
              userId: runtime.user.userId,
              type: NotificationType.LISTING_PUBLISHED,
              listingId,
              title: `Опубликовано: «${previewTitle}»`,
              body: 'Только что добавили объявление. Нажмите «Показать», чтобы увидеть карточку.',
              status: NotificationStatus.UNREAD,
              payload: {
                listingId,
                listingTitle,
                listingType
              }
            })
          }

          if (matches.length > 0) {
            if (runtime.user?.userId) {
              for (const match of matches) {
                const score = Math.round(match.score)
                const matchTitle = formatListingTitle(match.title)
                await createNotification({
                  userId: runtime.user.userId,
                  type: NotificationType.MATCH_FOUND,
                  listingId: match.id,
                  title: `Совпадение (${score}%) — «${matchTitle}»`,
                  body: [
                    `Мы нашли объявление, которое похоже подходит.`,
                    `Совпадение: ${score}%`
                  ].join('\n'),
                  status: NotificationStatus.ACTION,
                  payload: {
                    originId: listingId,
                    originType: listingType,
                    targetId: match.id,
                    targetTitle: match.title,
                    score
                  }
                })
              }
            }

            const heading = runtime.flow === FLOWS.LOST ? 'Похожие находки' : 'Похожие потери'
            const items = matches
              .map(match => `• ${Math.round(match.score)} баллов — ${match.title}`)
              .join('\n')
            await ctx.reply(`${heading} поблизости:\n${items}`, {
              attachments: [buildMatchesKeyboard(flow, matches, listingId)]
            })
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

function createOwnerCheckIntroHandler() {
  return {
    enter: async (ctx, runtime) => {
      const data = runtime.payload?.ownerCheck
      if (!data) {
        await ctx.reply('Сессия проверки не найдена. Попробуйте начать заново.')
        await sendMainMenu(ctx)
        return
      }

      const total = data.questions?.length ?? 0

      await ctx.reply(
        [
          '🛡️ Проверка владельца',
          '',
          total === 1
            ? 'Ответьте на один вопрос, чтобы подтвердить, что вещь принадлежит вам.'
            : `Ответьте на ${total} вопроса, чтобы подтвердить, что вещь принадлежит вам.`,
          'Пишите подробный ответ без личных контактов и переводов.',
          '',
          'Нажмите /cancel, если передумали.'
        ].join('\n')
      )

      await transitionToStep(ctx, runtime.user, STEPS.OWNER_CHECK_QUESTION, runtime.payload, { skipIntro: true })
    }
  }
}

function createOwnerCheckQuestionHandler() {
  return {
    enter: async (ctx, runtime) => {
      const data = runtime.payload?.ownerCheck
      if (!data) {
        await ctx.reply('Сессия проверки не найдена. Попробуйте начать заново.')
        await sendMainMenu(ctx)
        return
      }

      const { questions = [], index = 0 } = data

      if (index >= questions.length) {
        await transitionToStep(ctx, runtime.user, STEPS.OWNER_CHECK_WAITING, runtime.payload, { skipIntro: true })
        return
      }

      const question = questions[index]
      await ctx.reply(`Вопрос ${index + 1} из ${questions.length}:\n${question.question}`)
    },
    onMessage: async (ctx, runtime, message) => {
      const text = (message.text ?? '').trim()
      const data = runtime.payload?.ownerCheck

      if (!data) {
        await ctx.reply('Сессия проверки не найдена. Начните заново.')
        await sendMainMenu(ctx)
        return
      }

      if (!text) {
        await ctx.reply('Заполните ответ текстом. Поделитесь подробностями, которые знаете.')
        return
      }

      const { questions = [], index = 0, answers = [] } = data

      if (index >= questions.length) {
        await transitionToStep(ctx, runtime.user, STEPS.OWNER_CHECK_WAITING, runtime.payload, { skipIntro: true })
        return
      }

      const question = questions[index]
      const nextAnswers = [...answers, { question: question.question, answer: text }]

      await appendSystemMessage(data.chatId, `Ответ на вопрос ${index + 1}: ${text}`, {
        type: 'owner_answer',
        question: question.question,
        step: index + 1
      })

      const hasMore = index + 1 < questions.length

      const nextPayload = {
        ...runtime.payload,
        ownerCheck: {
          ...data,
          answers: nextAnswers,
          index: data.index + 1
        }
      }

      await saveStateRecord(
        runtime.user.userId,
        hasMore ? STEPS.OWNER_CHECK_QUESTION : STEPS.OWNER_CHECK_WAITING,
        nextPayload
      )

      if (hasMore) {
        await transitionToStep(ctx, runtime.user, STEPS.OWNER_CHECK_QUESTION, nextPayload, { skipIntro: true })
      } else {
        await ctx.reply('Спасибо! Мы отправили ваши ответы владельцу. Подождите подтверждения.')
        await notifyOwnerForReview(nextPayload.ownerCheck)
        await transitionToStep(ctx, runtime.user, STEPS.OWNER_CHECK_WAITING, nextPayload, { skipIntro: true })
      }
    }
  }
}

function createOwnerCheckWaitingHandler() {
  return {
    enter: async ctx => {
      await ctx.reply('⌛ Ожидаем решение владельца. Мы сообщим, как только он ответит.')
    },
    onMessage: async ctx => {
      await ctx.reply('Пока ждём решение владельца. Вы получите уведомление автоматически.')
    }
  }
}

function createVolunteerIntroHandler() {
  return {
    enter: async (ctx, runtime) => {
      const copy = FLOW_COPY[FLOWS.VOLUNTEER]
      const lines = [
        '🐾 Волонтёрим вместе!',
        '',
        copy.introText,
        '',
        'Чтобы подобрать ближайшие заявки, отправьте геопозицию с помощью вложения «📍» или напишите /skip, если хотите посмотреть общий список.',
        '',
        'Если хотите получать уведомления автоматически, заглядывайте в раздел «🔔 Уведомления».'
      ]

      await ctx.reply(lines.join('\n'), {
        attachments: [buildVolunteerLocationKeyboard()]
      })

      await transitionToStep(ctx, runtime.user, STEPS.VOLUNTEER_LOCATION, runtime.payload, { skipIntro: true })
    },
    onMessage: async ctx => {
      await ctx.reply('Отправьте геопозицию через вложение или напишите /skip.')
    }
  }
}

function createVolunteerLocationHandler() {
  return {
    enter: async (ctx, runtime) => {
      await ctx.reply('Жду геопозицию. Если не получается отправить точку, напишите /skip или нажмите кнопку ниже.', {
        attachments: [buildVolunteerLocationKeyboard()]
      })
    },
    onMessage: async (ctx, runtime, message) => {
      if (isSkipCommand(message.lower)) {
        const nextPayload = withVolunteerPayload(runtime, volunteer => {
          volunteer.location = null
        })
        await transitionToStep(ctx, runtime.user, STEPS.VOLUNTEER_LIST, nextPayload, { skipIntro: true })
        return
      }

      if (message.location) {
        const { latitude, longitude } = message.location
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          const nextPayload = withVolunteerPayload(runtime, volunteer => {
            volunteer.location = { latitude, longitude }
          })
          await transitionToStep(ctx, runtime.user, STEPS.VOLUNTEER_LIST, nextPayload, { skipIntro: true })
          return
        }
      }

      await ctx.reply('Не удалось распознать геопозицию. Попробуйте снова или напишите /skip.')
    },
    onCallback: async (ctx, runtime, parsed) => {
      if (parsed.action === 'location_skip') {
        const nextPayload = withVolunteerPayload(runtime, volunteer => {
          volunteer.location = null
        })
        await safeAnswerOnCallback(ctx, { notification: 'Показываю общий список' })
        await transitionToStep(ctx, runtime.user, STEPS.VOLUNTEER_LIST, nextPayload, { skipIntro: true })
        return
      }

      await safeAnswerOnCallback(ctx, { notification: 'Отправьте геопозицию или /skip' })
    }
  }
}

function createVolunteerListHandler() {
  return {
    enter: async (ctx, runtime) => {
      await sendVolunteerListings(ctx, runtime)
    },
    onMessage: async ctx => {
      await ctx.reply('Нажмите «🔄 Обновить» или выберите карточку из списка.')
    },
    onCallback: async (ctx, runtime, parsed) => {
      if (parsed.action === 'refresh') {
        await safeAnswerOnCallback(ctx, { notification: 'Обновляю список' })
        await sendVolunteerListings(ctx, runtime, { refresh: true })
        return
      }

      if (parsed.action === 'preview') {
        await safeAnswerOnCallback(ctx, { notification: 'Открываем карточку' })
        await handleVolunteerListingTap(ctx, runtime, parsed.value)
        return
      }

      if (parsed.action === 'accept') {
        await safeAnswerOnCallback(ctx, { notification: 'Сообщаем владельцу' })
        await handleVolunteerAcceptAction(ctx, runtime, parsed.value)
        return
      }

      if (parsed.action === 'back') {
        await safeAnswerOnCallback(ctx, { notification: 'Возвращаю список' })
        await handleVolunteerBackAction(ctx, runtime)
        return
      }

      await safeAnswerOnCallback(ctx, { notification: 'Действие не поддерживается' })
    }
  }
}

function createMyListHandler() {
  return {
    enter: async (ctx, runtime) => {
      const userId = runtime.user?.userId
      if (!userId) {
        await ctx.reply('Не удалось определить пользователя. Попробуйте позже.')
        await sendMainMenu(ctx)
        return
      }

      const listings = await fetchMyListings(userId)

      if (!listings.length) {
        await clearStateRecord(userId)
        const emptyText = FLOW_COPY[FLOWS.MY].emptyText
        await ctx.reply(`📂 ${emptyText}`)
        await sendMainMenu(ctx, 'Готовы создать первое объявление?')
        return
      }

      const nextPayload = withMyPayload(runtime, my => {
        my.items = listings
        my.editingId = null
      })
      await saveStateRecord(userId, STEPS.MY_LIST, nextPayload)

      await ctx.reply(`📂 Ваши объявления (${listings.length})`)
      await sendMyListings(ctx, listings)

      await ctx.reply('Выберите объявление, чтобы посмотреть или изменить его.', {
        attachments: [
          inlineKeyboard([
            [button.callback('🔄 Обновить список', buildFlowPayload(FLOWS.MY, 'refresh'))],
            [button.callback('⬅️ Главное меню', buildFlowPayload(FLOWS.MY, 'back'))]
          ])
        ]
      })
    },
    onMessage: async ctx => {
      await ctx.reply('Используйте кнопки под объявлениями или «🔄 Обновить список».')
    },
    onCallback: async (ctx, runtime, parsed) => {
      const userId = runtime.user?.userId
      switch (parsed.action) {
        case 'refresh': {
          await safeAnswerOnCallback(ctx, { notification: 'Обновляю список' })
          const listings = await fetchMyListings(userId)
          if (!listings.length) {
            await clearStateRecord(userId)
            await ctx.reply('📂 Объявлений больше нет.')
            await sendMainMenu(ctx)
            return
          }
          const nextPayload = withMyPayload(runtime, my => {
            my.items = listings
            my.editingId = null
          })
          await saveStateRecord(userId, STEPS.MY_LIST, nextPayload)
          await ctx.reply('📂 Обновлённый список:')
          await sendMyListings(ctx, listings)
          return
        }
        case 'edit_menu': {
          const listingId = parsed.value
          if (!listingId) {
            await safeAnswerOnCallback(ctx, { notification: 'ID объявления не найден' })
            return
          }
          const nextPayload = withMyPayload(runtime, my => {
            my.editingId = listingId
          })
          await saveStateRecord(userId, STEPS.MY_EDIT_MENU, nextPayload)
          await safeAnswerOnCallback(ctx, { notification: 'Настройка объявления' })
          await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, nextPayload, { skipIntro: true })
          return
        }
        case 'toggle_status': {
          const listingId = parsed.value
          if (!listingId) {
            await safeAnswerOnCallback(ctx, { notification: 'ID объявления не найден' })
            return
          }
          const nextStatus = await toggleListingStatus(listingId, userId)
          if (!nextStatus) {
            await safeAnswerOnCallback(ctx, { notification: 'Не удалось изменить статус' })
            return
          }
          const statusLabel = nextStatus === 'ACTIVE' ? 'Объявление снова активно' : 'Объявление закрыто'
          const listings = await fetchMyListings(userId)
          if (!listings.length) {
            await clearStateRecord(userId)
            await safeAnswerOnCallback(ctx, { notification: statusLabel })
            await ctx.reply('📂 Объявлений больше нет.')
            await sendMainMenu(ctx)
            return
          }
          const nextPayload = withMyPayload(runtime, my => {
            my.items = listings
            my.editingId = null
          })
          await saveStateRecord(userId, STEPS.MY_LIST, nextPayload)
          await safeAnswerOnCallback(ctx, { notification: statusLabel })
          await ctx.reply('📂 Обновлённый список:')
          await sendMyListings(ctx, listings)
          return
        }
        case 'back': {
          await safeAnswerOnCallback(ctx, { notification: 'Главное меню' })
          await clearStateRecord(userId)
          await sendMainMenu(ctx)
          return
        }
        default:
          await safeAnswerOnCallback(ctx, { notification: 'Действие не поддерживается' })
      }
    }
  }
}

function createMyEditDescriptionHandler() {
  return {
    enter: async (ctx, runtime) => {
      const listing = await ensureEditableListing(ctx, runtime)
      if (!listing) {
        return
      }

      await ctx.reply(
        [
          '💬 Текущее описание:',
          listing.description?.trim?.() ? truncateText(listing.description, 500) : '— нет описания —',
          '',
          'Отправьте новое описание. Можно использовать несколько предложений.',
          '',
          'Команды: /back — вернуться в меню, /cancel — выйти в главное меню.'
        ].join('\n')
      )
    },
    onMessage: async (ctx, runtime, message) => {
      const lower = message.lower ?? ''
      if (CANCEL_KEYWORDS.includes(lower)) {
        await clearStateRecord(runtime.user.userId)
        await ctx.reply('Редактирование отменено.')
        await sendMainMenu(ctx)
        return
      }

      if (BACK_KEYWORDS.includes(lower)) {
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, runtime.payload, { skipIntro: true })
        return
      }

      const editingId = runtime.payload?.my?.editingId
      if (!editingId) {
        await ctx.reply('Не найдено объявление для обновления.')
        await transitionToStep(ctx, runtime.user, STEPS.MY_LIST, runtime.payload, { skipIntro: true })
        return
      }

      const text = message.text?.trim?.() ?? ''
      if (text.length < 10) {
        await ctx.reply('Опишите находку или потерю чуть подробнее (минимум 10 символов).')
        return
      }

      const updated = await updateListingDescription(editingId, runtime.user.userId, text)
      if (!updated) {
        await ctx.reply('Не удалось обновить описание. Попробуйте позже.')
        return
      }

      const nextPayload = withMyPayload(runtime, my => {
        my.editingId = editingId
        if (Array.isArray(my.items)) {
          const item = my.items.find(entry => entry.id === editingId)
          if (item) {
            item.description = text
          }
        }
      })

      await ctx.reply('Описание обновлено ✅')
      await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, nextPayload, { skipIntro: true })
    },
    onCallback: async (ctx, runtime, parsed) => {
      if (parsed.action === 'back_to_list') {
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, runtime.payload, { skipIntro: true })
        return
      }
      await safeAnswerOnCallback(ctx, { notification: 'Отправьте текст или /back' })
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
    [button.callback('✅ Опубликовать', buildFlowPayload(flow, 'confirm', 'publish'))],
    [
      button.callback('✏️ Изменить описание', buildFlowPayload(flow, 'confirm', 'edit')),
      button.callback('❌ Отменить', buildFlowPayload(flow, 'cancel'))
    ],
    [button.callback('⬅️ Главное меню', buildFlowPayload(flow, 'menu'))]
  ])
}

async function sendLegalAcknowledgement(ctx, runtime) {
  const currentFlow = runtime.flow ?? FLOWS.FOUND
  const listing = runtime.payload?.listing ?? {}
  const lines = [
    LEGAL_COPY.foundGeneral,
    '',
    '📌 Если временно храните находку у себя, сообщите о ней в полицию или ОМСУ в течение 3 дней.',
    '',
    LEGAL_COPY.foundSixMonths
  ]

  if (listing.category === 'pet') {
    lines.push('', LEGAL_COPY.foundPet)
  }

  lines.push('', 'Подтвердите, что ознакомлены с правилами:')

  await ctx.reply(lines.join('\n'), {
    attachments: [
      inlineKeyboard([
        [button.callback('✅ Ознакомлен', buildFlowPayload(currentFlow, 'confirm', 'legal_ack'))],
        [button.callback('❌ Отменить', buildFlowPayload(currentFlow, 'cancel'))]
      ])
    ]
  })
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

function describeLocationMode(mode) {
  switch (mode) {
    case LOCATION_MODES.EXACT:
      return 'точная точка'
    case LOCATION_MODES.APPROX:
      return 'примерное место'
    case LOCATION_MODES.TRANSIT:
      return 'в пути / транспорт'
    default:
      return 'не указано'
  }
}

function buildSecretsSummary(flow, entries = []) {
  if (!entries || entries.length === 0) {
    return '—'
  }

  if (flow === FLOWS.FOUND) {
    return '\n - ' + entries.map(entry => (entry.question || 'Вопрос')).join('\n - ')
  }

  return `${entries.length} шт. (будут доступны только вам)`
}

function buildMatchesKeyboard(flow, matches, originId) {
  const rows = matches.slice(0, 3).map(match => [
    button.callback(
      `✉️ Написать (${Math.round(match.score)}%)`,
      buildFlowPayload(flow, 'match', `${match.id}|${originId}`)
    )
  ])

  if (rows.length === 0) {
    return inlineKeyboard([])
  }

  return inlineKeyboard(rows)
}

async function handleMatchAction(ctx, userProfile, runtime, parsed) {
  const { flow, value } = parsed
  const { targetId, originId } = parseMatchValue(value)

  if (!targetId || !originId) {
    await safeAnswerOnCallback(ctx, { notification: 'Не удалось открыть карточку' })
    return
  }

  const claimantId = userProfile.userId
  const originListing = await fetchListingWithSecrets(originId)

  if (!originListing) {
    await safeAnswerOnCallback(ctx, { notification: 'Черновик уже недоступен' })
    return
  }

  if (originListing.author_id !== claimantId) {
    await safeAnswerOnCallback(ctx, { notification: 'Это объявление принадлежит другому пользователю' })
    return
  }

  const targetListing = await fetchListingWithSecrets(targetId)

  if (!targetListing) {
    await safeAnswerOnCallback(ctx, { notification: 'Целевое объявление не найдено' })
    return
  }

  if (targetListing.author_id === originListing.author_id) {
    await safeAnswerOnCallback(ctx, { notification: 'Нельзя начать чат с самим собой' })
    return
  }

  const orientation = `${originListing.type}_${targetListing.type}`

  if (orientation === 'LOST_FOUND') {
    await launchOwnerCheck(ctx, userProfile, runtime, {
      lostListing: originListing,
      foundListing: targetListing
    })
    return
  }

  if (orientation === 'FOUND_LOST') {
    await safeAnswerOnCallback(ctx, { notification: 'Запрос отправлен владельцу' })
    await ctx.reply(
      'Ожидайте, пока владелец выберет вашу находку и ответит на секретные вопросы. После подтверждения вы получите его контакты.'
    )
    return
  }

  await safeAnswerOnCallback(ctx, { notification: 'Не поддерживается' })
}

async function launchOwnerCheck(ctx, userProfile, runtime, { lostListing, foundListing }) {
  const questions = foundListing.secrets
    .filter(secret => secret.question)
    .map(secret => ({
      id: secret.id,
      question: secret.question
    }))

  const chat = await getOrCreateOwnerCheckChat({
    lostListingId: lostListing.id,
    foundListingId: foundListing.id,
    initiatorId: userProfile.userId,
    holderId: foundListing.author_id,
    claimantId: lostListing.author_id
  })

  if (chat.status === 'ACTIVE' || chat.status === 'CLOSED') {
    await safeAnswerOnCallback(ctx, { notification: 'Контакты уже раскрыты' })
    await revealContacts(foundListing.author_id, lostListing.author_id, {
      chatId: chat.id,
      listingTitle: foundListing.title ?? lostListing.title
    })
    return
  }

  const ownerCheckData = {
    flow: FLOWS.OWNER,
    ownerCheck: {
      chatId: chat.id,
      lostListingId: lostListing.id,
      foundListingId: foundListing.id,
      holderId: foundListing.author_id,
      claimantId: lostListing.author_id,
      questions,
      answers: [],
      index: 0,
      lostTitle: lostListing.title,
      foundTitle: foundListing.title
    }
  }

  await updateChatStatus(chat.id, 'PENDING')

  if (questions.length === 0) {
    await saveStateRecord(lostListing.author_id, STEPS.OWNER_CHECK_WAITING, ownerCheckData)
    await notifyOwnerForReview(ownerCheckData.ownerCheck)
    await safeAnswerOnCallback(ctx, { notification: 'Заявка отправлена' })
    await ctx.reply('Мы отправили заявку найденному. Ждите подтверждения — если он согласится, вы получите его контакт.')
    return
  }

  await saveStateRecord(userProfile.userId, STEPS.OWNER_CHECK_INTRO, ownerCheckData)
  await transitionToStep(ctx, userProfile, STEPS.OWNER_CHECK_INTRO, ownerCheckData)
  await safeAnswerOnCallback(ctx, { notification: 'Начинаем проверку владельца' })
}

async function handleOwnerReviewAction(ctx, userProfile, value) {
  const { chatId, decision } = parseOwnerReviewValue(value)
  if (!chatId || !decision) {
    await safeAnswerOnCallback(ctx, { notification: 'Не удалось обработать ответ' })
    return
  }

  const chat = await fetchChatById(chatId)
  if (!chat) {
    await safeAnswerOnCallback(ctx, { notification: 'Чат уже завершён' })
    return
  }

  const participants = await fetchChatMembers(chatId)
  const holder = participants.find(member => member.role === 'HOLDER')
  const claimant = participants.find(member => member.role === 'CLAIMANT')

  if (!holder || holder.user_id !== userProfile.userId) {
    await safeAnswerOnCallback(ctx, { notification: 'У вас нет прав на это действие' })
    return
  }

  const foundTitle = await fetchListingTitle(chat.found_listing_id)
  const lostTitle = await fetchListingTitle(chat.lost_listing_id)

  if (decision === 'confirm') {
    if (chat.status === 'CLOSED') {
      await safeAnswerOnCallback(ctx, { notification: 'Контакты уже раскрыты' })
      await notifyUser(holder.user_id, 'Контакты уже обменены. Проверьте уведомления.')
      return
    }

    if (chat.status === 'ACTIVE') {
      await safeAnswerOnCallback(ctx, { notification: 'Уже ждём обмена контактами' })
      await notifyUser(holder.user_id, 'Мы уже ждём, пока потерявший поделится контактом. Напомните ему при необходимости.')
      return
    }

    await updateChatStatus(chatId, 'ACTIVE')
    await safeAnswerOnCallback(ctx, { notification: 'Ответы совпали' })

    const exchangeKeyboard = inlineKeyboard([
      [button.callback('🤝 Обменяться контактами', buildFlowPayload(FLOWS.OWNER, 'contact_request', chatId))]
    ])

    await notifyUser(
      holder.user_id,
      [
        '✅ Ответы совпали!',
        '',
        'Нажмите «Обменяться контактами», чтобы отправить запрос владельцу. После этого он увидит вашу карточку в уведомлениях.'
      ].join('\n'),
      [exchangeKeyboard]
    )

    await upsertNotification(
      { userId: holder.user_id, type: NotificationType.OWNER_REVIEW, chatId },
      {
        title: `Заявка по находке «${formatListingTitle(foundTitle)}»`,
        body: 'Вы подтвердили, что ответы совпадают. Запросите обмен контактами, когда будете готовы передать вещь.',
        status: NotificationStatus.RESOLVED,
        payload: {
          chatId,
          listingTitle: foundTitle
        }
      }
    )

    await upsertNotification(
      { userId: holder.user_id, type: NotificationType.CONTACT_SHARE_REQUEST, chatId },
      {
        title: `Обмен контактами — «${formatListingTitle(foundTitle)}»`,
        body: 'Нажмите кнопку ниже, чтобы отправить запрос владельцу на обмен контактами.',
        status: NotificationStatus.ACTION,
        payload: {
          chatId,
          listingTitle: foundTitle
        }
      }
    )

    if (claimant) {
      await upsertNotification(
        { userId: claimant.user_id, type: NotificationType.OWNER_WAITING, chatId },
        {
          title: `Проверка по объявлению «${formatListingTitle(foundTitle || lostTitle)}»`,
          body: 'Нашедший подтвердил ответы. Скоро он запросит обмен контактами — следите за уведомлениями.',
          status: NotificationStatus.UNREAD,
          payload: {
            chatId,
            listingTitle: foundTitle || lostTitle
          }
        }
      )

      await notifyUser(
        claimant.user_id,
        '✅ Нашедший подтвердил ваши ответы. Как только он отправит запрос, мы попросим вас поделиться контактом.'
      )
    }

    await clearStateRecord(holder.user_id)
    return
  }

  if (decision === 'decline') {
    await updateChatStatus(chatId, 'DECLINED')
    await safeAnswerOnCallback(ctx, { notification: 'Ответы не совпали' })
    await notifyUser(holder.user_id, 'Вы отклонили претендента. Чат закрыт.')

    await upsertNotification(
      { userId: holder.user_id, type: NotificationType.OWNER_REVIEW, chatId },
      {
        title: `Заявка по находке «${formatListingTitle(foundTitle)}»`,
        body: 'Вы отклонили претендента. Если появится другой запрос, мы сообщим.',
        status: NotificationStatus.RESOLVED,
        payload: {
          chatId,
          listingTitle: foundTitle
        }
      }
    )

    if (claimant) {
      await notifyUser(
        claimant.user_id,
        '⚠️ Ответы не совпали. Попробуйте перепроверить данные или добавить больше деталей в объявление.'
      )

      await upsertNotification(
        { userId: claimant.user_id, type: NotificationType.OWNER_WAITING, chatId },
        {
          title: `Проверка по объявлению «${formatListingTitle(foundTitle || lostTitle)}»`,
          body: 'Ответы не совпали. Попробуйте уточнить данные или создать новое объявление.',
          status: NotificationStatus.RESOLVED,
          payload: {
            chatId,
            listingTitle: foundTitle || lostTitle
          }
        }
      )

      await createNotification({
        userId: claimant.user_id,
        type: NotificationType.OWNER_DECLINED,
        chatId,
        title: `Заявка отклонена — «${formatListingTitle(foundTitle || lostTitle)}»`,
        body: 'Нашедший указал, что ответы не совпали. Попробуйте уточнить информацию или добавить дополнительные приметы.',
        status: NotificationStatus.UNREAD,
        payload: {
          chatId,
          listingTitle: foundTitle || lostTitle
        }
      })
    }

    await clearStateRecord(holder.user_id)
    return
  }

  await safeAnswerOnCallback(ctx, { notification: 'Действие не поддерживается' })
}

async function handleOwnerContactRequest(ctx, userProfile, chatId) {
  if (!chatId) {
    await safeAnswerOnCallback(ctx, { notification: 'Чат не найден' })
    return
  }

  const chat = await fetchChatById(chatId)
  if (!chat) {
    await safeAnswerOnCallback(ctx, { notification: 'Чат уже завершён' })
    return
  }

  const participants = await fetchChatMembers(chatId)
  const holder = participants.find(member => member.role === 'HOLDER')
  const claimant = participants.find(member => member.role === 'CLAIMANT')

  if (!holder || holder.user_id !== userProfile.userId) {
    await safeAnswerOnCallback(ctx, { notification: 'У вас нет прав на это действие' })
    return
  }

  if (chat.status === 'DECLINED') {
    await safeAnswerOnCallback(ctx, { notification: 'Заявка уже отклонена' })
    return
  }

  if (chat.status === 'PENDING') {
    await safeAnswerOnCallback(ctx, { notification: 'Сначала подтвердите совпадение ответов' })
    return
  }

  if (chat.status === 'CLOSED') {
    await safeAnswerOnCallback(ctx, { notification: 'Контакты уже раскрыты' })
    await notifyUser(holder.user_id, 'Контакты уже обменены. Проверьте уведомления.')
    return
  }

  await safeAnswerOnCallback(ctx, { notification: 'Запрос отправлен' })

  const foundTitle = await fetchListingTitle(chat.found_listing_id)

  await upsertNotification(
    { userId: holder.user_id, type: NotificationType.CONTACT_SHARE_REQUEST, chatId },
    {
      title: `Обмен контактами — «${formatListingTitle(foundTitle)}»`,
      body: 'Запрос отправлен потерявшему. Ждём, пока он поделится контактом.',
      status: NotificationStatus.RESOLVED,
      payload: {
        chatId,
        listingTitle: foundTitle
      }
    }
  )

  await notifyUser(
    holder.user_id,
    'Запрос отправлен владельцу. Как только он поделится контактом, мы откроем данные в уведомлениях.'
  )

  if (!claimant) {
    return
  }

  const holderContact = await fetchUserContact(holder.user_id)
  const claimantContact = await fetchUserContact(claimant.user_id)
  const claimantHasPhone = Boolean(claimantContact?.phone)

  if (claimantHasPhone) {
    await finalizeContactExchange(chatId, {
      listingTitle: foundTitle
    })
    return
  }

  const maskedBody = [
    `Пользователь, нашедший «${formatListingTitle(foundTitle)}», готов связаться.`,
    '',
    formatContactAnnouncement('нашедшего', holderContact, { maskPhone: true, postscript: '' }),
    '',
    'Поделитесь своим номером, чтобы открыть телефон нашедшего.'
  ].join('\n')

  await upsertNotification(
    { userId: claimant.user_id, type: NotificationType.OWNER_APPROVED, chatId },
    {
      title: `Связаться по объявлению «${formatListingTitle(foundTitle)}»`,
      body: maskedBody,
      status: NotificationStatus.ACTION,
      payload: {
        chatId,
        listingTitle: foundTitle
      }
    }
  )

  await upsertNotification(
    { userId: claimant.user_id, type: NotificationType.OWNER_WAITING, chatId },
    {
      status: NotificationStatus.RESOLVED,
      payload: {
        chatId,
        listingTitle: foundTitle
      }
    }
  )

  await notifyUser(
    claimant.user_id,
    [
      '🔔 Нашедший подтвердил совпадение и готов связаться.',
      '',
      'Нажмите «Поделиться контактом» в уведомлениях — мы откроем телефон нашедшего после того, как вы отправите свой номер.'
    ].join('\n')
  )
}

async function handleOwnerShareContactAction(ctx, userProfile, chatId) {
  if (!chatId) {
    await safeAnswerOnCallback(ctx, { notification: 'Чат не найден' })
    return
  }

  const chat = await fetchChatById(chatId)
  if (!chat) {
    await safeAnswerOnCallback(ctx, { notification: 'Чат уже завершён' })
    return
  }

  const participants = await fetchChatMembers(chatId)
  const holder = participants.find(member => member.role === 'HOLDER')
  const claimant = participants.find(member => member.role === 'CLAIMANT')

  if (!claimant || claimant.user_id !== userProfile.userId) {
    await safeAnswerOnCallback(ctx, { notification: 'У вас нет доступа к этому запросу' })
    return
  }

  if (chat.status === 'PENDING') {
    await safeAnswerOnCallback(ctx, { notification: 'Запрос ещё не отправлен нашедшим' })
    return
  }

  if (chat.status === 'CLOSED') {
    await safeAnswerOnCallback(ctx, { notification: 'Контакты уже раскрыты' })
    await notifyUser(claimant.user_id, 'Контакты уже доступны. Проверьте уведомления.')
    return
  }

  const claimantContact = await fetchUserContact(claimant.user_id)
  if (claimantContact?.phone) {
    await safeAnswerOnCallback(ctx, { notification: 'Контакт уже передан' })
    await finalizeContactExchange(chatId, {
      listingTitle: await fetchListingTitle(chat.found_listing_id)
    })
    return
  }

  await safeAnswerOnCallback(ctx, { notification: 'Ждём номер' })

  const shareKeyboard = inlineKeyboard([[button.requestContact('Отправить номер из MAX')]])

  await ctx.reply(
    [
      'Чтобы открыть контакты нашедшего, поделитесь своим номером.',
      '',
      'Нажмите кнопку «Отправить номер из MAX» ниже. Если кнопка не работает, воспользуйтесь стандартной функцией MAX «Поделиться контактом».'
    ].join('\n'),
    { attachments: [shareKeyboard] }
  )
}

async function handleShowListingAction(ctx, userProfile, listingId) {
  if (!listingId) {
    await safeAnswerOnCallback(ctx, { notification: 'ID объявления не передан' })
    return
  }

  let listing = await fetchListingForPreview(listingId, userProfile.userId)

  if (!listing) {
    const allowed = await userHasListingAccess(userProfile.userId, listingId)
    if (!allowed) {
      await safeAnswerOnCallback(ctx, { notification: 'Объявление недоступно' })
      return
    }
    listing = await fetchListingForPreview(listingId)
  }

  if (!listing) {
    await safeAnswerOnCallback(ctx, { notification: 'Объявление недоступно' })
    return
  }

  await safeAnswerOnCallback(ctx, { notification: 'Показываю карточку' })

  const message = formatListingPreview(listing)
  const attachments = buildListingPreviewAttachments(listing)

  if (attachments) {
    await ctx.reply(message, { attachments })
    return
  }

  await ctx.reply(message)
}

function parseMatchValue(value = '') {
  if (!value) {
    return { targetId: null, originId: null }
  }
  const [targetId, originId] = value.split('|')
  return { targetId: targetId || null, originId: originId || null }
}

function parseOwnerReviewValue(value = '') {
  if (!value) {
    return { chatId: null, decision: null }
  }
  const [chatId, decision] = value.split('|')
  return { chatId: chatId || null, decision: decision || null }
}

function buildOwnerReviewKeyboard(chatId) {
  return inlineKeyboard([
    [
      button.callback('✅ Совпадает', buildFlowPayload(FLOWS.OWNER, 'review', `${chatId}|confirm`)),
      button.callback('❌ Не совпало', buildFlowPayload(FLOWS.OWNER, 'review', `${chatId}|decline`))
    ]
  ])
}

function buildOwnerReviewSummary(answers = []) {
  if (!answers.length) {
    return 'Ответов нет.'
  }

  const lines = answers.map((entry, idx) => {
    const number = idx + 1
    return `Вопрос ${number}: ${entry.question}\nОтвет: ${entry.answer}`
  })

  return lines.join('\n\n')
}

async function notifyUser(userId, text, attachments) {
  if (!userId) return
  const maxId = await fetchUserMaxId(userId)
  if (!maxId) return
  await notifyMaxUser(maxId, text, attachments)
}

async function notifyMaxUser(maxId, text, attachments) {
  try {
    const { sendMessage: sendMaxMessage } = await import('./max.js')
    await sendMaxMessage(maxId, text, attachments ? { attachments } : undefined)
  } catch (error) {
    console.error('[FSM] Не удалось отправить уведомление:', error)
  }
}

async function fetchUserMaxId(userId) {
  if (!userId) return null
  const [rows] = await pool.query('SELECT max_id FROM users WHERE id = ? LIMIT 1', [userId])
  if (rows.length === 0) return null
  return rows[0].max_id
}

async function fetchListingTitle(listingId) {
  if (!listingId) {
    return null
  }

  const [rows] = await pool.query('SELECT title FROM listings WHERE id = ? LIMIT 1', [listingId])
  if (rows.length === 0) {
    return null
  }
  return rows[0].title ?? null
}

async function fetchListingWithSecrets(listingId) {
  const [rows] = await pool.query('SELECT * FROM listings WHERE id = ? LIMIT 1', [listingId])
  if (rows.length === 0) {
    return null
  }
  const listing = rows[0]

  const [secretRows] = await pool.query(
    'SELECT id, cipher FROM secrets WHERE listing_id = ? ORDER BY created_at ASC',
    [listingId]
  )

  const secrets = secretRows
    .map(row => {
      try {
        const payload = JSON.parse(row.cipher ?? '{}')
        return {
          id: row.id,
          question: payload.question ?? '',
          answer: decryptSecret(payload.cipher ?? payload)
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)

  return { ...listing, secrets }
}

async function notifyOwnerForReview(ownerCheck) {
  if (!ownerCheck) return
  const { holderId, claimantId, chatId, answers = [], questions = [], foundTitle } = ownerCheck
  if (!holderId || !chatId) return

  const summaryText = buildOwnerReviewSummary(answers)

  await appendSystemMessage(chatId, summaryText, {
    type: 'owner_review',
    questions,
    answers
  })

  await saveStateRecord(holderId, STEPS.OWNER_CHECK_WAITING, {
    flow: FLOWS.OWNER,
    ownerCheck
  })

  const keyboard = buildOwnerReviewKeyboard(chatId)
  await notifyUser(
    holderId,
    [
      `🔐 Кто-то хочет забрать находку «${foundTitle ?? 'без названия'}».`,
      '',
      summaryText,
      '',
      'Сравните ответы с секретами и выберите действие.'
    ].join('\n'),
    [keyboard]
  )

  const holderTitle = `Заявка по находке «${formatListingTitle(foundTitle)}»`
  await upsertNotification(
    { userId: holderId, type: NotificationType.OWNER_REVIEW, chatId },
    {
      title: holderTitle,
      body: [
        'Пользователь утверждает, что вещь принадлежит ему.',
        '',
        summaryText,
        '',
        'Сравните ответы с вашими секретами и решите, совпадает ли всё.'
      ].join('\n'),
      status: NotificationStatus.ACTION,
      payload: {
        chatId,
        answers,
        questions,
        listingTitle: foundTitle
      }
    }
  )

  if (claimantId) {
    await notifyUser(
      claimantId,
      '📨 Мы отправили ваши ответы человеку, который нашёл предмет. Как только он подтвердит совпадение, мы поделимся контактами.'
    )

    await upsertNotification(
      { userId: claimantId, type: NotificationType.OWNER_WAITING, chatId },
      {
        title: `Проверка по объявлению «${formatListingTitle(foundTitle)}»`,
        body: '⌛ Ждём подтверждения найденного. Как только найдётся совпадение, вы увидите результат в уведомлениях.',
        status: NotificationStatus.UNREAD,
        payload: {
          chatId,
          listingTitle: foundTitle
        }
      }
    )
  }
}

async function handleContactShareEvent(userId) {
  if (!userId) {
    return
  }

  const chatIds = new Map()

  const [notificationRows] = await pool.query(
    `SELECT chat_id, payload FROM notifications
     WHERE user_id = ?
       AND type = ?
       AND status = ?`,
    [userId, NotificationType.OWNER_APPROVED, NotificationStatus.ACTION]
  )

  for (const row of notificationRows) {
    if (!row.chat_id) continue
    let payload = {}
    try {
      payload = row.payload ? JSON.parse(row.payload) : {}
    } catch {
      payload = {}
    }
    if (!chatIds.has(row.chat_id)) {
      chatIds.set(row.chat_id, payload?.listingTitle ?? null)
    }
  }

  if (chatIds.size === 0) {
    const [activeChats] = await pool.query(
      `SELECT id, found_listing_id, lost_listing_id
       FROM chats
       WHERE claimant_id = ?
         AND status = 'ACTIVE'`,
      [userId]
    )

    for (const chat of activeChats) {
      if (!chatIds.has(chat.id)) {
        chatIds.set(chat.id, null)
      }
    }
  }

  for (const [chatId, title] of chatIds) {
    await finalizeContactExchange(chatId, { listingTitle: title })
  }
}

async function finalizeContactExchange(chatId, { listingTitle } = {}) {
  if (!chatId) {
    return
  }

  const chat = await fetchChatById(chatId)
  if (!chat || chat.status === 'CLOSED') {
    return
  }

  const participants = await fetchChatMembers(chatId)
  const holder = participants.find(member => member.role === 'HOLDER')
  const claimant = participants.find(member => member.role === 'CLAIMANT')

  if (!holder || !claimant) {
    return
  }

  const effectiveListingTitle =
    listingTitle ??
    (await fetchListingTitle(chat.found_listing_id)) ??
    (await fetchListingTitle(chat.lost_listing_id))

  await updateChatStatus(chatId, 'CLOSED')

  await revealContacts(holder.user_id, claimant.user_id, {
    chatId,
    listingTitle: effectiveListingTitle
  })

  await upsertNotification(
    { userId: claimant.user_id, type: NotificationType.OWNER_WAITING, chatId },
    {
      status: NotificationStatus.RESOLVED,
      payload: {
        chatId,
        listingTitle: effectiveListingTitle
      }
    }
  )

  await clearStateRecord(holder.user_id)
  await clearStateRecord(claimant.user_id)
}

async function revealContacts(holderId, claimantId, options = {}) {
  const { chatId = null, listingTitle = null } = options
  if (!holderId || !claimantId) {
    return
  }

  const holder = await fetchUserContact(holderId)
  const claimant = await fetchUserContact(claimantId)

  const holderText = formatContactAnnouncement('владельца', claimant)
  const claimantText = formatContactAnnouncement('нашедшего', holder)

  if (holderText) {
    await notifyUser(holderId, holderText)
  }

  if (claimantText) {
    await notifyUser(claimantId, claimantText)
  }

  if (!chatId) {
    return
  }

  await upsertNotification(
    { userId: holderId, type: NotificationType.CONTACT_SHARE_REQUEST, chatId },
    {
      status: NotificationStatus.RESOLVED,
      body: 'Контакты владельца открыты. Свяжитесь с ним напрямую.',
      payload: {
        chatId,
        listingTitle
      }
    }
  )

  await upsertNotification(
    { userId: claimantId, type: NotificationType.OWNER_APPROVED, chatId },
    {
      status: NotificationStatus.RESOLVED,
      body: claimantText,
      payload: {
        chatId,
        listingTitle
      }
    }
  )

  await upsertNotification(
    { userId: holderId, type: NotificationType.CONTACT_AVAILABLE, chatId },
    {
      title: `Контакт владельца — «${formatListingTitle(listingTitle)}»`,
      body: holderText,
      status: NotificationStatus.UNREAD,
      payload: {
        chatId,
        listingTitle
      }
    }
  )

  await upsertNotification(
    { userId: claimantId, type: NotificationType.CONTACT_AVAILABLE, chatId },
    {
      title: `Контакт нашедшего — «${formatListingTitle(listingTitle)}»`,
      body: claimantText,
      status: NotificationStatus.UNREAD,
      payload: {
        chatId,
        listingTitle
      }
    }
  )
}

function matchesFlowKeyword(lower, flow) {
  return FLOW_KEYWORDS[flow]?.some(keyword => lower === keyword || lower.startsWith(`${keyword} `))
}

function isSkipCommand(lower = '') {
  return lower === '/skip' || lower === 'skip' || lower === 'пропустить'
}

async function fetchUserContact(userId) {
  if (!userId) return null
  const [rows] = await pool.query('SELECT max_id, phone FROM users WHERE id = ? LIMIT 1', [userId])
  if (rows.length === 0) return null
  return rows[0]
}

function formatContactAnnouncement(roleLabel, contact, options = {}) {
  const { maskPhone = false, postscript = 'Договоритесь о передаче и подтвердите, когда всё успешно завершится.' } = options

  if (!contact) {
    return `📇 Контакт ${roleLabel}: пока нет данных. Попробуйте запросить повторно или свяжитесь через мини-приложение.`
  }

  const parts = [`📇 Контакт ${roleLabel}:`]

  if (contact.phone) {
    const phoneText = maskPhone ? maskPhoneValue(contact.phone) : contact.phone
    parts.push(`• Телефон: ${phoneText}`)
    if (maskPhone) {
      parts.push('• Телефон откроется после того, как вы поделитесь своим контактом.')
    }
  } else {
    parts.push('• Телефон: не передан (попросите поделиться контактом в MAX)')
  }

  if (postscript) {
    parts.push('', postscript)
  }

  return parts.join('\n')
}

function maskPhoneValue(phone) {
  if (!phone) {
    return '********'
  }

  const digits = phone.replace(/\D/g, '')
  const length = Math.max(digits.length, 8)
  return '*'.repeat(length)
}

function buildNotificationView(notification) {
  const statusIcon = getNotificationStatusIcon(notification.status)
  const title = notification.title ?? getDefaultNotificationTitle(notification.type)
  const lines = [`${statusIcon} ${title}`]

  const body = notification.body?.trim?.()
  if (body) {
    lines.push('', body)
  }

  const attachments = buildNotificationAttachments(notification)

  return {
    text: lines.join('\n'),
    attachments
  }
}

function buildNotificationAttachments(notification) {
  const payload = notification.payload ?? {}

  switch (notification.type) {
    case NotificationType.OWNER_REVIEW:
      if (notification.status === NotificationStatus.ACTION && payload.chatId) {
        return [buildOwnerReviewKeyboard(payload.chatId)]
      }
      return null
    case NotificationType.CONTACT_SHARE_REQUEST:
      if (notification.status !== NotificationStatus.ACTION || !payload.chatId) {
        return null
      }
      return [
        inlineKeyboard([
          [button.callback('🤝 Обменяться контактами', buildFlowPayload(FLOWS.OWNER, 'contact_request', payload.chatId))]
        ])
      ]
    case NotificationType.OWNER_APPROVED: {
      const buttons = []
      if (notification.status === NotificationStatus.ACTION && payload.chatId) {
        buttons.push([
          button.callback('📱 Поделиться контактом', buildFlowPayload(FLOWS.OWNER, 'share_contact', payload.chatId))
        ])
      }
      if (notification.status === NotificationStatus.ACTION) {
        buttons.push([button.requestContact('Отправить номер из MAX')])
      }
      return buttons.length > 0 ? [inlineKeyboard(buttons)] : null
    }
    case NotificationType.LISTING_PUBLISHED: {
      const listingId = payload.listingId || notification.listingId
      if (!listingId) {
        return null
      }
      return [
        inlineKeyboard([
          [button.callback('👁️ Показать', buildFlowPayload('menu', 'show_listing', listingId))]
        ])
      ]
    }
    case NotificationType.VOLUNTEER_ASSIGNED: {
      const listingId = payload.listingId || notification.listingId
      if (!listingId) {
        return null
      }
      return [
        inlineKeyboard([
          [button.callback('👁️ Показать карточку', buildFlowPayload('menu', 'show_listing', listingId))]
        ])
      ]
    }
    case NotificationType.MATCH_FOUND: {
      const listingId = payload.targetId || notification.listingId
      const originId = payload.originId
      const originType = payload.originType
      const flow = listingTypeToFlow(originType)

      if (!flow || !listingId || !originId) {
        return null
      }

      const buttons = [
        [
          button.callback(
            '✉️ Проверить и связаться',
            buildFlowPayload(flow, 'match', `${listingId}|${originId}`)
          )
        ]
      ]

      if (listingId) {
        buttons.push([
          button.callback('👁️ Показать карточку', buildFlowPayload('menu', 'show_listing', listingId))
        ])
      }

      return [inlineKeyboard(buttons)]
    }
    default:
      return null
  }
}

function getNotificationStatusIcon(status) {
  switch (status) {
    case NotificationStatus.ACTION:
      return '⏳'
    case NotificationStatus.UNREAD:
      return '🆕'
    case NotificationStatus.RESOLVED:
      return '✅'
    case NotificationStatus.READ:
      return '📬'
    case NotificationStatus.ARCHIVED:
      return '📁'
    default:
      return '🔔'
  }
}

function getDefaultNotificationTitle(type) {
  switch (type) {
    case NotificationType.OWNER_WAITING:
      return 'Проверка владельца'
    case NotificationType.OWNER_REVIEW:
      return 'Новая заявка на находку'
    case NotificationType.OWNER_DECLINED:
      return 'Заявка отклонена'
    case NotificationType.OWNER_APPROVED:
      return 'Найденный готов связаться'
    case NotificationType.CONTACT_SHARE_REQUEST:
      return 'Поделитесь контактом'
    case NotificationType.CONTACT_AVAILABLE:
      return 'Контакты доступны'
    case NotificationType.LISTING_PUBLISHED:
      return 'Новое объявление'
    case NotificationType.VOLUNTEER_ASSIGNED:
      return 'Волонтёр откликнулся'
    case NotificationType.VOLUNTEER_ACTIVE:
      return 'Вы на задании'
    case NotificationType.MATCH_FOUND:
      return 'Появилось совпадение'
    default:
      return 'Уведомление'
  }
}

function formatListingTitle(title) {
  if (!title) {
    return 'без названия'
  }

  const trimmed = String(title).trim()
  if (trimmed.length <= 42) {
    return trimmed
  }
  return `${trimmed.slice(0, 39)}…`
}

async function fetchListingForPreview(listingId, authorId) {
  if (!listingId) {
    return null
  }

  const params = authorId ? [listingId, authorId] : [listingId]
  const [rows] = await pool.query(
    `SELECT id, author_id, type, category, title, description, lat, lng, occurred_at, status, created_at
     FROM listings
     WHERE id = ?
       ${authorId ? 'AND author_id = ?' : ''}
     LIMIT 1`,
    params
  )

  if (rows.length === 0) {
    return null
  }

  const listing = rows[0]

  const [photoRows] = await pool.query(
    'SELECT url FROM photos WHERE listing_id = ? ORDER BY created_at ASC LIMIT 3',
    [listingId]
  )

  listing.photos = photoRows.map(row => row.url)
  return listing
}

function formatListingPreview(listing) {
  if (!listing) {
    return 'Карточка не найдена.'
  }

  const emoji = listing.type === 'FOUND' ? '📦' : '🆘'
  const statusText = listing.status === 'CLOSED' ? 'закрыто' : 'активно'
  const lines = [
    `${emoji} ${listing.title ?? 'Без названия'}`,
    '',
    listing.description?.trim?.() ? listing.description.trim() : 'Описание не заполнено.'
  ]

  lines.push('', `Статус: ${statusText}`)

  if (listing.occurred_at) {
    lines.push(`Когда произошло: ${formatDisplayDate(listing.occurred_at)}`)
  }

  if (listing.created_at) {
    lines.push(`Создано: ${formatDisplayDate(listing.created_at)}`)
  }

  if (Number.isFinite(Number(listing.lat)) && Number.isFinite(Number(listing.lng))) {
    lines.push(`Координаты: ${formatCoordinate(listing.lat)}°, ${formatCoordinate(listing.lng)}°`)
  }

  if (Array.isArray(listing.photos) && listing.photos.length > 0) {
    lines.push(`Фото прикреплено: ${listing.photos.length}`)
  }

  lines.push('', 'Следите за откликами в уведомлениях, мы сообщим, если появятся совпадения или ответы.')

  if (!IS_FRONT_LINK_ALLOWED && FRONT_URL) {
    lines.push('', `Мини-приложение: ${FRONT_URL}`)
  }

  return lines.join('\n')
}

function buildListingPreviewAttachments(listing) {
  if (!listing || !IS_FRONT_LINK_ALLOWED || !FRONT_URL) {
    return null
  }

  const url = FRONT_URL
  return [inlineKeyboard([[button.link('🗺️ Показать на карте', url)]])]
}

async function sendVolunteerListings(ctx, runtime = { payload: {} }, { refresh = false } = {}) {
  const volunteerData = runtime?.payload?.volunteer ?? {}
  const location = volunteerData.location ?? null
  const listings = await fetchVolunteerListings({ location })

  if (!listings.length) {
    await ctx.reply(FLOW_COPY[FLOWS.VOLUNTEER].emptyText)
    return
  }

  const header = refresh ? '🔄 Обновили список заявок:' : '🔥 Активные заявки по животным:'
  const lines = [header]

  listings.forEach((listing, index) => {
    lines.push('', `${index + 1}. ${formatVolunteerListing(listing)}`)
  })

  lines.push('', 'Выберите карточку, чтобы посмотреть детали и договориться с владельцем. Обновите список при необходимости.')

  if (!location) {
    lines.push('', 'Совет: отправьте геопозицию, чтобы мы показали объявления ближе к вам.')
  }

  if (!IS_FRONT_LINK_ALLOWED && FRONT_URL) {
    lines.push('', `Карта животных в мини-приложении: ${FRONT_URL}`)
  }

  await ctx.reply(lines.join('\n'), { attachments: buildVolunteerKeyboard(listings) })
}

async function fetchVolunteerListings({ location = null, limit = VOLUNTEER_LIST_LIMIT } = {}) {
  const hasLocation =
    location &&
    Number.isFinite(Number(location.latitude)) &&
    Number.isFinite(Number(location.longitude))

  const distanceExpression = hasLocation
    ? `111.045 * DEGREES(
        ACOS(
          LEAST(
            1.0,
            COS(RADIANS(?)) * COS(RADIANS(lat)) * COS(RADIANS(lng) - RADIANS(?)) +
            SIN(RADIANS(?)) * SIN(RADIANS(lat))
          )
        )
      )`
    : null

  const selectColumns = [
    'id',
    'title',
    'description',
    'occurred_at',
    'created_at'
  ]

  if (distanceExpression) {
    selectColumns.push(`${distanceExpression} AS distance_km`)
  }

  const sql = `
    SELECT ${selectColumns.join(', ')}
    FROM listings
    WHERE status = 'ACTIVE'
      AND type = 'LOST'
      AND category = ?
    ORDER BY ${distanceExpression ? 'distance_km ASC, created_at DESC' : 'created_at DESC'}
    LIMIT ?
  `

  const params = []
  if (distanceExpression) {
    params.push(Number(location.latitude), Number(location.longitude), Number(location.latitude))
  }
  params.push(VOLUNTEER_CATEGORY, limit)

  const [rows] = await pool.query(sql, params)
  return rows
}

function formatVolunteerListing(listing) {
  if (!listing) {
    return 'Запись недоступна'
  }

  const title = formatListingTitle(listing.title)
  const occurred = formatDisplayDate(listing.occurred_at ?? listing.created_at)

  const description = listing.description?.split('\n')?.find(Boolean) ?? ''
  const short = description.length > 120 ? `${description.slice(0, 117)}…` : description

  const parts = [`${title}`]

  if (occurred) {
    parts.push(`• Когда: ${occurred}`)
  }

  if (Number.isFinite(Number(listing.distance_km))) {
    parts.push(`• Расстояние: ~${formatDistance(listing.distance_km)}`)
  }

  if (short) {
    parts.push(`• Описание: ${short}`)
  }

  const lines = parts.filter(Boolean)

  return lines.join('\n')
}

function buildVolunteerKeyboard(listings) {
  const rows = listings.map(listing => [
    button.callback(
      `👁️ ${formatListingTitle(listing.title)}`,
      buildFlowPayload('volunteer', 'preview', `${listing.id}`)
    )
  ])

  rows.push([button.callback('🔄 Обновить список', buildFlowPayload(FLOWS.VOLUNTEER, 'refresh'))])

  if (IS_FRONT_LINK_ALLOWED && FRONT_URL) {
    rows.push([button.link('🗺️ Карта животных', FRONT_URL)])
  }

  if (IS_DOBRO_LINK_ALLOWED) {
    rows.push([button.link('❤️ Помочь приютам', VK_DOBRO_URL)])
  }

  return [inlineKeyboard(rows)]
}

async function handleVolunteerListingTap(ctx, runtime, value) {
  const listingId = value?.split?.('|')?.[0] ?? value

  if (!listingId) {
    await ctx.reply('Не удалось определить объявление. Попробуйте выбрать его ещё раз.')
    return
  }

  const nextPayload = withVolunteerPayload(runtime, volunteer => {
    volunteer.selectedListingId = listingId
  })
  await saveStateRecord(runtime.user.userId, runtime.step, nextPayload)

  await handleShowListingAction(ctx, runtime.user, listingId)

  const listingTitle = await fetchListingTitle(listingId)
  const questionLines = [
    '',
    'Перед стартом убедитесь, что поделились номером телефона через MAX — владелец увидит его сразу после подтверждения.',
    '',
    `Готовы приступить к поиску по объявлению «${formatListingTitle(listingTitle)}»?`,
    '',
    'Если хотите вернуться к списку, нажмите «⬅️ Назад».'
  ]

  await ctx.reply(questionLines.join('\n'), {
    attachments: buildVolunteerConfirmKeyboard(listingId)
  })
}

async function handleVolunteerAcceptAction(ctx, runtime, value) {
  const listingId = value?.split?.('|')?.[0] ?? value

  if (!listingId) {
    await ctx.reply('Не удалось определить объявление. Попробуйте снова.')
    return
  }

  const listing = await fetchListingForPreview(listingId)
  if (!listing || listing.type !== 'LOST' || listing.category !== VOLUNTEER_CATEGORY || listing.status !== 'ACTIVE') {
    await ctx.reply('Это объявление больше недоступно или не подходит для волонтёрства.')
    return
  }

  const volunteerContact = await fetchUserContact(runtime.user.userId)
  if (!volunteerContact?.phone) {
    await ctx.reply(
      [
        'Чтобы владелец смог связаться с вами, поделитесь номером телефона через MAX.',
        '',
        'Нажмите кнопку ниже или воспользуйтесь встроенной функцией «Поделиться контактом», затем снова нажмите «✅ Готов».'
      ].join('\n'),
      { attachments: [inlineKeyboard([[button.requestContact('📱 Поделиться контактом')]])] }
    )
    return
  }

  const existingAssignment = await findActiveVolunteerAssignment(listingId, runtime.user.userId)
  if (existingAssignment) {
    await ctx.reply(
      [
        `Вы уже отметились готовым помогать по объявлению «${listingTitle}».`,
        'Контакт владельца и детали сохранены в уведомлениях. Если нужно уточнить статус — свяжитесь напрямую или дождитесь ответа владельца.'
      ].join('\n')
    )
    return
  }

  const ownerContact = await fetchUserContact(listing.author_id)
  const listingTitle = formatListingTitle(listing.title)

  await ctx.reply(
    [
      `✅ Отлично! Отправляю контакты владельца объявления «${listingTitle}».`,
      '',
      formatContactAnnouncement('владельца', ownerContact, {
        postscript: 'Свяжитесь с владельцем и обсудите дальнейшие шаги. Спасибо за помощь!'
      })
    ].join('\n')
  )

  const ownerMessage = [
    `🐾 Волонтёр готов помочь в поиске питомца по объявлению «${listingTitle}».`,
    '',
    formatContactAnnouncement('волонтёра', volunteerContact, {
      postscript: 'Свяжитесь с волонтёром и договоритесь о планах поиска.'
    })
  ].join('\n')

  await notifyUser(listing.author_id, ownerMessage)

  await createNotification({
    userId: listing.author_id,
    type: NotificationType.VOLUNTEER_ASSIGNED,
    listingId,
    title: `Волонтёр откликнулся — «${listingTitle}»`,
    body: formatContactAnnouncement('волонтёра', volunteerContact, {
      postscript: 'Свяжитесь и договоритесь о совместных действиях.'
    }),
    status: NotificationStatus.UNREAD,
    payload: {
      listingId,
      volunteerId: runtime.user.userId
    }
  })

  const updatedPayload = withVolunteerPayload(runtime, volunteer => {
    volunteer.selectedListingId = null
  })
  await saveStateRecord(runtime.user.userId, STEPS.VOLUNTEER_LIST, updatedPayload)
  const updatedRuntime = { ...runtime, payload: updatedPayload }

  await createVolunteerAssignmentRecord({
    listingId,
    volunteerId: runtime.user.userId
  })

  await createNotification({
    userId: runtime.user.userId,
    type: NotificationType.VOLUNTEER_ACTIVE,
    listingId,
    title: `Вы помогаете по «${listingTitle}»`,
    body: formatContactAnnouncement('владельца', ownerContact, {
      postscript: 'Сохраните контакт и сообщите, когда завершите поиск.'
    }),
    status: NotificationStatus.UNREAD,
    payload: {
      listingId,
      ownerId: listing.author_id
    }
  })

  await sendVolunteerListings(ctx, updatedRuntime, { refresh: true })
}

async function handleVolunteerBackAction(ctx, runtime) {
  const nextPayload = withVolunteerPayload(runtime, volunteer => {
    volunteer.selectedListingId = null
  })
  await saveStateRecord(runtime.user.userId, STEPS.VOLUNTEER_LIST, nextPayload)
  const nextRuntime = { ...runtime, payload: nextPayload }
  await sendVolunteerListings(ctx, nextRuntime, { refresh: true })
}

function buildVolunteerConfirmKeyboard(listingId) {
  return [
    inlineKeyboard([
      [button.callback('✅ Готов', buildFlowPayload(FLOWS.VOLUNTEER, 'accept', listingId))],
      [button.callback('⬅️ Назад', buildFlowPayload(FLOWS.VOLUNTEER, 'back', listingId))]
    ])
  ]
}

function buildVolunteerLocationKeyboard() {
  return inlineKeyboard([[button.callback('⤴️ Без гео', buildFlowPayload(FLOWS.VOLUNTEER, 'location_skip'))]])
}

async function findActiveVolunteerAssignment(listingId, volunteerId) {
  if (!listingId || !volunteerId) {
    return null
  }

  const [rows] = await pool.query(
    `SELECT id
     FROM volunteer_assignments
     WHERE listing_id = ?
       AND volunteer_id = ?
       AND status = 'ACTIVE'
     LIMIT 1`,
    [listingId, volunteerId]
  )

  if (rows.length === 0) {
    return null
  }

  return rows[0]
}

async function createVolunteerAssignmentRecord({ listingId, volunteerId }) {
  if (!listingId || !volunteerId) {
    return null
  }

  const assignmentId = crypto.randomUUID()
  await pool.query(
    `INSERT INTO volunteer_assignments (id, listing_id, volunteer_id, status, owner_notified_at, volunteer_notified_at)
     VALUES (?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       status = 'ACTIVE',
       owner_notified_at = VALUES(owner_notified_at),
       volunteer_notified_at = VALUES(volunteer_notified_at),
       updated_at = CURRENT_TIMESTAMP`,
    [assignmentId, listingId, volunteerId]
  )

  return assignmentId
}

async function userHasListingAccess(userId, listingId) {
  if (!userId || !listingId) {
    return false
  }

  const [rows] = await pool.query(
    `SELECT 1
     FROM notifications
     WHERE user_id = ?
       AND listing_id = ?
       AND type IN (?, ?, ?, ?, ?, ?) 
     LIMIT 1`,
    [
      userId,
      listingId,
      NotificationType.MATCH_FOUND,
      NotificationType.CONTACT_AVAILABLE,
      NotificationType.OWNER_APPROVED,
      NotificationType.OWNER_REVIEW,
      NotificationType.OWNER_WAITING,
      NotificationType.LISTING_PUBLISHED,
      NotificationType.VOLUNTEER_ASSIGNED,
      NotificationType.VOLUNTEER_ACTIVE
    ]
  )

  if (rows.length > 0) {
    return true
  }

  const [listingRows] = await pool.query(
    `SELECT type, category, status
     FROM listings
     WHERE id = ?
     LIMIT 1`,
    [listingId]
  )

  if (listingRows.length === 0) {
    return false
  }

  const listing = listingRows[0]
  if (listing.status !== 'ACTIVE') {
    return false
  }

  if (listing.type === 'LOST' && listing.category === VOLUNTEER_CATEGORY) {
    return true
  }

  return false
}

function listingTypeToFlow(type) {
  if (!type) {
    return null
  }

  const normalized = String(type).toUpperCase()
  if (normalized === 'LOST') {
    return FLOWS.LOST
  }
  if (normalized === 'FOUND') {
    return FLOWS.FOUND
  }
  return null
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

async function sendCategoryHints(ctx, flow, categoryIdRaw) {
  if (flow !== FLOWS.FOUND) {
    return
  }

  const categoryId = normalizeCategoryId(categoryIdRaw)
  const lines = [
    '📌 Если оставляете находку у себя, сообщите о ней в полицию или ОМСУ в течение 3 дней.'
  ]

  switch (categoryId) {
    case 'pet':
      lines.push('🐾 Нашли питомца? Опишите вид, окрас, приметы и характер. Сообщите о животном в полицию/ОМСУ и постарайтесь обеспечить ему безопасность.')
      break
    case 'bag':
      lines.push(CATEGORY_WARNINGS.bag)
      break
    case 'document':
      lines.push('📄 Нашли документ? Замажьте персональные данные на фото, опубликуйте краткое описание и передайте оригинал в полицию или выдавший орган.')
      break
    case 'wallet':
      lines.push(CATEGORY_WARNINGS.wallet)
      break
    case 'keys':
      lines.push(CATEGORY_WARNINGS.keys)
      break
    default: {
      if (CATEGORY_WARNINGS[categoryId]) {
        lines.push(CATEGORY_WARNINGS[categoryId])
      } else {
        lines.push('ℹ️ Опишите находку так, чтобы владелец её узнал. Если предмет кажется опасным, не трогайте и сообщите по 112/102.')
      }
      break
    }
  }

  await ctx.reply(lines.join('\n\n'))
}
async function sendDraftSummary(ctx, runtime) {
  const flow = runtime.flow
  const listing = runtime.payload?.listing

  if (!flow || !listing) {
    await ctx.reply('Черновик пуст. Начните сначала или выберите сценарий.')
    return
  }

  const attributeLines = buildAttributeLines(flow, listing)
  const config = FLOW_COPY[flow]
  const lines = [
    `${config.summaryTitle ?? 'Черновик'}`,
    '',
    `Категория: ${describeCategory(listing.category)}`,
    attributeLines.length
      ? 'Характеристики:\n - ' + attributeLines.join('\n - ')
      : 'Характеристики: —',
    `Фото: ${(listing.photos ?? []).length} шт.`,
    `Локация: ${listing.locationNote || '—'}`,
    listing.location
      ? `Координаты: ${formatCoordinate(listing.location.latitude)}, ${formatCoordinate(listing.location.longitude)}`
      : 'Координаты: —',
    `Дата/время: ${formatDisplayDate(listing.occurredAt)}`,
    `Секреты: ${(listing.secretEntries ?? []).length} шт.`
  ]

  await ctx.reply(lines.join('\n'))
}

function buildPhotoAcknowledgementCopy(flow, category) {
  const lines = ['🔒 Перед загрузкой фото подтвердите правила:']

  if (flow === FLOWS.FOUND) {
    lines.push('• Показывайте только нейтральные ракурсы. Не раскрывайте уникальные метки и место хранения находки.')
    lines.push('• Если временно храните находку, сообщите о ней в полицию или ОМСУ в течение 3 дней.')
    if (category && CATEGORY_WARNINGS[category]) {
      lines.push(`• ${CATEGORY_WARNINGS[category]}`)
    }
    if (RISKY_CATEGORIES.has(category ?? '')) {
      lines.push('• Уникальные метки и серийные номера сохраните в «секретах», а не на фото.')
    }
    if (category !== 'pet') {
      lines.push('• Если предмет кажется опасным, не трогайте его и при сомнениях звоните 112/102.')
    }
  } else {
    lines.push('• Фото должны помогать опознать предмет без раскрытия адресов и персональных данных.')
  }

  return lines.join('\n')
}

function getSecretsFormatHint(flow) {
  if (flow === FLOWS.FOUND) {
    return 'Формат: «Вопрос :: ожидаемый ответ». Вопрос увидит владелец, ответ хранится в секрете.'
  }
  return 'Формат: «Признак :: пояснение». Например: «Внутри записка :: имя „Оля"». Если пояснение не нужно — можно написать просто признак.'
}

function parseSecretEntries(flow, text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return { entries: [], error: 'Введите хотя бы один секрет или отправьте /skip.' }
  }

  const entries = []

  for (const line of lines.slice(0, 3)) {
    const parts = splitSecretLine(line)
    let question = parts.question
    let answer = parts.answer

    if (flow === FLOWS.FOUND) {
      if (!question) {
        return { entries: [], error: 'Для найденных вещей важно указать вопрос. Используйте формат «Вопрос :: ответ».' }
      }
      if (!answer) {
        return { entries: [], error: 'Введите ожидаемый ответ через «::». Это поможет проверить владельца.' }
      }
    } else {
      if (!answer && question) {
        answer = question
        question = `Секрет ${entries.length + 1}`
      }
    }

    if (!answer) {
      return { entries: [], error: 'Заполните текст секретного признака или используйте /skip.' }
    }

    if (question && question.length > SECRET_LIMITS.QUESTION) {
      return { entries: [], error: `Сократите вопрос до ${SECRET_LIMITS.QUESTION} символов.` }
    }

    if (answer.length > SECRET_LIMITS.ANSWER) {
      return { entries: [], error: `Сократите ответ до ${SECRET_LIMITS.ANSWER} символов.` }
    }

    entries.push({
      question: question ?? '',
      answer
    })
  }

  return { entries, error: null }
}

function splitSecretLine(line) {
  const delimiters = ['::', '—', '-', ':', '?']
  for (const delimiter of delimiters) {
    const idx = line.indexOf(delimiter)
    if (idx > -1) {
      const question = line.slice(0, idx).trim()
      const answer = line.slice(idx + delimiter.length).trim()
      return { question, answer }
    }
  }

  return { question: '', answer: line.trim() }
}

function buildLocationModeKeyboard(flow) {
  return inlineKeyboard([
    [
      button.callback('📍 Точно', buildFlowPayload(flow, 'location_mode', LOCATION_MODES.EXACT)),
      button.callback('📌 Примерно', buildFlowPayload(flow, 'location_mode', LOCATION_MODES.APPROX))
    ],
    [button.callback('🚆 В пути', buildFlowPayload(flow, 'location_mode', LOCATION_MODES.TRANSIT))],
    [button.callback('❌ Отменить', buildFlowPayload(flow, 'cancel'))]
  ])
}

function buildTransitPrompt() {
  return [
    '🚆 Укажите маршрут или транспорт.',
    'Например: «Аэрофлот SU123 Москва → Сочи, 11 ноября» или «Электричка Зеленоград — Москва, вагон 3».',
    'Если данных нет, отправьте /skip.'
  ].join('\n')
}

function buildLocationDetailsPrompt(flow, mode) {
  const lines = []
  if (mode === LOCATION_MODES.EXACT) {
    lines.push('📍 Отправьте место, где произошла потеря/находка. Это может быть геопозиция или текст с адресом и ориентиром.')
  } else if (mode === LOCATION_MODES.APPROX) {
    lines.push('📌 Опишите район или ближайшие ориентиры. Можно прикрепить точку на карте, мы округлим её до квартала.')
  } else if (mode === LOCATION_MODES.TRANSIT) {
    lines.push('🧭 Укажите последнюю точку, где точно видели предмет. Можно текстом или геопозицией.')
  }

  if (flow === FLOWS.FOUND) {
    lines.push('Для безопасности точная точка будет скрыта и откроется только после owner-check.')
  }

  lines.push('Если пока нет данных, можно отправить /skip.')

  return lines.join('\n')
}

function buildTimePrompt() {
  return [
    '🕒 Когда это произошло?',
    'Напишите дату и время в формате «12.11.2025 18:30» или «вчера 15:00».',
    'Если точно не помните — отправьте /skip.'
  ].join('\n')
}
function getPreviousStep(flow, currentStep) {
  if (!flow) {
    return null
  }

  const sequence = FLOW_STEP_SEQUENCE[flow]
  if (!sequence) {
    return null
  }

  const index = sequence.indexOf(currentStep)
  if (index <= 0) {
    return null
  }

  return sequence[index - 1] ?? null
}

function formatDisplayDate(value) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatCoordinate(value) {
  if (!Number.isFinite(Number(value))) {
    return '—'
  }
  return Number(value).toFixed(5)
}

function formatDistance(value) {
  const distance = Number(value)
  if (!Number.isFinite(distance)) {
    return '—'
  }

  if (distance < 1) {
    return `${Math.round(distance * 1000)} м`
  }

  return `${distance.toFixed(distance >= 10 ? 0 : 1)} км`
}

function parseDateTimeInput(raw) {
  if (!raw) {
    return null
  }

  const text = raw.trim()
  if (!text) {
    return null
  }

  const lower = text.toLowerCase()
  const now = new Date()

  if (lower === 'сейчас') {
    return now
  }

  if (lower.startsWith('сегодня')) {
    const timePart = lower.replace('сегодня', '').trim()
    if (!timePart) {
      return now
    }
    const timeMatch = timePart.match(/(\d{1,2})(?::(\d{1,2}))?/)
    if (!timeMatch) {
      return null
    }
    const hours = Number(timeMatch[1])
    const minutes = Number(timeMatch[2] ?? '0')
    const date = new Date()
    date.setHours(hours, minutes, 0, 0)
    return date
  }

  if (lower.startsWith('вчера')) {
    const timePart = lower.replace('вчера', '').trim()
    const date = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    if (!timePart) {
      return date
    }
    const timeMatch = timePart.match(/(\d{1,2})(?::(\d{1,2}))?/)
    if (!timeMatch) {
      return null
    }
    const hours = Number(timeMatch[1])
    const minutes = Number(timeMatch[2] ?? '0')
    date.setHours(hours, minutes, 0, 0)
    return date
  }

  const dateMatch = text.match(
    /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?:\s+(\d{1,2})(?::(\d{1,2}))?)?$/
  )
  if (dateMatch) {
    const day = Number(dateMatch[1])
    const month = Number(dateMatch[2]) - 1
    let year = Number(dateMatch[3])
    if (Number.isNaN(year)) {
      year = now.getFullYear()
    } else if (year < 100) {
      year += 2000
    }
    let hours = Number(dateMatch[4])
    let minutes = Number(dateMatch[5])
    if (Number.isNaN(hours)) {
      hours = 12
    }
    if (Number.isNaN(minutes)) {
      minutes = 0
    }
    const date = new Date(year, month, day, hours, minutes, 0, 0)
    if (Number.isNaN(date.getTime())) {
      return null
    }
    return date
  }

  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed
  }

  return null
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

function generalizeLocation(flow, point, mode = LOCATION_MODES.EXACT) {
  if (!point) {
    return { public: null, original: null }
  }

  const original = {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude)
  }

  if (Number.isNaN(original.latitude) || Number.isNaN(original.longitude)) {
    return { public: null, original: null }
  }

  const needsGeneralization =
    flow === FLOWS.FOUND || mode !== LOCATION_MODES.EXACT

  if (needsGeneralization) {
    let step = 0.01
    let precision = 'area'

    if (mode === LOCATION_MODES.APPROX) {
      step = 0.02
      precision = 'district'
    } else if (mode === LOCATION_MODES.TRANSIT) {
      step = 0.05
      precision = 'transit'
    } else if (flow === FLOWS.LOST) {
      step = 0.005
      precision = 'area'
    }

    const lat = roundCoordinate(original.latitude, step)
    const lng = roundCoordinate(original.longitude, step)
    return {
      public: {
        latitude: lat,
        longitude: lng,
        precision
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

  return { listingId, listingTitle: payload.title, listingType: payload.type, matches }
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

  const isKnownFlow = Boolean(FLOW_COPY[flow])
  const isAuxiliaryFlow = AUXILIARY_FLOWS.has(flow)

  if (!isKnownFlow && !isAuxiliaryFlow && action !== 'start' && action !== 'menu' && action !== 'cancel') {
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
  if (flow === FLOWS.MY) {
    return {
      flow,
      my: {
        items: [],
        editingId: null
      }
    }
  }

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
    secretEntries: [],
    encryptedSecrets: [],
    pendingSecrets: [],
    locationMode: null,
    transit: null,
    occurredAt: null
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

function withVolunteerPayload(runtime, mutator) {
  const baseFlow = runtime.flow ?? FLOWS.VOLUNTEER
  const nextPayload = clonePayload(runtime.payload ?? { flow: baseFlow })
  if (!nextPayload.flow) {
    nextPayload.flow = baseFlow
  }
  nextPayload.volunteer = nextPayload.volunteer ?? {}
  mutator(nextPayload.volunteer, nextPayload)
  return nextPayload
}

function withMyPayload(runtime, mutator) {
  const baseFlow = FLOWS.MY
  const nextPayload = clonePayload(runtime.payload ?? { flow: baseFlow })
  if (!nextPayload.flow) {
    nextPayload.flow = baseFlow
  }
  nextPayload.my = nextPayload.my ?? { items: [], editingId: null }
  mutator(nextPayload.my, nextPayload)
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

const MY_LIST_DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

async function sendMyListings(ctx, listings) {
  for (const [index, listing] of listings.entries()) {
    const message = buildMyListingMessage(listing, index)
    const keyboard = buildMyListingActions(listing)
    await ctx.reply(message, keyboard ? { attachments: [keyboard] } : undefined)
  }
}

function buildMyListingMessage(listing, index) {
  const typeEmoji = listing.type === 'FOUND' ? '📦' : '🆘'
  const statusText = listing.status === 'ACTIVE' ? 'активно' : 'закрыто'
  const lines = [
    `${index + 1}. ${typeEmoji} ${listing.title ?? 'Без названия'}`,
    `Статус: ${statusText}`
  ]

  if (listing.created_at) {
    lines.push(`Создано: ${formatDateTime(listing.created_at)}`)
  }

  if (listing.occurred_at) {
    lines.push(`Событие: ${formatDateTime(listing.occurred_at)}`)
  }

  if (listing.description) {
    lines.push('', truncateText(listing.description, 320))
  }

  return lines.join('\n')
}

function buildMyListingActions(listing) {
  const rows = [
    [button.callback('👁️ Просмотр', buildFlowPayload('menu', 'show_listing', listing.id))],
    [button.callback('✏️ Редактировать', buildFlowPayload(FLOWS.MY, 'edit_menu', listing.id))]
  ]

  const statusButtonText = listing.status === 'ACTIVE' ? '✅ Закрыть объявление' : '🔁 Вернуть в активные'
  rows.push([button.callback(statusButtonText, buildFlowPayload(FLOWS.MY, 'toggle_status', listing.id))])

  return inlineKeyboard(rows)
}

function buildEditDescriptionPreview(listing) {
  const lines = [
    '✏️ Изменяем описание объявления.',
    '',
    `${listing.title ?? 'Без названия'}`,
    '',
    'Текущее описание:',
    listing.description?.trim?.() ? truncateText(listing.description, 500) : '— нет описания —'
  ]
  return lines.join('\n')
}

async function fetchMyListings(userId, { limit = 10 } = {}) {
  if (!userId) {
    return []
  }

  const [rows] = await pool.query(
    `SELECT id, title, type, status, category, description, occurred_at, created_at
     FROM listings
     WHERE author_id = ?
     ORDER BY (status = 'ACTIVE') DESC, created_at DESC
     LIMIT ?`,
    [userId, Number(limit)]
  )

  return rows
}

async function fetchListingForOwner(listingId, userId) {
  if (!listingId || !userId) {
    return null
  }

  const [rows] = await pool.query(
    `SELECT id, title, type, status, category, description, occurred_at, created_at, lat, lng
     FROM listings
     WHERE id = ? AND author_id = ?
     LIMIT 1`,
    [listingId, userId]
  )

  if (rows.length === 0) {
    return null
  }

  return rows[0]
}

async function updateListingDescription(listingId, userId, description) {
  if (!listingId || !userId) {
    return false
  }

  const trimmed = description.trim()
  const [result] = await pool.query(
    'UPDATE listings SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? LIMIT 1',
    [trimmed, listingId, userId]
  )

  return result.affectedRows > 0
}

async function toggleListingStatus(listingId, userId) {
  if (!listingId || !userId) {
    return null
  }

  const [rows] = await pool.query(
    'SELECT status FROM listings WHERE id = ? AND author_id = ? LIMIT 1',
    [listingId, userId]
  )

  if (rows.length === 0) {
    return null
  }

  const current = rows[0].status
  const nextStatus = current === 'ACTIVE' ? 'CLOSED' : 'ACTIVE'
  const [result] = await pool.query(
    'UPDATE listings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? LIMIT 1',
    [nextStatus, listingId, userId]
  )

  if (result.affectedRows === 0) {
    return null
  }

  return nextStatus
}

function formatDateTime(value) {
  if (!value) {
    return 'не указано'
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'не указано'
  }
  return MY_LIST_DATE_FORMATTER.format(date)
}

function truncateText(text, limit = 280) {
  const value = String(text ?? '').trim()
  if (value.length <= limit) {
    return value
  }
  return `${value.slice(0, limit - 1).trimEnd()}…`
}

function createMyEditMenuHandler() {
  return {
    enter: async (ctx, runtime) => {
      const listingId = runtime.payload?.my?.editingId
      if (!listingId) {
        await ctx.reply('Не выбрано объявление для редактирования.')
        await transitionToStep(ctx, runtime.user, STEPS.MY_LIST, runtime.payload, { skipIntro: true })
        return
      }

      const listing = await fetchListingForOwner(listingId, runtime.user.userId)
      if (!listing) {
        await ctx.reply('Карточка не найдена или уже удалена.')
        const nextPayload = withMyPayload(runtime, my => {
          my.editingId = null
        })
        await transitionToStep(ctx, runtime.user, STEPS.MY_LIST, nextPayload, { skipIntro: true })
        return
      }

      const syncedPayload = withMyPayload(runtime, my => {
        if (!Array.isArray(my.items)) {
          my.items = []
        }
        const existing = my.items.find(entry => entry.id === listing.id)
        if (existing) {
          Object.assign(existing, listing)
        }
      })
      runtime.payload = syncedPayload
      await saveStateRecord(runtime.user.userId, STEPS.MY_EDIT_MENU, syncedPayload)

      const lines = [
        '✏️ Что хотите изменить?',
        '',
        `${listing.title ?? 'Без названия'}`,
        `Категория: ${describeCategory(listing.category)}`,
        `Статус: ${listing.status === 'ACTIVE' ? 'активно' : 'закрыто'}`,
        `Добавлено: ${formatDateTime(listing.created_at)}`
      ]

      if (listing.occurred_at) {
        lines.push(`Событие: ${formatDateTime(listing.occurred_at)}`)
      }

      await ctx.reply(lines.join('\n'))
      await ctx.reply('Выберите параметр для редактирования.', {
        attachments: [
          inlineKeyboard([
            [button.callback('📝 Название', buildFlowPayload(FLOWS.MY, 'edit_title'))],
            [button.callback('💬 Описание', buildFlowPayload(FLOWS.MY, 'edit_description'))],
            [button.callback('🗂 Категория', buildFlowPayload(FLOWS.MY, 'edit_category'))],
            [button.callback('🕒 Время события', buildFlowPayload(FLOWS.MY, 'edit_occurred'))],
            [button.callback('📍 Локация', buildFlowPayload(FLOWS.MY, 'edit_location'))],
            [button.callback('🖼 Фото', buildFlowPayload(FLOWS.MY, 'edit_photos'))],
            [button.callback('⬅️ К списку', buildFlowPayload(FLOWS.MY, 'back_to_list'))]
          ])
        ]
      })
    },
    onMessage: async ctx => {
      await ctx.reply('Используйте кнопки, чтобы выбрать, что редактировать.')
    },
    onCallback: async (ctx, runtime, parsed) => {
      const userId = runtime.user?.userId
      const ensurePayload = () => withMyPayload(runtime, my => {
        if (!my.editingId) {
          my.editingId = runtime.payload?.my?.editingId ?? null
        }
      })
      switch (parsed.action) {
        case 'edit_title': {
          const nextPayload = ensurePayload()
          await safeAnswerOnCallback(ctx, { notification: 'Изменяем название' })
          await saveStateRecord(userId, STEPS.MY_EDIT_TITLE, nextPayload)
          await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_TITLE, nextPayload, { skipIntro: true })
          return
        }
        case 'edit_description': {
          const nextPayload = ensurePayload()
          await safeAnswerOnCallback(ctx, { notification: 'Изменяем описание' })
          await saveStateRecord(userId, STEPS.MY_EDIT_DESCRIPTION, nextPayload)
          await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_DESCRIPTION, nextPayload, { skipIntro: true })
          return
        }
        case 'edit_category': {
          const nextPayload = ensurePayload()
          await safeAnswerOnCallback(ctx, { notification: 'Изменяем категорию' })
          await saveStateRecord(userId, STEPS.MY_EDIT_CATEGORY, nextPayload)
          await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_CATEGORY, nextPayload, { skipIntro: true })
          return
        }
        case 'edit_occurred': {
          const nextPayload = ensurePayload()
          await safeAnswerOnCallback(ctx, { notification: 'Изменяем дату/время' })
          await saveStateRecord(userId, STEPS.MY_EDIT_OCCURRED, nextPayload)
          await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_OCCURRED, nextPayload, { skipIntro: true })
          return
        }
        case 'edit_location': {
          const nextPayload = ensurePayload()
          await safeAnswerOnCallback(ctx, { notification: 'Изменяем локацию' })
          await saveStateRecord(userId, STEPS.MY_EDIT_LOCATION, nextPayload)
          await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_LOCATION, nextPayload, { skipIntro: true })
          return
        }
        case 'edit_photos': {
          const nextPayload = ensurePayload()
          await safeAnswerOnCallback(ctx, { notification: 'Заменяем фото' })
          await saveStateRecord(userId, STEPS.MY_EDIT_PHOTOS, nextPayload)
          await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_PHOTOS, nextPayload, { skipIntro: true })
          return
        }
        case 'back_to_list': {
          const nextPayload = withMyPayload(runtime, my => {
            my.editingId = null
          })
          await safeAnswerOnCallback(ctx, { notification: 'К списку' })
          await transitionToStep(ctx, runtime.user, STEPS.MY_LIST, nextPayload, { skipIntro: true })
          return
        }
        default:
          await safeAnswerOnCallback(ctx, { notification: 'Действие не поддерживается' })
      }
    }
  }
}

function createMyEditTitleHandler() {
  return {
    enter: async (ctx, runtime) => {
      const listing = await ensureEditableListing(ctx, runtime)
      if (!listing) {
        return
      }
      await ctx.reply(
        [
          '📝 Текущее название:',
          listing.title ?? '— без названия —',
          '',
          'Отправьте новое название (5–120 символов). Команды: /back — вернуться в меню, /cancel — выйти в главное меню.'
        ].join('\n')
      )
    },
    onMessage: async (ctx, runtime, message) => {
      const lower = message.lower ?? ''
      if (CANCEL_KEYWORDS.includes(lower)) {
        await clearStateRecord(runtime.user.userId)
        await ctx.reply('Редактирование отменено.')
        await sendMainMenu(ctx)
        return
      }
      if (BACK_KEYWORDS.includes(lower)) {
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, runtime.payload, { skipIntro: true })
        return
      }

      const listingId = runtime.payload?.my?.editingId
      const title = message.text?.trim?.() ?? ''
      if (title.length < 5 || title.length > 120) {
        await ctx.reply('Название должно быть от 5 до 120 символов. Попробуйте ещё раз.')
        return
      }

      const updated = await updateListingTitle(listingId, runtime.user.userId, title)
      if (!updated) {
        await ctx.reply('Не удалось обновить название. Попробуйте позже.')
        return
      }

      const nextPayload = withMyPayload(runtime, my => {
        if (Array.isArray(my.items)) {
          const item = my.items.find(entry => entry.id === listingId)
          if (item) {
            item.title = title.trim()
          }
        }
      })

      await ctx.reply('Название обновлено ✅')
      await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, nextPayload, { skipIntro: true })
    }
  }
}

function createMyEditCategoryHandler() {
  return {
    enter: async (ctx, runtime) => {
      const listing = await ensureEditableListing(ctx, runtime)
      if (!listing) {
        return
      }

      const rows = []
      for (let i = 0; i < CATEGORY_OPTIONS.length; i += 2) {
        const slice = CATEGORY_OPTIONS.slice(i, i + 2).map(option =>
          button.callback(`${option.emoji} ${option.title}`, buildFlowPayload(FLOWS.MY, 'category_select', option.id))
        )
        rows.push(slice)
      }
      rows.push([button.callback('⬅️ Назад', buildFlowPayload(FLOWS.MY, 'back_to_menu'))])

      await ctx.reply(
        [
          `Текущая категория: ${describeCategory(listing.category)}`,
          '',
          'Выберите новую категорию из списка ниже.'
        ].join('\n'),
        { attachments: [inlineKeyboard(rows)] }
      )
    },
    onMessage: async ctx => {
      await ctx.reply('Используйте кнопки категорий или /back, чтобы вернуться.')
    },
    onCallback: async (ctx, runtime, parsed) => {
      if (parsed.action === 'category_select') {
        const option = CATEGORY_OPTIONS.find(item => item.id === parsed.value)
        if (!option) {
          await safeAnswerOnCallback(ctx, { notification: 'Неизвестная категория' })
          return
        }
        const listingId = runtime.payload?.my?.editingId
        const updated = await updateListingCategory(listingId, runtime.user.userId, option.id)
        if (!updated) {
          await safeAnswerOnCallback(ctx, { notification: 'Не удалось обновить категорию' })
          return
        }
        const nextPayload = withMyPayload(runtime, my => {
          if (Array.isArray(my.items)) {
            const item = my.items.find(entry => entry.id === listingId)
            if (item) {
              item.category = option.id
            }
          }
        })
        await safeAnswerOnCallback(ctx, { notification: `${option.emoji} ${option.title}` })
        await ctx.reply('Категория обновлена ✅')
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, nextPayload, { skipIntro: true })
        return
      }

      if (parsed.action === 'back_to_menu') {
        await safeAnswerOnCallback(ctx, { notification: 'Назад' })
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, runtime.payload, { skipIntro: true })
        return
      }

      await safeAnswerOnCallback(ctx, { notification: 'Выберите категорию из списка' })
    }
  }
}

function createMyEditOccurredHandler() {
  return {
    enter: async (ctx, runtime) => {
      const listing = await ensureEditableListing(ctx, runtime)
      if (!listing) {
        return
      }

      await ctx.reply(
        [
          `Текущее время события: ${formatDateTime(listing.occurred_at)}`,
          '',
          'Отправьте новую дату и время (пример: «13 ноября 18:30»). Можно указать «сегодня 14:00», «вчера 20:15» или написать /skip, чтобы очистить поле.',
          '',
          'Команды: /back — вернуться в меню, /cancel — выйти в главное меню.'
        ].join('\n')
      )
    },
    onMessage: async (ctx, runtime, message) => {
      const lower = message.lower ?? ''
      if (CANCEL_KEYWORDS.includes(lower)) {
        await clearStateRecord(runtime.user.userId)
        await ctx.reply('Редактирование отменено.')
        await sendMainMenu(ctx)
        return
      }

      if (BACK_KEYWORDS.includes(lower)) {
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, runtime.payload, { skipIntro: true })
        return
      }

      const listingId = runtime.payload?.my?.editingId
      if (isSkipCommand(lower)) {
        const updated = await updateListingOccurredAt(listingId, runtime.user.userId, null)
        if (!updated) {
          await ctx.reply('Не удалось очистить дату. Попробуйте позже.')
          return
        }
        const nextPayload = withMyPayload(runtime, my => {
          if (Array.isArray(my.items)) {
            const item = my.items.find(entry => entry.id === listingId)
            if (item) {
              item.occurred_at = null
            }
          }
        })
        await ctx.reply('Дата события очищена.')
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, nextPayload, { skipIntro: true })
        return
      }

      const parsedDate = parseDateTimeInput(message.text)
      if (!parsedDate) {
        await ctx.reply('Не удалось распознать дату и время. Попробуйте ещё раз в формате «13 ноября 18:30».')
        return
      }

      const updated = await updateListingOccurredAt(listingId, runtime.user.userId, parsedDate)
      if (!updated) {
        await ctx.reply('Не удалось обновить дату. Попробуйте позже.')
        return
      }

      const nextPayload = withMyPayload(runtime, my => {
        if (Array.isArray(my.items)) {
          const item = my.items.find(entry => entry.id === listingId)
          if (item) {
            item.occurred_at = parsedDate.toISOString()
          }
        }
      })

      await ctx.reply(`Дата события обновлена: ${formatDateTime(parsedDate)} ✅`)
      await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, nextPayload, { skipIntro: true })
    }
  }
}

function createMyEditLocationHandler() {
  return {
    enter: async (ctx, runtime) => {
      const listing = await ensureEditableListing(ctx, runtime)
      if (!listing) {
        return
      }

      const lines = [
        '📍 Локация объявления',
        `Широта: ${formatCoordinate(listing.lat)}`,
        `Долгота: ${formatCoordinate(listing.lng)}`,
        '',
        'Отправьте новую геопозицию через вложение или напишите /skip, чтобы очистить координаты.',
        '',
        'Команды: /back — вернуться в меню, /cancel — выйти в главное меню.'
      ]

      await ctx.reply(lines.join('\n'))
    },
    onMessage: async (ctx, runtime, message) => {
      const lower = message.lower ?? ''
      if (CANCEL_KEYWORDS.includes(lower)) {
        await clearStateRecord(runtime.user.userId)
        await ctx.reply('Редактирование отменено.')
        await sendMainMenu(ctx)
        return
      }

      if (BACK_KEYWORDS.includes(lower)) {
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, runtime.payload, { skipIntro: true })
        return
      }

      const listingId = runtime.payload?.my?.editingId
      if (isSkipCommand(lower)) {
        const updated = await updateListingLocation(listingId, runtime.user.userId, null, null)
        if (!updated) {
          await ctx.reply('Не удалось очистить координаты. Попробуйте позже.')
          return
        }
        const nextPayload = withMyPayload(runtime, my => {
          if (Array.isArray(my.items)) {
            const item = my.items.find(entry => entry.id === listingId)
            if (item) {
              item.lat = null
              item.lng = null
            }
          }
        })
        await ctx.reply('Координаты очищены.')
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, nextPayload, { skipIntro: true })
        return
      }

      if (message.location) {
        const { latitude, longitude } = message.location
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          const updated = await updateListingLocation(listingId, runtime.user.userId, latitude, longitude)
          if (!updated) {
            await ctx.reply('Не удалось обновить координаты. Попробуйте позже.')
            return
          }
          const nextPayload = withMyPayload(runtime, my => {
            if (Array.isArray(my.items)) {
              const item = my.items.find(entry => entry.id === listingId)
              if (item) {
                item.lat = latitude
                item.lng = longitude
              }
            }
          })
          await ctx.reply('Координаты обновлены ✅')
          await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, nextPayload, { skipIntro: true })
          return
        }
      }

      await ctx.reply('Не удалось распознать геопозицию. Отправьте точку через вложение или напишите /skip.')
    }
  }
}

function createMyEditPhotosHandler() {
  return {
    enter: async (ctx, runtime) => {
      const listing = await ensureEditableListing(ctx, runtime)
      if (!listing) {
        return
      }

      await ctx.reply(
        [
          '🖼 Замените фотографии объявления.',
          '',
          'Отправьте до трёх новых фото. Текущий набор будет полностью заменён.',
          'Команды: /skip — оставить прежние фото, /clear — удалить все фото, /back — вернуться в меню, /cancel — выйти в главное меню.'
        ].join('\n')
      )
    },
    onMessage: async (ctx, runtime, message) => {
      const lower = message.lower ?? ''
      const listingId = runtime.payload?.my?.editingId

      if (CANCEL_KEYWORDS.includes(lower)) {
        await clearStateRecord(runtime.user.userId)
        await ctx.reply('Редактирование отменено.')
        await sendMainMenu(ctx)
        return
      }

      if (BACK_KEYWORDS.includes(lower)) {
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, runtime.payload, { skipIntro: true })
        return
      }

      if (lower === '/clear') {
        const updated = await replaceListingPhotos(listingId, runtime.user.userId, [])
        if (!updated) {
          await ctx.reply('Не удалось удалить фото. Попробуйте позже.')
          return
        }
        const nextPayload = withMyPayload(runtime, my => {
          if (Array.isArray(my.items)) {
            const item = my.items.find(entry => entry.id === listingId)
            if (item) {
              item.photos = []
            }
          }
        })
        await ctx.reply('Фото удалены. ✅')
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, nextPayload, { skipIntro: true })
        return
      }

      if (isSkipCommand(lower)) {
        await ctx.reply('Фото оставлены без изменений.')
        await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, runtime.payload, { skipIntro: true })
        return
      }

      const attachments = extractPhotoAttachments(ctx.message)
      if (!attachments.length) {
        await ctx.reply('Прикрепите до трёх фотографий или используйте /skip, чтобы ничего не менять.')
        return
      }

      const photoUrls = attachments
        .slice(0, 3)
        .map(attachment => extractPhotoUrl(attachment))
        .filter(Boolean)

      if (!photoUrls.length) {
        await ctx.reply('Не удалось обработать вложения. Попробуйте снова или используйте /skip.')
        return
      }

      const updated = await replaceListingPhotos(listingId, runtime.user.userId, photoUrls)
      if (!updated) {
        await ctx.reply('Не удалось обновить фото. Попробуйте позже.')
        return
      }

      const nextPayload = withMyPayload(runtime, my => {
        if (Array.isArray(my.items)) {
          const item = my.items.find(entry => entry.id === listingId)
          if (item) {
            item.photos = photoUrls
          }
        }
      })

      await ctx.reply('Новые фото загружены ✅')
      await transitionToStep(ctx, runtime.user, STEPS.MY_EDIT_MENU, nextPayload, { skipIntro: true })
    }
  }
}

async function ensureEditableListing(ctx, runtime) {
  const listingId = runtime.payload?.my?.editingId
  if (!listingId) {
    await ctx.reply('Не выбрано объявление для редактирования.')
    await transitionToStep(ctx, runtime.user, STEPS.MY_LIST, runtime.payload, { skipIntro: true })
    return null
  }

  const listing = await fetchListingForOwner(listingId, runtime.user.userId)
  if (!listing) {
    await ctx.reply('Карточка не найдена или уже удалена.')
    const nextPayload = withMyPayload(runtime, my => {
      my.editingId = null
    })
    await transitionToStep(ctx, runtime.user, STEPS.MY_LIST, nextPayload, { skipIntro: true })
    return null
  }

  return listing
}

async function updateListingTitle(listingId, userId, title) {
  if (!listingId || !userId) {
    return false
  }
  const trimmed = title.trim()
  if (!trimmed) {
    return false
  }
  const [result] = await pool.query(
    'UPDATE listings SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? LIMIT 1',
    [trimmed, listingId, userId]
  )
  return result.affectedRows > 0
}

async function updateListingCategory(listingId, userId, categoryId) {
  if (!listingId || !userId || !categoryId) {
    return false
  }
  const normalized = normalizeCategoryId(categoryId)
  const option = CATEGORY_OPTIONS.find(option => option.id === normalized)
  if (!option) {
    return false
  }
  const [result] = await pool.query(
    'UPDATE listings SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? LIMIT 1',
    [normalized, listingId, userId]
  )
  return result.affectedRows > 0
}

async function updateListingOccurredAt(listingId, userId, date) {
  if (!listingId || !userId) {
    return false
  }
  const value = date ? formatMysqlDatetime(date) : null
  const [result] = await pool.query(
    'UPDATE listings SET occurred_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? LIMIT 1',
    [value, listingId, userId]
  )
  return result.affectedRows > 0
}

async function updateListingLocation(listingId, userId, lat, lng) {
  if (!listingId || !userId) {
    return false
  }
  const latitude = Number.isFinite(Number(lat)) ? Number(lat) : null
  const longitude = Number.isFinite(Number(lng)) ? Number(lng) : null
  const [result] = await pool.query(
    'UPDATE listings SET lat = ?, lng = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? LIMIT 1',
    [latitude, longitude, listingId, userId]
  )
  return result.affectedRows > 0
}

async function replaceListingPhotos(listingId, userId, photoUrls) {
  if (!listingId || !userId || !Array.isArray(photoUrls)) {
    return false
  }
  const [ownerRows] = await pool.query(
    'SELECT 1 FROM listings WHERE id = ? AND author_id = ? LIMIT 1',
    [listingId, userId]
  )
  if (ownerRows.length === 0) {
    return false
  }

  await pool.query('DELETE FROM photos WHERE listing_id = ?', [listingId])

  for (const url of photoUrls.slice(0, 3)) {
    await pool.query('INSERT INTO photos (id, listing_id, url) VALUES (?,?,?)', [crypto.randomUUID(), listingId, url])
  }

  await pool.query('UPDATE listings SET updated_at = CURRENT_TIMESTAMP WHERE id = ? LIMIT 1', [listingId])
  return true
}

