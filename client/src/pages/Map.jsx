import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel, Typography } from '../components/ui.jsx'
import { useOutletContext } from 'react-router-dom'
import { getCategoryMeta, TYPE_META } from '../utils/categories.js'
import { apiRequest } from '../api.js'

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
  const filterType = filters.type
  const filterCategory = filters.category
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const [status, setStatus] = useState({ loading: false, error: null })

  const ensureMarkerLayout = useCallback(() => {
    const ymaps = window.ymaps
    if (!markerLayoutRef.current && ymaps) {
      markerLayoutRef.current = ymaps.templateLayoutFactory.createClass(
        '<div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;color:#fff;background-color:$[properties.color];box-shadow:0 8px 20px rgba(15,23,42,0.25);cursor:pointer;transform:translateZ(0);">' +
          '$[properties.emoji]' +
          '</div>'
      )
    }
    return markerLayoutRef.current
  }, [])

  const loadPoints = useCallback(async activeFilters => {
    setStatus({ loading: true, error: null })
    requestIdRef.current += 1
    const requestId = requestIdRef.current

    try {
      const params = new URLSearchParams({ limit: 200 })
      if (activeFilters.type) params.set('type', activeFilters.type)
      if (activeFilters.category) params.set('category', activeFilters.category)

      const response = await apiRequest(`/api/v1/ads?${params.toString()}`)
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

      const ymaps = window.ymaps
      if (!ymaps) {
        throw new Error('Yandex Maps API недоступен')
      }

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
              balloonContent: `<strong>${escapeHtml(item.title)}</strong><br/>${escapeHtml(meta.label)}<br/><a href="${origin}/ads/${item.id}" target="_blank" rel="noopener">Открыть карточку</a>`
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
  }, [ensureMarkerLayout])

  useEffect(() => {
    const ymaps = window.ymaps
    if (!ymaps) {
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
      loadPoints(filtersRef.current)
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
  }, [loadPoints])

  useEffect(() => {
    if (!mapRef.current) {
      return
    }
    loadPoints({ type: filterType, category: filterCategory })
  }, [filterType, filterCategory, loadPoints])

  return (
    <section className="lf-section lf-map-section" aria-label="Карта потерянных и найденных вещей">
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
