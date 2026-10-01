import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel } from '../components/ui.jsx'

export function ClaimPage() {
  const { id } = useParams()
  const { user, ready } = useAuth()
  const navigate = useNavigate()
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [state, setState] = useState({ loading: true, pending: false, error: '' })

  useEffect(() => {
    if (!user) return
    apiRequest(`/api/v1/owner-checks/questions/${id}`).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Проверка владельца недоступна')
      setQuestions(data)
      setState(current => ({ ...current, loading: false }))
    }).catch(error => setState(current => ({ ...current, loading: false, error: error.message })))
  }, [id, user])

  if (ready && !user) return <Navigate to="/login" state={{ from: `/ads/${id}/claim` }} replace />
  if (!ready || state.loading) return <Panel className="lf-state">Загружаем вопросы…</Panel>

  async function submit(event) {
    event.preventDefault()
    setState(current => ({ ...current, pending: true, error: '' }))
    const response = await apiRequest('/api/v1/owner-checks', {
      method: 'POST',
      body: JSON.stringify({ listingId: id, answers: questions.map(question => ({ questionId: question.id, answer: answers[question.id] })) })
    })
    const data = await response.json()
    if (!response.ok) return setState(current => ({ ...current, pending: false, error: data.message || 'Не удалось отправить ответы' }))
    navigate(`/owner-checks/${data.id}`)
  }

  return <section className="lf-auth"><Panel className="lf-auth__card lf-auth__card--wide"><h1>Подтвердите, что вещь ваша</h1><p>Ответы увидит только автор объявления.</p>{state.error && <div className="lf-form__error">{state.error}</div>}{questions.length > 0 && <form className="lf-form" onSubmit={submit}>{questions.map(question => <label key={question.id}>{question.prompt}<textarea required rows="3" maxLength="2000" value={answers[question.id] || ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} /></label>)}<Button type="submit" disabled={state.pending}>{state.pending ? 'Отправляем…' : 'Отправить ответы'}</Button></form>}</Panel></section>
}

export function OwnerChecksPage() {
  const { user, ready } = useAuth()
  const [checks, setChecks] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!user) return
    apiRequest('/api/v1/owner-checks').then(async response => {
      if (!response.ok) throw new Error('Не удалось загрузить проверки')
      setChecks(await response.json())
    }).catch(error => setError(error.message))
  }, [user])
  if (ready && !user) return <Navigate to="/login" state={{ from: '/owner-checks' }} replace />
  if (!ready) return <Panel className="lf-state">Загружаем проверки…</Panel>
  return <section className="lf-my-ads"><div className="lf-my-ads__heading"><h1>Проверки владельца</h1></div>{error && <Panel className="lf-state lf-state--error">{error}</Panel>}{checks.length === 0 && <Panel className="lf-state">Проверок пока нет.</Panel>}{checks.map(check => <Panel className="lf-my-ad" key={check.id}><div><span className={`lf-status lf-status--${check.status.toLowerCase()}`}>{statusLabel(check.status)}</span><h3>{check.title}</h3><p>{check.holderId === user.id ? 'Вы проверяете ответы' : 'Вы отправили ответы'}</p></div><Button asChild mode="secondary"><Link to={`/owner-checks/${check.id}`}>Открыть</Link></Button></Panel>)}</section>
}

export function OwnerCheckDetailPage() {
  const { id } = useParams()
  const { user, ready } = useAuth()
  const [check, setCheck] = useState(null)
  const [contacts, setContacts] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const response = await apiRequest(`/api/v1/owner-checks/${id}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'Проверка не найдена')
    setCheck(data)
    if (data.status === 'APPROVED') {
      const contactResponse = await apiRequest(`/api/v1/owner-checks/${id}/contacts`)
      if (contactResponse.ok) setContacts(await contactResponse.json())
    }
  }, [id])

  useEffect(() => {
    if (user) load().catch(error => setError(error.message))
  }, [load, user])

  if (ready && !user) return <Navigate to="/login" replace />
  if (!ready || (!check && !error)) return <Panel className="lf-state">Загружаем проверку…</Panel>

  async function decide(decision) {
    const response = await apiRequest(`/api/v1/owner-checks/${id}/decision`, { method: 'PATCH', body: JSON.stringify({ decision }) })
    if (!response.ok) return setError('Не удалось сохранить решение')
    await load()
  }

  if (error) return <Panel className="lf-state lf-state--error">{error}</Panel>
  const holder = check.holderId === user.id
  return <section className="lf-auth"><Panel className="lf-auth__card lf-auth__card--wide"><h1>{check.title}</h1><p>Статус: {statusLabel(check.status)}</p><div className="lf-answers">{check.answers.map((answer, index) => <div key={index}><strong>{answer.prompt}</strong><p>{answer.answer}</p></div>)}</div>{holder && check.status === 'PENDING' && <div className="lf-disclosure-warning" role="note"><strong>Перед подтверждением</strong><p>После подтверждения этому пользователю будут доступны выбранные вами контактные данные: {contactLabels(check.contactTypes)}.</p></div>}{holder && check.status === 'PENDING' && <div className="lf-my-ad__actions"><Button onClick={() => decide('APPROVED')} disabled={!check.contactTypes.length}>Подтвердить</Button><Button mode="secondary" onClick={() => decide('DECLINED')}>Отклонить</Button></div>}{contacts && <div className="lf-contacts"><h2>Контакты</h2>{contacts.email && <p>Email: {contacts.email}</p>}{contacts.phone && <p>Телефон: {contacts.phone}</p>}{contacts.telegram && <p>Telegram: {contacts.telegram}</p>}</div>}</Panel></section>
}

function statusLabel(status) {
  return ({ PENDING: 'На проверке', APPROVED: 'Подтверждено', DECLINED: 'Отклонено' })[status] || status
}

function contactLabels(types = []) {
  if (!types.length) return 'не выбраны — сначала обновите объявление'
  const labels = { EMAIL: 'email', PHONE: 'телефон', TELEGRAM: 'Telegram' }
  return types.map(type => labels[type] || type).join(', ')
}
