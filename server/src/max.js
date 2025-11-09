import 'dotenv/config'
import { Bot } from '@maxhub/max-bot-api'
import pool from './db.js'
import {
  buildMainMenuKeyboard,
  handleMessage as handleFlowMessage,
  handleCallback as handleFlowCallback
} from './fsm.js'

const MAX_API_BASE = process.env.MAX_API_BASE
const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN

let botInstance = null

function ensureBot() {
  if (!MAX_BOT_TOKEN) {
    console.warn('[MAX] ⚠️ MAX_BOT_TOKEN не настроен — бот не будет запущен')
    return null
  }

  if (botInstance) {
    return botInstance
  }

  const clientOptions = MAX_API_BASE ? { clientOptions: { baseUrl: MAX_API_BASE } } : undefined
  const bot = new Bot(MAX_BOT_TOKEN, clientOptions)

  bot.catch((error, ctx) => {
    console.error('[MAX] Необработанная ошибка в боте:', error)
    if (ctx?.update) {
      console.error('[MAX] Контекст события:', JSON.stringify(ctx.update, null, 2))
    }
  })

  void bot.api.setMyCommands([
    {
      name: 'start',
      description: 'Открыть мини-приложение Lost&Found'
    },
    {
      name: 'stats',
      description: 'Показать статистику объявлений'
    }
  ]).catch(err => {
    console.error('[MAX] Не удалось установить список команд:', err)
  })

  bot.on('bot_started', async ctx => {
    await ctx.reply(
      '👋 Добро пожаловать в Lost&Found!\n\nЗдесь вы можете найти потерянные вещи или помочь вернуть находки владельцам.',
      {
        attachments: [buildMainMenuKeyboard()]
      }
    )
  })

  bot.command('start', async ctx => {
    await ctx.reply('Готово! Выберите действие из меню:', {
      attachments: [buildMainMenuKeyboard()]
    })
  })

  bot.command('stats', async ctx => {
    const statsMessage = await buildStatsMessage()
    await ctx.reply(statsMessage)
  })

  bot.on('message_created', async ctx => {
    await handleFlowMessage(ctx)
  })

  bot.on('message_callback', async ctx => {
    await handleFlowCallback(ctx)
  })

  botInstance = bot
  return botInstance
}

async function buildStatsMessage() {
  try {
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM listings WHERE status = "ACTIVE"')
    if (Number(total) === 0) {
      return '🔍 Пока нет активных объявлений. Добавьте первую находку или потерю!'
    }
    return `📊 Сейчас в базе ${total} активных объявлений. Загляните в мини-приложение, чтобы посмотреть подробности.`
  } catch (error) {
    console.error('[MAX] Не удалось получить статистику объявлений:', error)
    return '⚠️ Не получилось получить статистику сейчас. Попробуйте чуть позже.'
  }
}

export function getBot() {
  return ensureBot()
}

export async function startBot() {
  const bot = ensureBot()
  if (!bot) {
    return
  }

  try {
    await bot.start()
  } catch (error) {
    console.error('[MAX] Ошибка запуска long polling:', error)
    throw error
  }
}

export async function handleUpdate(update) {
  const bot = ensureBot()
  if (!bot) {
    console.warn('[MAX] Получено событие, но бот не настроен')
    return
  }

  await bot.handleUpdate(update)
}

export async function sendMessage(userId, text, extra = {}) {
  const bot = ensureBot()
  if (!bot) {
    throw new Error('MAX Bot не настроен')
  }

  return bot.api.sendMessageToUser(userId, text, extra)
}

