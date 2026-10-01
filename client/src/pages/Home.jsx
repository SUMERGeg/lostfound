import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Panel } from '../components/ui.jsx'
import { getCategoryMeta, TYPE_META } from '../utils/categories.js'
import { apiRequest } from '../api.js'

const formatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
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
        const response = await apiRequest(`/api/v1/ads?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Ошибка загрузки: ${response.status}`)
        const data = await response.json()
        setItems(Array.isArray(data) ? data : [])
      } catch (requestError) {
        if (requestError.name === 'AbortError') return
        console.error('[Home] Ошибка загрузки ленты', requestError)
        setError('Не удалось загрузить объявления. Попробуйте обновить страницу.')
      } finally {
        setLoading(false)
      }
    }
    fetchListings()
    return () => controller.abort()
  }, [filters.type, filters.category])

  return (
    <section id="demo-feed" className="lf-section">
      <header className="lf-feed-heading">
        <div>
          <p className="lf-eyebrow lf-eyebrow--dark"><span /> Рядом с вами</p>
          <h2>Свежие объявления</h2>
        </div>
        {!loading && !error && <span className="lf-result-count">{items.length} {pluralize(items.length)}</span>}
      </header>

      {loading && <Panel className="lf-state"><span className="lf-loader" /> Загружаем объявления…</Panel>}
      {error && <Panel className="lf-state lf-state--error">{error}</Panel>}
      {!loading && !error && items.length === 0 && (
        <Panel className="lf-state">По выбранным фильтрам ничего не найдено. Попробуйте расширить поиск.</Panel>
      )}

      <div className="lf-feed">
        {items.map(item => {
          const meta = getCategoryMeta(item.category)
          const typeMeta = TYPE_META[item.type] ?? { label: item.type, color: '#64748b', tint: '#e2e8f0' }
          const dateSource = item.occurred_at || item.created_at
          const when = dateSource ? formatter.format(new Date(dateSource)) : 'Время не указано'
          const previewPhoto = item.preview_photo || (Array.isArray(item.photos) ? item.photos[0] : null)

          return (
            <article key={item.id} className="lf-card">
              <Link className="lf-card__photo" to={`/ads/${item.id}`} aria-label={`Открыть: ${item.title}`}>
                {previewPhoto ? (
                  <img src={previewPhoto} alt="" loading="lazy" />
                ) : (
                  <span className="lf-card__photo-placeholder" style={{ background: typeMeta.tint, color: typeMeta.color }}>{meta.emoji}</span>
                )}
                <span className="lf-card__status-pill" style={{ color: typeMeta.color, background: typeMeta.tint }}>{typeMeta.label}</span>
              </Link>
              <div className="lf-card__body">
                <div className="lf-card__meta"><span>{meta.emoji} {meta.label}</span><time>{when}</time></div>
                <h3><Link to={`/ads/${item.id}`}>{item.title}</Link></h3>
                {item.description && <p>{item.description}</p>}
                <Link className="lf-card__cta" to={`/ads/${item.id}`}>Подробнее <span aria-hidden="true">→</span></Link>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function pluralize(count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'объявление'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'объявления'
  return 'объявлений'
}
