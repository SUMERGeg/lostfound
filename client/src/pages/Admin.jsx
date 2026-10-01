import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel } from '../components/ui.jsx'

const TABS = [
  ['reports', 'Жалобы'],
  ['ads', 'Объявления'],
  ['users', 'Пользователи'],
  ['privacy-requests', 'Персональные данные']
]

const PRIVACY_TYPE_LABELS = {
  ACCESS: 'Доступ к данным',
  CORRECTION: 'Исправление данных',
  DELETION: 'Удаление данных',
  WITHDRAW_CONSENT: 'Отзыв согласия',
  OTHER: 'Другой вопрос'
}

const PRIVACY_STATUS_LABELS = {
  NEW: 'Новое',
  IN_PROGRESS: 'В работе',
  RESOLVED: 'Решено',
  REJECTED: 'Отклонено'
}

export default function AdminPage() {
  const { user, ready } = useAuth()
  const [tab, setTab] = useState('reports')
  const [items, setItems] = useState([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (user?.role !== 'ADMIN') return
    const response = await apiRequest(`/api/v1/admin/${tab}`)
    if (!response.ok) return setError('Не удалось загрузить данные модерации')
    setItems(await response.json())
    setError('')
  }, [tab, user])

  useEffect(() => { load() }, [load])
  if (ready && user?.role !== 'ADMIN') return <Navigate to="/ads" replace />
  if (!ready) return <Panel className="lf-state">Загружаем панель…</Panel>

  async function action(path, body) {
    const response = await apiRequest(path, { method: 'PATCH', body: JSON.stringify(body) })
    if (!response.ok) return setError('Действие не выполнено')
    await load()
  }

  return <section className="lf-admin">
    <header><div><span className="lf-admin__eyebrow">Панель оператора</span><h1>Модерация</h1></div><div className="lf-match__feedback">{TABS.map(([value, label]) => <Button key={value} mode={tab === value ? 'primary' : 'secondary'} onClick={() => setTab(value)}>{label}</Button>)}</div></header>
    {error && <Panel className="lf-state lf-state--error">{error}</Panel>}
    {!error && items.length === 0 && <Panel className="lf-state">В этом разделе пока нет записей.</Panel>}
    {tab === 'reports' && items.map(item => <Panel key={item.id} className="lf-admin__row"><div><span className={`lf-status lf-status--${item.status.toLowerCase()}`}>{item.status}</span><h2>{item.listingTitle}</h2><p><strong>{item.reason}</strong> · {item.details || 'Без пояснения'}</p><small>{item.reporterEmail} → {item.authorEmail}</small></div><div className="lf-my-ad__actions"><Button asChild mode="secondary"><Link to={`/ads/${item.listingId}`}>Объявление</Link></Button>{item.status !== 'IN_REVIEW' && <Button mode="secondary" onClick={() => action(`/api/v1/admin/reports/${item.id}`, { status: 'IN_REVIEW' })}>В работу</Button>}<Button onClick={() => action(`/api/v1/admin/reports/${item.id}`, { status: 'RESOLVED' })}>Решено</Button><Button mode="secondary" onClick={() => action(`/api/v1/admin/reports/${item.id}`, { status: 'REJECTED' })}>Отклонить</Button></div></Panel>)}
    {tab === 'ads' && items.map(item => <Panel key={item.id} className="lf-admin__row"><div><span className={`lf-status lf-status--${item.status.toLowerCase()}`}>{item.status}</span><h2>{item.title}</h2><p>{item.authorEmail} · открытых жалоб: {item.openReports}</p></div><div className="lf-my-ad__actions"><Button asChild mode="secondary"><Link to={`/ads/${item.id}`}>Открыть</Link></Button>{item.status === 'ACTIVE' && <Button onClick={() => action(`/api/v1/admin/ads/${item.id}`, { action: 'HIDE' })}>Скрыть</Button>}{item.status === 'HIDDEN' && <Button onClick={() => action(`/api/v1/admin/ads/${item.id}`, { action: 'RESTORE' })}>Вернуть</Button>}{item.status !== 'DELETED' && <Button mode="secondary" onClick={() => action(`/api/v1/admin/ads/${item.id}`, { action: 'DELETE' })}>Удалить</Button>}</div></Panel>)}
    {tab === 'users' && items.map(item => <Panel key={item.id} className="lf-admin__row"><div><span className={`lf-status lf-status--${item.status.toLowerCase()}`}>{item.status}</span><h2>{item.displayName}</h2><p>{item.email} · {item.role}</p></div>{item.role !== 'ADMIN' && <div className="lf-my-ad__actions">{item.status === 'ACTIVE' ? <Button onClick={() => action(`/api/v1/admin/users/${item.id}`, { action: 'BLOCK' })}>Заблокировать</Button> : item.status === 'BLOCKED' && <Button onClick={() => action(`/api/v1/admin/users/${item.id}`, { action: 'UNBLOCK' })}>Разблокировать</Button>}</div>}</Panel>)}
    {tab === 'privacy-requests' && items.map(item => <Panel key={item.id} className="lf-admin__row lf-admin__privacy-row"><div className="lf-admin__privacy-copy"><div className="lf-admin__privacy-meta"><span className={`lf-status lf-status--${item.status.toLowerCase()}`}>{PRIVACY_STATUS_LABELS[item.status] || item.status}</span><span>{PRIVACY_TYPE_LABELS[item.requestType] || item.requestType}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ru-RU')}</time></div><h2>{item.email || 'Данные удалены'}</h2><p>{item.message}</p><small>№ {item.id}{item.userId ? ' · пользователь сервиса' : ' · без входа в аккаунт'}</small></div><div className="lf-my-ad__actions">{item.status === 'NEW' && <Button mode="secondary" onClick={() => action(`/api/v1/admin/privacy-requests/${item.id}`, { status: 'IN_PROGRESS' })}>В работу</Button>}{['NEW', 'IN_PROGRESS'].includes(item.status) && <><Button onClick={() => action(`/api/v1/admin/privacy-requests/${item.id}`, { status: 'RESOLVED' })}>Решено</Button><Button mode="secondary" onClick={() => action(`/api/v1/admin/privacy-requests/${item.id}`, { status: 'REJECTED' })}>Отклонить</Button></>}</div></Panel>)}
  </section>
}
