import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { getDemoListings } from '../demo.js'
import { getCategoryMeta, TYPE_META } from '../utils/categories.js'

export default function DemoMap() {
  const { filters = {} } = useOutletContext() ?? {}
  const items = getDemoListings(filters)
  const [selectedId, setSelectedId] = useState(null)
  const selected = items.find(item => item.id === selectedId) ?? items[0]

  return (
    <section className="lf-section lf-map-section" aria-label="Демонстрационная схема города">
      <div className="lf-demo-map-heading">
        <div><p className="lf-eyebrow lf-eyebrow--dark">Исследуйте город</p><h2>Находки на карте</h2></div>
        <span>{items.length} точек · условная схема Москвы</span>
      </div>
      <div className="lf-demo-map-layout">
        <div className="lf-demo-map" aria-label="Выберите точку для просмотра объявления">
          <svg viewBox="0 0 800 560" preserveAspectRatio="none" aria-hidden="true">
            <defs><pattern id="demo-blocks" width="100" height="80" patternUnits="userSpaceOnUse"><rect x="12" y="12" width="70" height="50" rx="12" fill="#dde7d7" /></pattern></defs>
            <rect width="800" height="560" fill="#edf1e6" />
            <rect width="800" height="560" fill="url(#demo-blocks)" />
            <path d="M-30 270C100 470 220 140 360 315S540 500 840 270" fill="none" stroke="#bddad6" strokeWidth="45" />
            <g fill="none" stroke="#fffef9" strokeWidth="14">
              <ellipse cx="440" cy="255" rx="240" ry="175" />
              <path d="M-20 140L820 450M160-20L640 580M-20 500L820 30M430-20L330 580" />
            </g>
            <g fill="#667e69" fontSize="16" fontFamily="system-ui, sans-serif">
              <text x="140" y="65">Ходынское поле</text><text x="500" y="200">Центр</text>
              <text x="215" y="280">Хамовники</text><text x="535" y="440">Парк Горького</text>
              <text x="60" y="465">Лужники</text>
            </g>
          </svg>
          {items.map(item => (
            <button key={item.id} className={`lf-demo-map-pin${item.id === selected?.id ? ' is-selected' : ''}`}
              style={{ left: `${item.mapPosition[0]}%`, top: `${item.mapPosition[1]}%`, background: item.type === 'LOST' ? 'var(--lost)' : '#16a34a' }}
              type="button" aria-label={`${TYPE_META[item.type].label}: ${item.title}`} aria-pressed={item.id === selected?.id}
              onClick={() => setSelectedId(item.id)}>
              {getCategoryMeta(item.category).emoji}
            </button>
          ))}
          <span className="lf-demo-map-caption">Демо-схема · не для навигации</span>
        </div>
        <div className="lf-demo-map-details" aria-live="polite">
          {selected ? <>
            <img src={selected.preview_photo} alt={selected.title} />
            <div className="lf-demo-map-details__body">
              <span className="lf-card__badge" style={{ background: TYPE_META[selected.type].tint, color: TYPE_META[selected.type].color }}>{TYPE_META[selected.type].label}</span>
              <h3>{selected.title}</h3><p>{selected.location_note}</p>
              <Link className="ui-button ui-button--primary" to={`/ads/${selected.id}`}>Открыть объявление →</Link>
              <small>Нажмите на другую точку, чтобы посмотреть находку.</small>
            </div>
          </> : <div className="lf-demo-map-details__body"><h3>Точек пока нет</h3><p>По выбранным фильтрам ничего не найдено. Попробуйте другую категорию.</p></div>}
        </div>
      </div>
    </section>
  )
}
