import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Flex, Grid, Panel, Typography } from '@maxhub/max-ui'
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
    <section className="lf-section">
      <Button asChild mode="secondary" appearance="neutral-themed" size="medium" className="lf-back">
        <Link to="/">← Вернуться к ленте</Link>
      </Button>

      {status.loading && (
        <Panel mode="secondary" className="lf-state">
          <Typography.Body variant="medium">Загружаем данные...</Typography.Body>
        </Panel>
      )}
      {status.error && (
        <Panel mode="secondary" className="lf-state lf-state--error">
          <Typography.Body variant="medium">{status.error}</Typography.Body>
        </Panel>
      )}

      {listing && !status.loading && !status.error && (
        <Panel mode="primary" className="lf-listing">
          <Flex direction="column" gap={24}>
            <Flex direction="column" gap={16}>
              <Flex gap={12} align="center" wrap="wrap">
                {typeMeta && (
                  <span className="lf-card__badge" style={{ background: typeMeta.tint, color: typeMeta.color }}>
                    {typeMeta.label}
                  </span>
                )}
                {categoryMeta && (
                  <Typography.Label variant="medium-strong">
                    <span aria-hidden="true">{categoryMeta.emoji}</span> {categoryMeta.label}
                  </Typography.Label>
                )}
              </Flex>
              <Typography.Title variant="large-strong" asChild>
                <h1 className="lf-listing__title">{listing.title}</h1>
              </Typography.Title>
              <Flex gap={16} wrap="wrap" className="lf-listing__meta">
                {occurredAt && (
                  <Typography.Body variant="medium">Произошло: {occurredAt}</Typography.Body>
                )}
                {createdAt && (
                  <Typography.Body variant="medium">Добавлено: {createdAt}</Typography.Body>
                )}
              </Flex>
            </Flex>

            {listing.description && (
              <section className="lf-listing__section">
                <Typography.Title variant="small-strong" asChild>
                  <h2>Описание</h2>
                </Typography.Title>
                <Typography.Body variant="medium" className="lf-listing__text">
                  {listing.description}
                </Typography.Body>
              </section>
            )}

            {(listing.lat !== null || listing.lng !== null || listing.location_note) && (
              <section className="lf-listing__section">
                <Typography.Title variant="small-strong" asChild>
                  <h2>Локация</h2>
                </Typography.Title>
                <Grid cols={2} gap={16} className="lf-listing__grid">
                  <div>
                    <Typography.Label variant="medium-strong">Комментарий</Typography.Label>
                    <Typography.Body variant="medium" className="lf-listing__text">
                      {listing.location_note || 'Не указана'}
                    </Typography.Body>
                  </div>
                  {(listing.lat !== null || listing.lng !== null) && (
                    <div>
                      <Typography.Label variant="medium-strong">Координаты</Typography.Label>
                      <Typography.Body variant="medium" className="lf-listing__text">
                        {listing.lat?.toFixed?.(5) ?? '—'} / {listing.lng?.toFixed?.(5) ?? '—'}
                      </Typography.Body>
                      <Button
                        asChild
                        size="medium"
                        mode="secondary"
                        appearance="neutral-themed"
                        className="lf-listing__link"
                      >
                        <a
                          href={`https://yandex.ru/maps/?ll=${listing.lng},${listing.lat}&z=16`}
                          target="_blank"
                          rel="noopener"
                        >
                          Открыть в Яндекс.Картах
                        </a>
                      </Button>
                    </div>
                  )}
                </Grid>
              </section>
            )}

            {Array.isArray(listing.photos) && listing.photos.length > 0 && (
              <section className="lf-listing__section">
                <Typography.Title variant="small-strong" asChild>
                  <h2>Фото</h2>
                </Typography.Title>
                <div className="lf-photos">
                  {listing.photos.map((url, index) => (
                    <img key={index} src={url} alt={`Фото ${index + 1}`} loading="lazy" />
                  ))}
                </div>
              </section>
            )}

            <Panel mode="secondary" className="lf-callout">
              <Typography.Body variant="medium">
                Обращайтесь через чат-бота MAX, чтобы уточнить детали и пройти проверку владельца.
              </Typography.Body>
            </Panel>
          </Flex>
        </Panel>
      )}
    </section>
  )
}
