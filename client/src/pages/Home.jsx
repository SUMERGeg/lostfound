import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { getCategoryMeta, TYPE_META } from '../utils/categories.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080'
const formatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

const initialFilters = { type: '', category: '' }

export default function HomePage() {
  const outletContext = useOutletContext() ?? { filters: initialFilters }
  const filters = outletContext.filters ?? initialFilters

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    async function fetchListings() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: 100 })
        if (filters.type) params.set('type', filters.type)
        if (filters.category) params.set('category', filters.category)
        const response = await fetch(`${API_BASE}/listings?${params.toString()}`, {
          signal: controller.signal
        })
        if (!response.ok) {
          throw new Error(`Ошибка загрузки: ${response.status}`)
        }
        const data = await response.json()
        setItems(Array.isArray(data) ? data : [])
      } catch (err) {
        if (err.name === 'AbortError') {
          return
        }
        console.error('[Home] Ошибка загрузки ленты', err)
        setError('Не удалось загрузить объявления. Попробуйте обновить страницу.')
      } finally {
        setLoading(false)
      }
    }

    fetchListings()
    return () => controller.abort()
  }, [filters.type, filters.category])

  return (
    <section className="feed">
      <header className="feed__header">
        <h1>Лента объявлений</h1>
        <p>Свежие находки и потери. Выберите карточку, чтобы посмотреть детали.</p>
      </header>

      {loading && <div className="feed__state">Загружаем данные...</div>}
      {error && <div className="feed__state feed__state--error">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="feed__state">По выбранным фильтрам ничего не найдено.</div>
      )}

      <div className="feed__grid">
        {items.map(item => {
          const meta = getCategoryMeta(item.category)
          const typeMeta = TYPE_META[item.type] ?? { label: item.type, color: '#64748b', tint: '#e2e8f0' }
          const dateSource = item.occurred_at || item.created_at
          const when = dateSource ? formatter.format(new Date(dateSource)) : 'время не указано'

          return (
            <article key={item.id} className="feed-card">
              <div className="feed-card__badge" style={{ background: typeMeta.tint, color: typeMeta.color }}>
                {typeMeta.label}
              </div>
              <h2 className="feed-card__title">{item.title}</h2>
              <div className="feed-card__subtitle">
                <span className="feed-card__category">
                  <span aria-hidden="true">{meta.emoji}</span> {meta.label}
                </span>
                <span className="feed-card__time">{when}</span>
              </div>
              {item.description && <p className="feed-card__description">{item.description}</p>}
              <footer className="feed-card__footer">
                <Link to={`/listing/${item.id}`} className="feed-card__link">
                  Открыть карточку
                </Link>
              </footer>
            </article>
          )
        })}
      </div>
    </section>
  )
}

