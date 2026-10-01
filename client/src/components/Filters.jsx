import { useEffect, useState } from 'react'
import { Button, Flex, Panel, Select, Typography } from './ui.jsx'
import { CATEGORY_OPTIONS } from '../utils/categories.js'

const initialFilters = { type: '', category: '' }

export default function Filters({ value = initialFilters, onApply, context = 'feed' }) {
  const [filters, setFilters] = useState({ ...initialFilters, ...value })
  const valueType = value.type
  const valueCategory = value.category

  useEffect(() => {
    setFilters(prev => ({ ...prev, type: valueType, category: valueCategory }))
  }, [valueType, valueCategory])

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
    <Panel mode="secondary" className={`lf-filters${context === 'map' ? ' lf-filters--map' : ''}`}>
      <Flex direction="column" gap={12}>
        <Typography.Label variant="medium-strong">{context === 'map' ? 'Фильтр точек на карте' : 'Подбор объявлений'}</Typography.Label>
        <Flex gap={12} wrap="wrap" className="lf-filters__row">
          <div className="lf-select">
            <span>Тип</span>
            <Select
              ariaLabel="Тип объявления"
              value={filters.type}
              onChange={nextValue => handleChange('type', nextValue)}
              options={[["", 'Все объявления'], ['LOST', 'Потеряно'], ['FOUND', 'Найдено']]}
            />
          </div>
          <div className="lf-select">
            <span>Категория</span>
            <Select
              ariaLabel="Категория объявления"
              value={filters.category}
              onChange={nextValue => handleChange('category', nextValue)}
              options={[
                { value: '', label: 'Любая категория' },
                ...CATEGORY_OPTIONS.map(option => ({ value: option.id, label: `${option.emoji} ${option.label}` }))
              ]}
            />
          </div>
          <Flex direction="column" justify="end" className="lf-filters__actions-wrapper">
            <Flex gap={8} className="lf-filters__actions">
              <Button size="medium" mode="primary" appearance="themed" onClick={handleApply}>
                Применить
              </Button>
              <Button
                size="medium"
                mode="secondary"
                appearance="neutral-themed"
                onClick={handleReset}
              >
                Сбросить
              </Button>
            </Flex>
          </Flex>
        </Flex>
      </Flex>
    </Panel>
  )
}
