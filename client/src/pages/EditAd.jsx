import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel, Select } from '../components/ui.jsx'
import { CATEGORY_OPTIONS } from '../utils/categories.js'
import { attachImages, uploadImages } from '../uploads.js'
import ContactDisclosureFields from '../components/ContactDisclosureFields.jsx'

function inputDate(value) {
  return value ? new Date(value).toISOString().slice(0, 16) : ''
}

export default function EditAdPage() {
  const { id } = useParams()
  const { user, ready } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(null)
  const [state, setState] = useState({ pending: false, error: '' })
  const [files, setFiles] = useState([])
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (!user) return
    apiRequest(`/api/v1/ads/mine/${id}`).then(async response => {
      if (!response.ok) throw new Error('Объявление не найдено')
      const ad = await response.json()
      setForm({
        ...ad,
        occurredAt: inputDate(ad.occurred_at),
        lat: ad.lat ?? '',
        lng: ad.lng ?? '',
        contactChannels: [ad.allowEmailDisclosure && 'EMAIL', ad.allowPhoneDisclosure && 'PHONE', ad.allowTelegramDisclosure && 'TELEGRAM'].filter(Boolean)
      })
      if (ad.type === 'FOUND') {
        const profileResponse = await apiRequest('/api/v1/profile')
        if (!profileResponse.ok) throw new Error('Не удалось загрузить контакты профиля')
        setProfile(await profileResponse.json())
      }
    }).catch(error => setState(current => ({ ...current, error: error.message })))
  }, [id, user])

  if (ready && !user) return <Navigate to="/login" state={{ from: `/ads/${id}/edit` }} replace />
  if (!ready || (!form && !state.error)) return <Panel className="lf-state">Загружаем объявление…</Panel>
  if (!form) return <Panel className="lf-state lf-state--error">{state.error}</Panel>

  async function submit(event) {
    event.preventDefault()
    setState({ pending: true, error: '' })
    const response = await apiRequest(`/api/v1/ads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: form.title,
        category: form.category,
        description: form.description,
        occurredAt: form.occurredAt || null,
        lat: form.lat || null,
        lng: form.lng || null
        ,contactChannels: form.type === 'FOUND' ? form.contactChannels : []
      })
    })
    if (response.ok) {
      try {
        if (files.length) await attachImages(id, await uploadImages(files))
        return navigate('/profile')
      } catch (error) {
        return setState({ pending: false, error: error.message })
      }
    }
    const data = await response.json()
    setState({ pending: false, error: data.message || 'Не удалось сохранить объявление' })
  }

  return <section className="lf-auth"><Panel className="lf-auth__card lf-auth__card--wide"><h1>Редактировать объявление</h1><p>Тип объявления после публикации не меняется.</p><form className="lf-form" onSubmit={submit}>
    <div className="lf-field"><span>Категория</span><Select ariaLabel="Категория объявления" value={form.category} onChange={category => setForm(current => ({ ...current, category }))} options={CATEGORY_OPTIONS.map(option => ({ value: option.id, label: `${option.emoji} ${option.label}` }))} /></div>
    <label>Название<input required maxLength="255" value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label>
    <label>Описание<textarea rows="5" maxLength="3000" value={form.description || ''} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label>
    <label>Дата и время<input type="datetime-local" value={form.occurredAt} onChange={event => setForm(current => ({ ...current, occurredAt: event.target.value }))} /></label>
    <div className="lf-form__grid"><label>Широта<input type="number" step="any" min="-90" max="90" value={form.lat} onChange={event => setForm(current => ({ ...current, lat: event.target.value }))} /></label><label>Долгота<input type="number" step="any" min="-180" max="180" value={form.lng} onChange={event => setForm(current => ({ ...current, lng: event.target.value }))} /></label></div>
    {form.type === 'FOUND' && <ContactDisclosureFields profile={profile} value={form.contactChannels} onChange={contactChannels => setForm(current => ({ ...current, contactChannels }))} />}
    <label>Заменить фотографии (до 3)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => setFiles(Array.from(event.target.files || []).slice(0, 3))} /></label>
    {files.length > 0 && <div className="lf-upload-list">{files.map(file => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}</div>}
    {state.error && <div className="lf-form__error" role="alert">{state.error}</div>}
    <Button type="submit" disabled={state.pending || (form.type === 'FOUND' && form.contactChannels.length === 0)}>{state.pending ? 'Сохраняем…' : 'Сохранить'}</Button>
  </form></Panel></section>
}
