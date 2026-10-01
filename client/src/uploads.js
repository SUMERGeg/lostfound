import { apiRequest } from './api.js'

export async function uploadImages(files) {
  const selected = Array.from(files ?? [])
  if (selected.length > 3) throw new Error('Можно загрузить не более трёх изображений')

  const uploads = []
  for (const file of selected) {
    if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name}: размер больше 8 МБ`)
    const form = new FormData()
    form.append('image', file)
    const response = await apiRequest('/api/v1/uploads', { method: 'POST', body: form })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || `Не удалось загрузить ${file.name}`)
    uploads.push(data)
  }
  return uploads
}

export async function attachImages(listingId, uploads) {
  const response = await apiRequest(`/api/v1/ads/${listingId}/images`, {
    method: 'PUT',
    body: JSON.stringify({ uploadIds: uploads.map(upload => upload.id) })
  })
  const data = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(data?.message || 'Не удалось прикрепить изображения')
}
