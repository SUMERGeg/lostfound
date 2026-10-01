const CHANNELS = [
  { id: 'EMAIL', field: 'email', label: 'Email' },
  { id: 'PHONE', field: 'phone', label: 'Телефон' },
  { id: 'TELEGRAM', field: 'telegram', label: 'Telegram' },
]

export default function ContactDisclosureFields({ profile, value, onChange }) {
  const selected = new Set(value)

  function toggle(channel, checked) {
    const next = new Set(value)
    if (checked) next.add(channel)
    else next.delete(channel)
    onChange([...next])
  }

  return (
    <fieldset className="lf-consents lf-disclosure-settings">
      <legend>Какие контакты показать подтверждённому владельцу?</legend>
      {CHANNELS.map(channel => {
        const available = Boolean(profile?.[channel.field])
        return (
          <label className="lf-consent" key={channel.id}>
            <input
              type="checkbox"
              checked={selected.has(channel.id)}
              disabled={!available}
              onChange={event => toggle(channel.id, event.target.checked)}
            />
            <span>{channel.label}{available ? ` · ${profile[channel.field]}` : ' · не указан в профиле'}</span>
          </label>
        )
      })}
      <p>Выберите минимум один доступный канал. В публичном объявлении эти значения не появятся.</p>
    </fieldset>
  )
}
