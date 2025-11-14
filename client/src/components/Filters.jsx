import { useEffect, useState } from 'react'
import { Button, Flex, Panel, Typography } from '@maxhub/max-ui'
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
    <Panel mode="secondary" className="lf-filters">
      <Flex direction="column" gap={12}>
        <Typography.Label variant="medium-strong">Подбор объявлений</Typography.Label>
        <Flex gap={12} wrap="wrap" className="lf-filters__row">
          <label className="lf-select">
            <span>Тип</span>
            <select value={filters.type} onChange={event => handleChange('type', event.target.value)}>
              <option value="">Все</option>
              <option value="LOST">Потеряно</option>
              <option value="FOUND">Найдено</option>
            </select>
          </label>
          <label className="lf-select">
            <span>Категория</span>
            <select
              value={filters.category}
              onChange={event => handleChange('category', event.target.value)}
            >
              <option value="">Любая категория</option>
              {CATEGORY_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
