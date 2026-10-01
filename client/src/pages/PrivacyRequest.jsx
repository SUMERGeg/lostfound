import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel, Select } from '../components/ui.jsx'
import { isPrivacyEmailConfigured, usePrivacyEmail } from '../privacyConfig.js'

const REQUEST_TYPES = [
  ['ACCESS', 'Получить копию данных'],
  ['CORRECTION', 'Исправить данные'],
  ['DELETION', 'Удалить данные'],
  ['WITHDRAW_CONSENT', 'Отозвать согласие'],
  ['OTHER', 'Другой вопрос']
]

export default function PrivacyRequestPage() {
  const { user } = useAuth()
  const privacyEmail = usePrivacyEmail()
  const [email, setEmail] = useState('')
  const [requestType, setRequestType] = useState('ACCESS')
  const [message, setMessage] = useState('')
  const [state, setState] = useState({ pending: false, error: '', receipt: null })

  async function submit(event) {
    event.preventDefault()
    setState({ pending: true, error: '', receipt: null })
    try {
      const response = await apiRequest('/api/v1/privacy-requests', {
        method: 'POST',
        body: JSON.stringify({ email, requestType, message }),
        skipRefresh: !user
      })
      const data = await response.json()
      if (!response.ok) {
        const error = response.status === 429
          ? 'Слишком много обращений. Попробуйте снова через час.'
          : data.message || 'Не удалось отправить обращение.'
        return setState({ pending: false, error, receipt: null })
      }
      setMessage('')
      setState({ pending: false, error: '', receipt: data })
    } catch {
      setState({ pending: false, error: 'Сервис временно недоступен. Попробуйте позднее.', receipt: null })
    }
  }

  return (
    <section className="lf-privacy-request">
      <div className="lf-privacy-request__intro">
        <p className="lf-eyebrow"><span /> Управление персональными данными</p>
        <h1>Ваши данные —<br /><em>под вашим контролем.</em></h1>
        <p>Отправьте запрос на доступ, исправление или удаление данных. Мы зарегистрируем обращение и ответим на указанный email после проверки личности.</p>
        <div className="lf-privacy-request__steps" aria-label="Как обрабатывается обращение">
          <span><b>01</b> Заполните форму</span>
          <span><b>02</b> Подтвердите личность</span>
          <span><b>03</b> Получите ответ</span>
        </div>
        <p className="lf-privacy-request__contact">
          Можно обратиться напрямую:{' '}
          {isPrivacyEmailConfigured(privacyEmail)
            ? <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>
            : <strong>{privacyEmail}</strong>}
        </p>
      </div>

      <Panel className="lf-privacy-request__card">
        <span className="lf-privacy-request__card-kicker">Защищённое обращение</span>
        <h2>Запрос по персональным данным</h2>
        <p>Не указывайте пароли, платёжные данные и другие секреты.</p>

        {state.receipt ? (
          <div className="lf-privacy-request__success" role="status">
            <span aria-hidden="true">✓</span>
            <h3>Обращение принято</h3>
            <p>Номер обращения: <strong>{state.receipt.id}</strong></p>
            <p>Сохраните номер — он поможет найти запрос при обращении в поддержку.</p>
            <Button mode="secondary" type="button" onClick={() => setState({ pending: false, error: '', receipt: null })}>Отправить ещё одно</Button>
          </div>
        ) : (
          <form className="lf-form" onSubmit={submit}>
            <label>
              Email для ответа
              <input
                required
                type="email"
                autoComplete="email"
                value={user?.email || email}
                disabled={Boolean(user)}
                onChange={event => setEmail(event.target.value)}
              />
              {user && <small>Используем подтверждённый email вашего аккаунта.</small>}
            </label>
            <div className="lf-field">
              <span>Что вы хотите сделать</span>
              <Select ariaLabel="Тип обращения" value={requestType} onChange={setRequestType} options={REQUEST_TYPES} />
            </div>
            <label>
              Подробности запроса
              <textarea required minLength="10" maxLength="3000" rows="6" value={message} onChange={event => setMessage(event.target.value)} placeholder="Опишите, какие данные или действия вас интересуют" />
              <small>{message.length} / 3000</small>
            </label>
            {state.error && <div className="lf-form__error" role="alert">{state.error}</div>}
            <Button type="submit" disabled={state.pending}>{state.pending ? 'Отправляем…' : 'Отправить обращение'}</Button>
            <p className="lf-privacy-request__agreement">Отправляя форму, вы соглашаетесь на обработку данных для ответа на запрос. Подробнее — в <Link to="/privacy">политике конфиденциальности</Link>.</p>
          </form>
        )}
      </Panel>
    </section>
  )
}
