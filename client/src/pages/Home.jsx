import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Button, Flex, Panel, Typography } from '@maxhub/max-ui'
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
    <section className="lf-section">
      <Panel mode="secondary" className="lf-section__panel">
        <Flex direction="column" gap={6}>
          <Typography.Title variant="medium-strong">Лента объявлений</Typography.Title>
          <Typography.Body variant="medium" className="lf-section__subtitle">
            Свежие находки и потери снизу сверху, фильтруйте и открывайте детали, чтобы связаться с автором через бота.
          </Typography.Body>
        </Flex>
      </Panel>

      {loading && (
        <Panel mode="secondary" className="lf-state">
          <Typography.Body variant="medium">Загружаем данные...</Typography.Body>
        </Panel>
      )}
      {error && (
        <Panel mode="secondary" className="lf-state lf-state--error">
          <Typography.Body variant="medium">{error}</Typography.Body>
        </Panel>
      )}
      {!loading && !error && items.length === 0 && (
        <Panel mode="secondary" className="lf-state">
          <Typography.Body variant="medium">
            По выбранным фильтрам ничего не найдено. Попробуйте расширить поиск.
          </Typography.Body>
        </Panel>
      )}

      <div className="lf-feed">
        {items.map(item => {
          const meta = getCategoryMeta(item.category)
          const typeMeta = TYPE_META[item.type] ?? { label: item.type, color: '#64748b', tint: '#e2e8f0' }
          const dateSource = item.occurred_at || item.created_at
          const when = dateSource ? formatter.format(new Date(dateSource)) : 'время не указано'

          const previewPhoto =
            item.preview_photo ||
            (Array.isArray(item.photos) && item.photos.length > 0 ? item.photos[0] : null)

  return (
            <Panel key={item.id} mode="primary" className="lf-card">
              <div className="lf-card__top">
                <span className="lf-card__status-pill" style={{ color: typeMeta.color, background: typeMeta.tint }}>
                  {typeMeta.label}
                </span>
                <span className="lf-card__time">{when}</span>
              </div>
              <Flex direction="column" gap={12} className="lf-card__content">
                <Typography.Title variant="small-strong" asChild>
                  <h2 className="lf-card__title">{item.title}</h2>
                </Typography.Title>
                {item.description && (
                  <Typography.Body variant="medium" className="lf-card__excerpt">
                    {item.description}
                  </Typography.Body>
                )}
                <Typography.Body variant="medium" className="lf-card__category">
                  <span aria-hidden="true">{meta.emoji}</span> {meta.label}
                </Typography.Body>
                <Button asChild size="medium" mode="primary" appearance="themed" className="lf-card__cta">
                  <Link to={`/listing/${item.id}`}>Открыть карточку</Link>
                </Button>
              </Flex>
              <Flex direction="column" align="stretch" gap={12} className="lf-card__media">
                <div
                  className={previewPhoto ? 'lf-card__photo' : 'lf-card__photo lf-card__photo--empty'}
                  style={previewPhoto ? undefined : { background: typeMeta.tint, color: typeMeta.color }}
                >
                  {previewPhoto ? (
                    <img src={previewPhoto} alt={item.title} loading="lazy" />
                  ) : (
                    <div className="lf-card__photo-placeholder" aria-hidden="true">
                      <span className="lf-card__placeholder-emoji">{meta.emoji}</span>
                    </div>
                  )}
    </div>
              </Flex>
            </Panel>
          )
        })}
      </div>
    </section>
  )
}

