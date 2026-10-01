import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { apiRequest } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { Button, Panel } from '../components/ui.jsx'

const feedbackOptions = [
  ['CONFIRMED', 'Это моя вещь'],
  ['SIMILAR_NOT_MINE', 'Похоже, но не моя'],
  ['NOT_RELEVANT', 'Не подходит']
]

export default function MatchesPage() {
  const { user, ready } = useAuth()
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const response = await apiRequest('/api/v1/matches?limit=100')
      if (!response.ok) throw new Error('Не удалось загрузить совпадения')
      setMatches(await response.json())
      setError('')
    } catch (error) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  if (ready && !user) return <Navigate to="/login" state={{ from: '/matches' }} replace />
  if (!ready || loading) return <Panel className="lf-state">Загружаем потенциальные совпадения…</Panel>

  async function setFeedback(matchId, feedback) {
    const response = await apiRequest(`/api/v1/matches/${matchId}/feedback`, {
      method: 'PUT',
      body: JSON.stringify({ feedback })
    })
    if (!response.ok) return setError('Не удалось сохранить оценку совпадения')
    setMatches(current => current.map(item => item.id === matchId ? { ...item, feedback } : item))
  }

  return <section className="lf-my-ads lf-matches">
    <div className="lf-my-ads__heading"><div><h1>Потенциальные совпадения</h1><p>Оценка учитывает категорию, время, расстояние и общие слова.</p></div></div>
    {error && <Panel className="lf-state lf-state--error">{error}</Panel>}
    {matches.length === 0 && <Panel className="lf-state">Подходящих активных пар пока нет. Пересчёт выполняется каждые 10 минут.</Panel>}
    {matches.map(match => <Panel key={match.id} className="lf-match">
      <header className="lf-match__header"><strong className="lf-match__score">{match.score}%</strong><span>Алгоритм {match.algorithmVersion}</span></header>
      <div className="lf-match__pair">
        <MatchSide label="Потеряно" item={match.lost} owned={match.ownsLost} />
        <span className="lf-match__arrow" aria-hidden="true">↔</span>
        <MatchSide label="Найдено" item={match.found} owned={match.ownsFound} />
      </div>
      <ScoreBreakdown breakdown={match.scoreBreakdown} />
      <div className="lf-match__feedback" aria-label="Оценка совпадения">
        {feedbackOptions.map(([value, label]) => <Button key={value} mode={match.feedback === value ? 'primary' : 'secondary'} onClick={() => setFeedback(match.id, value)}>{label}</Button>)}
        {match.feedback === 'CONFIRMED' && match.ownsLost && <Button asChild mode="primary"><Link to={`/ads/${match.found.id}/claim`}>Пройти проверку владельца</Link></Button>}
      </div>
    </Panel>)}
  </section>
}

function MatchSide({ label, item, owned }) {
  return <article className="lf-match__side">
    {item.photo ? <img src={item.photo} alt="" /> : <div className="lf-match__placeholder" aria-hidden="true">📦</div>}
    <div><small>{label}{owned ? ' · ваше объявление' : ''}</small><h2>{item.title}</h2><Button asChild mode="secondary"><Link to={`/ads/${item.id}`}>Открыть объявление</Link></Button></div>
  </article>
}

function ScoreBreakdown({ breakdown }) {
  if (!breakdown) return null
  const items = [['Категория', breakdown.category], ['Время', breakdown.time], ['Расстояние', breakdown.geo], ['Текст', breakdown.text]]
  return <div className="lf-match__breakdown">{items.map(([label, component]) => <div key={label}><span>{label}</span><strong>{component?.score ?? 0}/{component?.maximum ?? 0}</strong></div>)}</div>
}
