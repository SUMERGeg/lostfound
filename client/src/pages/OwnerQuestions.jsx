import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel } from '../components/ui.jsx'

export default function OwnerQuestionsPage() {
  const { id } = useParams()
  const { user, ready } = useAuth()
  const navigate = useNavigate()
  const [prompts, setPrompts] = useState([''])
  const [state, setState] = useState({ pending: false, error: '' })
  if (ready && !user) return <Navigate to="/login" replace />
  if (!ready) return <Panel className="lf-state">Проверяем сессию…</Panel>

  function update(index, value) {
    setPrompts(current => current.map((prompt, itemIndex) => itemIndex === index ? value : prompt))
  }
  async function submit(event) {
    event.preventDefault()
    setState({ pending: true, error: '' })
    const response = await apiRequest(`/api/v1/owner-checks/questions/${id}`, { method: 'PUT', body: JSON.stringify({ prompts }) })
    const data = await response.json()
    if (!response.ok) return setState({ pending: false, error: data.message || 'Не удалось сохранить вопросы' })
    navigate('/profile')
  }
  return <section className="lf-auth"><Panel className="lf-auth__card lf-auth__card--wide"><h1>Вопросы проверки владельца</h1><p>Не указывайте ответ в вопросе и не используйте публично заметные признаки.</p><form className="lf-form" onSubmit={submit}>{prompts.map((prompt, index) => <label key={index}>Вопрос {index + 1}<textarea required maxLength="500" rows="2" value={prompt} onChange={event => update(index, event.target.value)} /></label>)}<div className="lf-my-ad__actions">{prompts.length < 3 && <Button type="button" mode="secondary" onClick={() => setPrompts(current => [...current, ''])}>Добавить вопрос</Button>}{prompts.length > 1 && <Button type="button" mode="secondary" onClick={() => setPrompts(current => current.slice(0, -1))}>Убрать последний</Button>}</div>{state.error && <div className="lf-form__error">{state.error}</div>}<Button type="submit" disabled={state.pending}>{state.pending ? 'Сохраняем…' : 'Сохранить вопросы'}</Button></form></Panel></section>
}
