import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel } from '../components/ui.jsx'
import { LEGAL_DOCUMENTS } from '../legal/documents.js'

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register'
  const { user, authenticate } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ displayName: '', email: '', password: '' })
  const [consents, setConsents] = useState({ terms: false, personalData: false })
  const [state, setState] = useState({ pending: false, error: '' })

  if (user) return <Navigate to="/ads" replace />

  async function submit(event) {
    event.preventDefault()
    setState({ pending: true, error: '' })
    try {
      const payload = isRegister ? {
        ...form,
        consents: [
          { type: 'TERMS', accepted: consents.terms, documentVersion: LEGAL_DOCUMENTS.terms.version },
          { type: 'PERSONAL_DATA', accepted: consents.personalData, documentVersion: LEGAL_DOCUMENTS.personalDataConsent.version },
        ]
      } : form
      const authenticatedUser = await authenticate(mode, payload)
      navigate(authenticatedUser.emailVerified ? (location.state?.from || '/ads') : '/profile', { replace: true })
    } catch (error) {
      setState({ pending: false, error: error.message })
    }
  }

  return <section className="lf-auth"><Panel className="lf-auth__card">
    <h1>{isRegister ? 'Создать аккаунт' : 'Войти'}</h1>
    <p>{isRegister ? 'Email будет доступным способом связи, но не попадёт в публичную карточку.' : 'Продолжите работу со своими объявлениями.'}</p>
    <form onSubmit={submit} className="lf-form">
      {isRegister && <label>Имя<input required minLength="2" maxLength="120" autoComplete="name" value={form.displayName} onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))} /></label>}
      <label>Email<input required type="email" autoComplete="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} /></label>
      <label>Пароль<input required type="password" minLength="12" maxLength="128" autoComplete={isRegister ? 'new-password' : 'current-password'} value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} /></label>
      {isRegister && <fieldset className="lf-consents">
        <legend>Обязательные подтверждения</legend>
        <label className="lf-consent">
          <input type="checkbox" checked={consents.terms} onChange={event => setConsents(current => ({ ...current, terms: event.target.checked }))} />
          <span>Я принимаю <Link to="/terms" target="_blank" rel="noreferrer">Пользовательское соглашение</Link></span>
        </label>
        <label className="lf-consent">
          <input type="checkbox" checked={consents.personalData} onChange={event => setConsents(current => ({ ...current, personalData: event.target.checked }))} />
          <span>Я даю <Link to="/personal-data-consent" target="_blank" rel="noreferrer">согласие на обработку персональных данных</Link></span>
        </label>
        <p>Оба подтверждения обязательны для создания аккаунта.</p>
      </fieldset>}
      {state.error && <div className="lf-form__error" role="alert">{state.error}</div>}
      <Button type="submit" disabled={state.pending || (isRegister && (!consents.terms || !consents.personalData))}>{state.pending ? 'Подождите…' : isRegister ? 'Зарегистрироваться' : 'Войти'}</Button>
    </form>
    <p className="lf-auth__switch">{isRegister ? 'Уже есть аккаунт?' : 'Нет аккаунта?'} <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Войти' : 'Зарегистрироваться'}</Link></p>
    {!isRegister && <p className="lf-auth__switch"><Link to="/forgot-password">Забыли пароль?</Link></p>}
  </Panel></section>
}
