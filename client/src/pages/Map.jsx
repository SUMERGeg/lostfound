import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
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
  const navigate = useNavigate()
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
        '<div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;color:#fff;background-color:$[properties.color];box-shadow:0 8px 20px rgba(15,23,42,0.25);">' +
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
                coordinates: [0, 0],
                radius: 20
              }
            }
          )

          placemark.events.add('click', () => navigate(`/listing/${item.id}`))
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
    <section className="map-wrapper">
      <header className="map-wrapper__header">
        <h1>Карта потерянных и найденных вещей</h1>
        <p>Нажмите на маркер, чтобы перейти к карточке объявления.</p>
      </header>
      {status.loading && <div className="map-wrapper__status">Загружаем точки...</div>}
      {status.error && <div className="map-wrapper__status map-wrapper__status--error">{status.error}</div>}
      <div id="map" className="map-wrapper__canvas" />
    </section>
  )
}
