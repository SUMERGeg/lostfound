import 'dotenv/config'

export async function handleBotEvent(update) {
  // TODO: подключить официальный MAX SDK, когда будет доступен
  const type = update?.type ?? 'unknown'
  switch (type) {
    case 'bot_started':
      console.log('Новый пользователь бота', update?.user)
      break
    case 'message_created':
      console.log('Получено сообщение', update?.message)
      break
    default:
      console.log('Получено событие', type)
  }
}

