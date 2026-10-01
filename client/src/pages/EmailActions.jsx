import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel } from '../components/ui.jsx'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const { renewSession } = useAuth()
  const [state, setState] = useState({ loading: true, error: '' })

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setState({ loading: false, error: 'Ссылка подтверждения неполная.' })
      return
    }
    apiRequest('/api/v1/auth/verify-email', {
      method: 'POST', body: JSON.stringify({ token }), skipRefresh: true
    }).then(async response => {
      if (!response.ok) throw new Error('Ссылка недействительна или устарела.')
      await renewSession()
      setState({ loading: false, error: '' })
    }).catch(error => setState({ loading: false, error: error.message }))
  }, [params, renewSession])

  return <ActionCard title="Подтверждение email" state={state} success="Email подтверждён. Теперь можно публиковать объявления." />
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState({ pending: false, sent: false, error: '' })

  async function submit(event) {
    event.preventDefault()
    setState({ pending: true, sent: false, error: '' })
    try {
      const response = await apiRequest('/api/v1/auth/forgot-password', {
        method: 'POST', body: JSON.stringify({ email }), skipRefresh: true
      })
      if (!response.ok) throw new Error('Не удалось обработать запрос.')
      setState({ pending: false, sent: true, error: '' })
    } catch (error) {
      setState({ pending: false, sent: false, error: error.message })
    }
  }

  return <section className="lf-auth"><Panel className="lf-auth__card"><h1>Восстановление пароля</h1><p>Если аккаунт существует, мы отправим письмо со ссылкой.</p>{state.sent ? <><div className="lf-form__success">Проверьте почту.</div><p className="lf-auth__switch"><Link to="/login">Вернуться ко входу</Link></p></> : <form className="lf-form" onSubmit={submit}><label>Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>{state.error && <div className="lf-form__error">{state.error}</div>}<Button type="submit" disabled={state.pending}>{state.pending ? 'Отправляем…' : 'Отправить ссылку'}</Button></form>}</Panel></section>
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const [password, setPassword] = useState('')
  const [state, setState] = useState({ pending: false, done: false, error: '' })

  async function submit(event) {
    event.preventDefault()
    setState({ pending: true, done: false, error: '' })
    try {
      const response = await apiRequest('/api/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: params.get('token'), password }),
        skipRefresh: true
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Ссылка недействительна или устарела.')
      setState({ pending: false, done: true, error: '' })
    } catch (error) {
      setState({ pending: false, done: false, error: error.message })
    }
  }

  return <section className="lf-auth"><Panel className="lf-auth__card"><h1>Новый пароль</h1>{state.done ? <><div className="lf-form__success">Пароль изменён. Все старые сессии завершены.</div><p className="lf-auth__switch"><Link to="/login">Войти</Link></p></> : <form className="lf-form" onSubmit={submit}><label>Новый пароль<input required type="password" minLength="12" maxLength="128" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>{state.error && <div className="lf-form__error">{state.error}</div>}<Button type="submit" disabled={state.pending}>{state.pending ? 'Сохраняем…' : 'Изменить пароль'}</Button></form>}</Panel></section>
}

function ActionCard({ title, state, success }) {
  return <section className="lf-auth"><Panel className="lf-auth__card"><h1>{title}</h1>{state.loading ? <p>Проверяем ссылку…</p> : state.error ? <div className="lf-form__error">{state.error}</div> : <div className="lf-form__success">{success}</div>}<p className="lf-auth__switch"><Link to="/profile">Перейти в профиль</Link></p></Panel></section>
}
