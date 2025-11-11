import { useEffect, useState } from 'react'
import { CATEGORY_OPTIONS } from '../utils/categories.js'

const initialFilters = { type: '', category: '' }

export default function Filters({ value = initialFilters, onApply }) {
  const [filters, setFilters] = useState({ ...initialFilters, ...value })

  useEffect(() => {
    setFilters(prev => ({ ...prev, ...value }))
  }, [value.type, value.category])

  function handleChange(field, nextValue) {
    setFilters(current => ({ ...current, [field]: nextValue }))
  }

  function handleApply() {
    onApply?.(filters)
  }

  function handleReset() {
    setFilters(initialFilters)
    onApply?.(initialFilters)
  }

  return (
    <div className="filters">
      <div className="filters__row">
        <label className="filters__field">
          <span>Тип</span>
          <select value={filters.type} onChange={event => handleChange('type', event.target.value)}>
            <option value="">Все</option>
            <option value="LOST">Потеряно</option>
            <option value="FOUND">Найдено</option>
          </select>
        </label>
        <label className="filters__field">
          <span>Категория</span>
          <select value={filters.category} onChange={event => handleChange('category', event.target.value)}>
            <option value="">Любая категория</option>
            {CATEGORY_OPTIONS.map(option => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="filters__actions">
          <button type="button" onClick={handleApply}>
            Применить
          </button>
          <button type="button" className="secondary" onClick={handleReset}>
            Сбросить
          </button>
        </div>
      </div>
    </div>
  )
}
