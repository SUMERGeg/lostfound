import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel } from '../components/ui.jsx'

export default function NotificationsPage() {
  const { user, ready } = useAuth()
  const [items, setItems] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    apiRequest('/api/v1/notifications?limit=100').then(async response => {
      if (!response.ok) throw new Error('Не удалось загрузить уведомления')
      setItems(await response.json())
    }).catch(error => setError(error.message))
  }, [user])

  if (ready && !user) return <Navigate to="/login" state={{ from: '/notifications' }} replace />
  if (!ready) return <Panel className="lf-state">Загружаем уведомления…</Panel>

  async function markRead(id) {
    const response = await apiRequest(`/api/v1/notifications/${id}/read`, { method: 'PATCH' })
    if (response.ok) setItems(current => current.map(item => item.id === id ? { ...item, status: 'READ' } : item))
  }

  return <section className="lf-my-ads"><div className="lf-my-ads__heading"><h1>Уведомления</h1></div>{error && <Panel className="lf-state lf-state--error">{error}</Panel>}{items.length === 0 && <Panel className="lf-state">Новых уведомлений нет.</Panel>}{items.map(item => <Panel key={item.id} className={`lf-notification ${item.status === 'UNREAD' || item.status === 'ACTION' ? 'lf-notification--unread' : ''}`}><div><h3>{item.title || 'Уведомление'}</h3><p>{item.body}</p></div><div className="lf-my-ad__actions">{item.payload?.ownerCheckId && <Button asChild mode="secondary"><Link to={`/owner-checks/${item.payload.ownerCheckId}`}>Открыть</Link></Button>}{item.payload?.matchId && <Button asChild mode="secondary"><Link to="/matches">Открыть совпадение</Link></Button>}{item.status !== 'READ' && <Button mode="secondary" onClick={() => markRead(item.id)}>Прочитано</Button>}</div></Panel>)}</section>
}
