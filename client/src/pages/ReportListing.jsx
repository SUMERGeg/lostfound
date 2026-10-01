import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel, Select } from '../components/ui.jsx'

const reasons = [
  ['SPAM', 'Спам'],
  ['FRAUD', 'Мошенничество'],
  ['INAPPROPRIATE', 'Недопустимый контент'],
  ['DUPLICATE', 'Дубликат'],
  ['OTHER', 'Другое']
]

export default function ReportListingPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, ready } = useAuth()
  const [reason, setReason] = useState('SPAM')
  const [details, setDetails] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (ready && !user) return <Navigate to="/login" state={{ from: `/ads/${id}/report` }} replace />
  if (!ready) return <Panel className="lf-state">Проверяем авторизацию…</Panel>

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    const response = await apiRequest('/api/v1/reports', {
      method: 'POST',
      body: JSON.stringify({ listingId: id, reason, details })
    })
    const data = await response.json().catch(() => ({}))
    setSaving(false)
    if (!response.ok) return setError(data.error === 'report_exists' ? 'Вы уже пожаловались на это объявление.' : 'Не удалось отправить жалобу.')
    navigate(`/ads/${id}`, { replace: true, state: { reportSent: true } })
  }

  return <section className="lf-auth"><Panel className="lf-auth__card">
    <h1>Пожаловаться на объявление</h1>
    <p>Жалоба попадёт в закрытую очередь модераторов.</p>
    <form className="lf-form" onSubmit={submit}>
      <div className="lf-field"><span>Причина</span><Select ariaLabel="Причина жалобы" value={reason} onChange={setReason} options={reasons} /></div>
      <label>Подробности<textarea rows="5" maxLength="2000" value={details} onChange={event => setDetails(event.target.value)} /></label>
      {error && <div className="lf-form__error">{error}</div>}
      <Button type="submit" disabled={saving}>{saving ? 'Отправляем…' : 'Отправить жалобу'}</Button>
      <Button asChild mode="secondary"><Link to={`/ads/${id}`}>Отмена</Link></Button>
    </form>
  </Panel></section>
}
