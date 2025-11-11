import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCategoryMeta, TYPE_META } from '../utils/categories.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080'
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit'
})

export default function ListingPage() {
  const { id } = useParams()
  const [listing, setListing] = useState(null)
  const [status, setStatus] = useState({ loading: true, error: null })

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setStatus({ loading: true, error: null })
      try {
        const response = await fetch(`${API_BASE}/listings/${id}`, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Ошибка загрузки: ${response.status}`)
        }
        const data = await response.json()
        setListing(data)
        setStatus({ loading: false, error: null })
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.error('[Listing] Ошибка загрузки карточки', error)
        setStatus({ loading: false, error: 'Не удалось загрузить объявление.' })
      }
    }

    load()
    return () => controller.abort()
  }, [id])

  const categoryMeta = listing ? getCategoryMeta(listing.category) : null
  const typeMeta = listing ? TYPE_META[listing.type] ?? { label: listing.type, color: '#64748b', tint: '#e2e8f0' } : null
  const occurredAt = listing?.occurred_at ? dateFormatter.format(new Date(listing.occurred_at)) : null
  const createdAt = listing?.created_at ? dateFormatter.format(new Date(listing.created_at)) : null

  return (
    <section className="listing-page">
      <Link to="/" className="listing-page__back">
        ← Вернуться к ленте
      </Link>

      {status.loading && <div className="listing-page__state">Загружаем данные...</div>}
      {status.error && <div className="listing-page__state listing-page__state--error">{status.error}</div>}

      {listing && !status.loading && !status.error && (
        <article className="listing-card">
          <header className="listing-card__header">
            {typeMeta && (
              <span className="listing-card__badge" style={{ background: typeMeta.tint, color: typeMeta.color }}>
                {typeMeta.label}
              </span>
            )}
            <h1>{listing.title}</h1>
            <div className="listing-card__meta">
              {categoryMeta && (
                <span className="listing-card__meta-item">
                  <span aria-hidden="true">{categoryMeta.emoji}</span> {categoryMeta.label}
                </span>
              )}
              {occurredAt && <span className="listing-card__meta-item">Произошло: {occurredAt}</span>}
              {createdAt && <span className="listing-card__meta-item">Добавлено: {createdAt}</span>}
            </div>
          </header>

          {listing.description && (
            <section className="listing-card__section">
              <h2>Описание</h2>
              <p>{listing.description}</p>
            </section>
          )}

          {(listing.lat !== null || listing.lng !== null || listing.location_note) && (
            <section className="listing-card__section listing-card__section--grid">
              <div>
                <h3>Локация</h3>
                {listing.location_note ? <p>{listing.location_note}</p> : <p>Не указана</p>}
              </div>
              {(listing.lat !== null || listing.lng !== null) && (
                <div>
                  <h3>Координаты</h3>
                  <p>
                    {listing.lat?.toFixed?.(5) ?? '—'} / {listing.lng?.toFixed?.(5) ?? '—'}
                  </p>
                  <a
                    className="listing-card__link"
                    href={`https://yandex.ru/maps/?ll=${listing.lng},${listing.lat}&z=16`}
                    target="_blank"
                    rel="noopener"
                  >
                    Открыть в Яндекс.Картах
                  </a>
                </div>
              )}
            </section>
          )}

          {Array.isArray(listing.photos) && listing.photos.length > 0 && (
            <section className="listing-card__section">
              <h2>Фото</h2>
              <div className="listing-card__photos">
                {listing.photos.map((url, index) => (
                  <img key={index} src={url} alt={`Фото ${index + 1}`} loading="lazy" />
                ))}
              </div>
            </section>
          )}

          <footer className="listing-card__footer">
            <p>Обращайтесь через чат-бота MAX, чтобы уточнить детали и пройти проверку владельца.</p>
          </footer>
        </article>
      )}
    </section>
  )
}
