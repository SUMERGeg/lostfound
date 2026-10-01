import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel } from '../components/ui.jsx'
import { getCategoryMeta, TYPE_META } from '../utils/categories.js'

export default function ProfilePage() {
  const { user, ready, logout } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [ads, setAds] = useState([])
  const [state, setState] = useState({ loading: true, pending: false, error: '', success: '' })
  const [deletionOpen, setDeletionOpen] = useState(false)
  const [deletion, setDeletion] = useState({ password: '', confirmation: '' })
  const [deletionError, setDeletionError] = useState('')

  const load = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: '' }))
    try {
      const [profileResponse, adsResponse] = await Promise.all([
        apiRequest('/api/v1/profile'),
        apiRequest('/api/v1/ads/mine')
      ])
      if (!profileResponse.ok || !adsResponse.ok) throw new Error('Не удалось загрузить профиль')
      setProfile(await profileResponse.json())
      setAds(await adsResponse.json())
      setState(current => ({ ...current, loading: false }))
    } catch (error) {
      setState(current => ({ ...current, loading: false, error: error.message }))
    }
  }, [])

  useEffect(() => {
    if (user) load()
  }, [load, user])

  if (ready && !user) return <Navigate to="/login" state={{ from: '/profile' }} replace />
  if (!ready || state.loading) return <Panel className="lf-state">Загружаем профиль…</Panel>

  async function saveProfile(event) {
    event.preventDefault()
    setState(current => ({ ...current, pending: true, error: '', success: '' }))
    const response = await apiRequest('/api/v1/profile', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: profile.displayName, phone: profile.phone || null, telegram: profile.telegram || null })
    })
    setState(current => ({
      ...current,
      pending: false,
      error: response.ok ? '' : 'Не удалось сохранить профиль',
      success: response.ok ? 'Профиль сохранён' : ''
    }))
  }

  async function closeAd(id) {
    const response = await apiRequest(`/api/v1/ads/${id}/close`, { method: 'PATCH' })
    if (response.ok) await load()
    else setState(current => ({ ...current, error: 'Не удалось закрыть объявление' }))
  }

  async function resendVerification() {
    setState(current => ({ ...current, pending: true, error: '', success: '' }))
    const response = await apiRequest('/api/v1/auth/verification-email', { method: 'POST' })
    setState(current => ({
      ...current,
      pending: false,
      error: response.ok ? '' : 'Не удалось отправить письмо',
      success: response.ok ? 'Письмо подтверждения поставлено в очередь' : ''
    }))
  }

  async function deleteAccount(event) {
    event.preventDefault()
    if (deletion.confirmation !== 'УДАЛИТЬ') return
    setDeletionError('')
    setState(current => ({ ...current, pending: true, error: '', success: '' }))
    const response = await apiRequest('/api/v1/profile', {
      method: 'DELETE',
      body: JSON.stringify({ currentPassword: deletion.password, confirmation: 'DELETE' })
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = body.error === 'invalid_password'
        ? 'Текущий пароль указан неверно.'
        : 'Не удалось удалить аккаунт. Попробуйте ещё раз.'
      setState(current => ({ ...current, pending: false }))
      setDeletionError(message)
      return
    }
    await logout()
    navigate('/ads', { replace: true })
  }

  return <section className="lf-profile">
    <Panel className="lf-auth__card lf-auth__card--wide">
      <h1>Профиль</h1>
      <p>{profile.email}</p>
      {!profile.emailVerifiedAt && <div className="lf-verification"><span>Email не подтверждён. Публикация объявлений временно недоступна.</span><Button type="button" mode="secondary" onClick={resendVerification} disabled={state.pending}>Отправить письмо ещё раз</Button></div>}
      <form className="lf-form" onSubmit={saveProfile}>
        <label>Имя<input required minLength="2" maxLength="120" value={profile.displayName || ''} onChange={event => setProfile(current => ({ ...current, displayName: event.target.value }))} /></label>
        <div className="lf-form__grid">
          <label>Телефон<input maxLength="32" value={profile.phone || ''} onChange={event => setProfile(current => ({ ...current, phone: event.target.value }))} /></label>
          <label>Telegram<input maxLength="64" value={profile.telegram || ''} onChange={event => setProfile(current => ({ ...current, telegram: event.target.value }))} /></label>
        </div>
        {state.error && <div className="lf-form__error" role="alert">{state.error}</div>}
        {state.success && <div className="lf-form__success" role="status">{state.success}</div>}
        <Button type="submit" disabled={state.pending}>{state.pending ? 'Сохраняем…' : 'Сохранить профиль'}</Button>
      </form>
    </Panel>

    <section className="lf-my-ads">
      <div className="lf-my-ads__heading"><h2>Мои объявления</h2><Button asChild><Link to="/create/lost">Создать</Link></Button></div>
      {ads.length === 0 && <Panel className="lf-state">У вас пока нет объявлений.</Panel>}
      {ads.map(ad => {
        const type = TYPE_META[ad.type] ?? { label: ad.type }
        const category = getCategoryMeta(ad.category)
        return <Panel key={ad.id} className="lf-my-ad">
          <div><span className={`lf-status lf-status--${ad.status.toLowerCase()}`}>{ad.status === 'ACTIVE' ? 'Активно' : 'Закрыто'}</span><h3>{ad.title}</h3><p>{type.label} · {category.emoji} {category.label}</p></div>
          <div className="lf-my-ad__actions"><Button asChild mode="secondary"><Link to={`/ads/${ad.id}/edit`}>Редактировать</Link></Button>{ad.type === 'FOUND' && ad.status === 'ACTIVE' && <Button asChild mode="secondary"><Link to={`/ads/${ad.id}/owner-questions`}>Вопросы проверки</Link></Button>}{ad.status === 'ACTIVE' && <Button mode="secondary" onClick={() => closeAd(ad.id)}>Закрыть</Button>}</div>
        </Panel>
      })}
    </section>

    <Panel className="lf-danger">
      <h2>Удаление аккаунта</h2>
      <p>Аккаунт, объявления, закрытые ответы, уведомления и фотографии будут удалены. Все сессии завершатся. Автоматически восстановить данные не получится.</p>
      {!deletionOpen ? (
        <Button mode="secondary" onClick={() => setDeletionOpen(true)}>Перейти к удалению</Button>
      ) : (
        <form className="lf-deletion-form" onSubmit={deleteAccount}>
          <label>Текущий пароль<input type="password" autoComplete="current-password" required value={deletion.password} onChange={event => setDeletion(current => ({ ...current, password: event.target.value }))} /></label>
          <label>Для подтверждения введите «УДАЛИТЬ»<input required value={deletion.confirmation} onChange={event => setDeletion(current => ({ ...current, confirmation: event.target.value }))} /></label>
          {deletionError && <div className="lf-form__error" role="alert">{deletionError}</div>}
          <div className="lf-deletion-form__actions">
            <Button type="submit" className="lf-deletion-form__submit" disabled={state.pending || deletion.confirmation !== 'УДАЛИТЬ'}>{state.pending ? 'Удаляем…' : 'Удалить без возможности восстановления'}</Button>
            <Button type="button" mode="secondary" disabled={state.pending} onClick={() => { setDeletionOpen(false); setDeletion({ password: '', confirmation: '' }); setDeletionError('') }}>Отмена</Button>
          </div>
        </form>
      )}
    </Panel>
  </section>
}
