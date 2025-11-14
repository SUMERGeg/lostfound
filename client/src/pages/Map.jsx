import { useEffect, useRef, useState } from 'react'
import { Flex, Panel, Typography } from '@maxhub/max-ui'
import { useOutletContext } from 'react-router-dom'
import { getCategoryMeta, TYPE_META } from '../utils/categories.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080'
const initialFilters = { type: '', category: '' }

function escapeHtml(input = '') {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default function MapPage() {
  const mapRef = useRef(null)
  const clustererRef = useRef(null)
  const markerLayoutRef = useRef(null)
  const requestIdRef = useRef(0)
  const outletContext = useOutletContext() ?? { filters: initialFilters }
  const filters = outletContext.filters ?? initialFilters
  const [status, setStatus] = useState({ loading: false, error: null })

  useEffect(() => {
    if (typeof ymaps === 'undefined') {
      console.error('Yandex Maps API не загружен')
      setStatus({ loading: false, error: 'Yandex Maps API не загрузился. Проверьте ключ.' })
      return
    }

    let destroyed = false
    ymaps.ready(() => {
      if (destroyed) return

      const map = new ymaps.Map('map', {
        center: [55.751244, 37.618423],
        zoom: 11,
        controls: ['zoomControl', 'geolocationControl']
      })
      const clusterer = new ymaps.Clusterer({
        groupByCoordinates: false,
        clusterDisableClickZoom: false,
        clusterOpenBalloonOnClick: false
      })
      map.geoObjects.add(clusterer)
      mapRef.current = map
      clustererRef.current = clusterer
      loadPoints(filters)
    })

    return () => {
      destroyed = true
      if (mapRef.current) {
        mapRef.current.destroy()
        mapRef.current = null
      }
      clustererRef.current = null
      markerLayoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current) {
      return
    }
    loadPoints(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.type, filters.category])

  function ensureMarkerLayout() {
    if (!markerLayoutRef.current && typeof ymaps !== 'undefined') {
      markerLayoutRef.current = ymaps.templateLayoutFactory.createClass(
        '<div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;color:#fff;background-color:$[properties.color];box-shadow:0 8px 20px rgba(15,23,42,0.25);cursor:pointer;transform:translateZ(0);">' +
          '$[properties.emoji]' +
          '</div>'
      )
    }
    return markerLayoutRef.current
  }

  async function loadPoints(activeFilters) {
    setStatus({ loading: true, error: null })
    requestIdRef.current += 1
    const requestId = requestIdRef.current

    try {
      const params = new URLSearchParams({ limit: 200 })
      if (activeFilters.type) params.set('type', activeFilters.type)
      if (activeFilters.category) params.set('category', activeFilters.category)

      const response = await fetch(`${API_BASE}/listings?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Ошибка загрузки: ${response.status}`)
      }

      const data = await response.json()
      if (requestId !== requestIdRef.current) {
        return
      }

      const map = mapRef.current
      const clusterer = clustererRef.current
      if (!map || !clusterer) {
        return
      }

      clusterer.removeAll()
      const markerLayout = ensureMarkerLayout()
      const origin = window.location.origin

      const placemarks = (Array.isArray(data) ? data : [])
        .filter(item => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)))
        .map(item => {
          const meta = getCategoryMeta(item.category)
          const typeMeta = TYPE_META[item.type] ?? { label: item.type, color: '#334155' }
          const placemark = new ymaps.Placemark(
            [Number(item.lat), Number(item.lng)],
            {
              emoji: meta.emoji,
              color: typeMeta.color,
              hintContent: `${typeMeta.label} · ${meta.label}`,
              balloonContent: `<strong>${escapeHtml(item.title)}</strong><br/>${escapeHtml(meta.label)}<br/><a href="${origin}/listing/${item.id}" target="_blank" rel="noopener">Открыть карточку</a>`
            },
            {
              iconLayout: markerLayout,
              iconOffset: [-20, -20],
              iconShape: {
                type: 'Circle',
                coordinates: [20, 20],
                radius: 20
              },
              hideIconOnBalloonOpen: false
            }
          )

          placemark.events.add('click', event => {
            const domEvent = event.get('domEvent')
            if (domEvent) {
              domEvent.preventDefault()
              domEvent.stopPropagation()
            }
            if (!placemark.balloon.isOpen()) {
              placemark.balloon.open()
            }
          })

          return placemark
        })

      clusterer.add(placemarks)
      setStatus({ loading: false, error: null })
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return
      }
      console.error('[Map] Ошибка загрузки точек', error)
      setStatus({ loading: false, error: 'Не удалось загрузить точки. Попробуйте обновить страницу.' })
    }
  }

  return (
    <section className="lf-section">
      <Panel mode="secondary" className="lf-section__panel">
        <Flex direction="column" gap={6}>
          <Typography.Title variant="medium-strong">Карта потерянных и найденных</Typography.Title>
          <Typography.Body variant="medium" className="lf-section__subtitle">
            Маркеры окрашены по типу объявления, нажмите чтобы увидеть карточку и перейти к полному описанию.
          </Typography.Body>
        </Flex>
      </Panel>

      {status.loading && (
        <Panel mode="secondary" className="lf-state">
          <Typography.Body variant="medium">Загружаем точки...</Typography.Body>
        </Panel>
      )}
      {status.error && (
        <Panel mode="secondary" className="lf-state lf-state--error">
          <Typography.Body variant="medium">{status.error}</Typography.Body>
        </Panel>
      )}

      <Panel mode="primary" className="lf-map">
        <div id="map" className="lf-map__canvas" />
      </Panel>
    </section>
  )
}
