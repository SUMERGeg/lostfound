export const CATEGORY_OPTIONS = [
  { id: 'pet', label: 'Животные', emoji: '🐾' },
  { id: 'electronics', label: 'Электроника', emoji: '📱' },
  { id: 'wear', label: 'Одежда и аксессуары', emoji: '👜' },
  { id: 'document', label: 'Документы', emoji: '📄' },
  { id: 'valuable', label: 'Ценности', emoji: '💍' },
  { id: 'keys', label: 'Ключи', emoji: '🔑' },
  { id: 'other', label: 'Другое', emoji: '❓' }
]

const CATEGORY_MAP = CATEGORY_OPTIONS.reduce((acc, option) => {
  acc[option.id] = option
  return acc
}, {})

const CATEGORY_ALIASES = {
  phone: 'electronics',
  gadget: 'electronics',
  bag: 'wear',
  clothes: 'wear',
  clothing: 'wear',
  wallet: 'valuable',
  valuables: 'valuable',
  jewelry: 'valuable',
  misc: 'other',
  unknown: 'other'
}

export function normalizeCategoryId(category) {
  if (!category) {
    return category
  }
  const lower = String(category).toLowerCase()
  return CATEGORY_ALIASES[lower] ?? lower
}

export function getCategoryMeta(category) {
  const normalized = normalizeCategoryId(category)
  return CATEGORY_MAP[normalized] ?? { id: normalized ?? 'other', label: 'Другое', emoji: '❓' }
}

export const TYPE_META = {
  LOST: { label: 'Потеряно', color: '#dc2626', tint: '#fee2e2' },
  FOUND: { label: 'Найдено', color: '#16a34a', tint: '#dcfce7' }
}

