import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel, Select } from '../components/ui.jsx'
import { CATEGORY_OPTIONS } from '../utils/categories.js'
import { attachImages, uploadImages } from '../uploads.js'
import ContactDisclosureFields from '../components/ContactDisclosureFields.jsx'

export default function CreateAdPage() {
  const { type: typeParam } = useParams()
  const type = typeParam?.toUpperCase()
  const { user, ready } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ category: 'other', title: '', description: '', occurredAt: '', lat: '', lng: '' })
  const [state, setState] = useState({ pending: false, error: '' })
  const [files, setFiles] = useState([])
  const [profile, setProfile] = useState(null)
  const [contactChannels, setContactChannels] = useState([])

  useEffect(() => {
    if (!user || type !== 'FOUND') return
    apiRequest('/api/v1/profile').then(async response => {
      if (!response.ok) throw new Error('Не удалось загрузить контакты профиля')
      setProfile(await response.json())
    }).catch(error => setState(current => ({ ...current, error: error.message })))
  }, [type, user])

  if (type !== 'LOST' && type !== 'FOUND') return <Navigate to="/ads" replace />
  if (ready && !user) return <Navigate to="/login" state={{ from: `/create/${typeParam}` }} replace />
  if (!ready) return <Panel className="lf-state">Проверяем сессию…</Panel>

  async function submit(event) {
    event.preventDefault()
    setState({ pending: true, error: '' })
    try {
      const uploads = await uploadImages(files)
      const response = await apiRequest('/api/v1/ads', {
        method: 'POST',
        body: JSON.stringify({
          type,
          category: form.category,
          title: form.title,
          description: form.description,
          occurredAt: form.occurredAt || null,
          lat: form.lat || null,
          lng: form.lng || null
          ,contactChannels: type === 'FOUND' ? contactChannels : []
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Не удалось опубликовать объявление')
      if (uploads.length) await attachImages(data.id, uploads)
      navigate(`/ads/${data.id}`)
    } catch (error) {
      setState({ pending: false, error: error.message })
    }
  }

  return <section className="lf-auth"><Panel className="lf-auth__card lf-auth__card--wide">
    <h1>{type === 'LOST' ? 'Я потерял' : 'Я нашёл'}</h1>
    <p>Опишите предмет и место. Контакты не публикуются в открытом API.</p>
    <form onSubmit={submit} className="lf-form">
      <div className="lf-field"><span>Категория</span><Select ariaLabel="Категория объявления" value={form.category} onChange={category => setForm(current => ({ ...current, category }))} options={CATEGORY_OPTIONS.map(option => ({ value: option.id, label: `${option.emoji} ${option.label}` }))} /></div>
      <label>Название<input required maxLength="255" value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label>
      <label>Описание<textarea rows="5" maxLength="3000" value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label>
      <label>Дата и время<input type="datetime-local" value={form.occurredAt} onChange={event => setForm(current => ({ ...current, occurredAt: event.target.value }))} /></label>
      <div className="lf-form__grid">
        <label>Широта<input type="number" step="any" min="-90" max="90" value={form.lat} onChange={event => setForm(current => ({ ...current, lat: event.target.value }))} /></label>
        <label>Долгота<input type="number" step="any" min="-180" max="180" value={form.lng} onChange={event => setForm(current => ({ ...current, lng: event.target.value }))} /></label>
      </div>
      {type === 'FOUND' && <ContactDisclosureFields profile={profile} value={contactChannels} onChange={setContactChannels} />}
      <label>Фотографии (до 3, JPEG/PNG/WebP, до 8 МБ каждая)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => setFiles(Array.from(event.target.files || []).slice(0, 3))} /></label>
      {files.length > 0 && <div className="lf-upload-list">{files.map(file => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}</div>}
      {state.error && <div className="lf-form__error" role="alert">{state.error}</div>}
      <Button type="submit" disabled={state.pending || (type === 'FOUND' && contactChannels.length === 0)}>{state.pending ? 'Публикуем…' : 'Опубликовать'}</Button>
    </form>
  </Panel></section>
}
