import { useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Container } from './components/ui.jsx'
import Filters from './components/Filters.jsx'
import { useAuth } from './auth/AuthContext.jsx'
import { isPrivacyEmailConfigured, usePrivacyEmail } from './privacyConfig.js'
import { isDemo, isDemoPath } from './demo.js'

const initialFilters = { type: '', category: '' }

function Brand() {
  return (
    <Link to="/ads" className="lf-brand" aria-label="Lost&Found — на главную">
      <span className="lf-brand__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="img">
          <path d="M16 28s10-7.1 10-16A10 10 0 0 0 6 12c0 8.9 10 16 10 16Z" />
          <circle cx="16" cy="12" r="4" />
        </svg>
      </span>
      <span className="lf-brand__text">Lost<span>&</span>Found</span>
    </Link>
  )
}

export default function AppLayout() {
  const [filters, setFilters] = useState(initialFilters)
  const location = useLocation()
  const { user, logout } = useAuth()
  const privacyEmail = usePrivacyEmail()
  const isFeed = location.pathname === '/' || location.pathname === '/ads'
  const isMap = location.pathname.startsWith('/map')
  const isDiscovery = isFeed || isMap

  if (isDemo && !isDemoPath(location.pathname)) return <Navigate to="/ads" replace />

  function isActive(path) {
    if (path === '/ads') return location.pathname === '/' || location.pathname.startsWith('/ads')
    return location.pathname.startsWith(path)
  }

  function handleApply(nextFilters) {
    setFilters(previous => ({ ...previous, ...nextFilters }))
  }

  return (
    <div className="lf-shell">
      {isDemo && <aside className="lf-demo-banner" role="note">Демонстрационная версия · вымышленные объявления · публикация и регистрация отключены</aside>}
      <header className={`lf-header${isMap ? ' lf-header--map' : ''}${!isDiscovery ? ' lf-header--compact' : ''}`}>
        <Container className="lf-header__container">
          <div className="lf-topbar">
            <Brand />

            <nav className="lf-primary-nav" aria-label="Основная навигация">
              <Link className={isActive('/ads') ? 'is-active' : ''} to="/ads">Лента</Link>
              <Link className={isActive('/map') ? 'is-active' : ''} to="/map">Карта</Link>
            </nav>

            <nav className="lf-account-nav" aria-label="Личный кабинет">
              {isDemo ? <span className="lf-demo-badge">Только просмотр</span> : user ? (
                <>
                  <Link className={isActive('/matches') ? 'is-active' : ''} to="/matches">Совпадения</Link>
                  <Link className={isActive('/owner-checks') ? 'is-active' : ''} to="/owner-checks">Проверки</Link>
                  <Link className={isActive('/notifications') ? 'is-active' : ''} to="/notifications" aria-label="Уведомления">Уведомления</Link>
                  {user.role === 'ADMIN' && <Link className={isActive('/admin') ? 'is-active' : ''} to="/admin">Модерация</Link>}
                  <Link className="lf-profile-link" to="/profile">{user.displayName?.slice(0, 1)?.toUpperCase() || 'Я'}</Link>
                  <button className="lf-logout" type="button" onClick={logout}>Выйти</button>
                </>
              ) : (
                <Link className="lf-login-link" to="/login">Войти</Link>
              )}
            </nav>
          </div>

          {isFeed && (
            <div className="lf-hero">
              <div className="lf-hero__copy">
                <p className="lf-eyebrow"><span /> Городской сервис взаимопомощи</p>
                <h1>Потерялось?<br /><em>Найдётся.</em></h1>
                <p className="lf-hero__subtitle">
                  {isDemo ? 'Посмотрите, как люди смогут находить потерянное и возвращать важное. Изучите примеры объявлений и точки на демонстрационной схеме города.' : 'Люди рядом уже помогают друг другу возвращать важные вещи. Создайте объявление — умный поиск подберёт возможные совпадения.'}
                </p>
                <div className="lf-hero__actions">
                  {isDemo ? (
                    <button className="lf-action lf-action--lost" type="button" onClick={() => document.getElementById('demo-feed')?.scrollIntoView({ behavior: 'smooth' })}>
                      <span aria-hidden="true">↗</span> Смотреть объявления
                    </button>
                  ) : (
                    <Link className="lf-action lf-action--lost" to="/create/lost">
                      <span aria-hidden="true">↗</span> Я потерял
                    </Link>
                  )}
                  <Link className="lf-action lf-action--found" to={isDemo ? '/map' : '/create/found'}>
                    <span aria-hidden="true">{isDemo ? '⌖' : '＋'}</span> {isDemo ? 'На карту' : 'Я нашёл'}
                  </Link>
                </div>
              </div>

              <div className="lf-hero__visual" aria-label="Как работает сервис">
                <div className="lf-orbit lf-orbit--one" />
                <div className="lf-orbit lf-orbit--two" />
                <div className="lf-hero-card lf-hero-card--main">
                  <span className="lf-hero-card__icon">⌖</span>
                  <div><strong>Совпадение найдено</strong><small>Лужники · 300 метров</small></div>
                  <b>86%</b>
                </div>
                <div className="lf-hero-card lf-hero-card--trust">
                  <span>✓</span><div><strong>Безопасная передача</strong><small>Контакты после проверки</small></div>
                </div>
                <div className="lf-hero__pulse"><span>5</span><small>активных<br />объявлений</small></div>
              </div>
            </div>
          )}

          {isMap && (
            <div className="lf-map-hero">
              <div className="lf-map-hero__copy">
                <p className="lf-eyebrow"><span /> Поиск рядом с вами</p>
                <h1>Город.<br /><em>Точки. Находки.</em></h1>
                <p>{isDemo ? 'Исследуйте примеры на условной схеме Москвы: зелёные точки — найденные вещи, красные — потерянные.' : 'Исследуйте объявления по районам: зелёные точки — найденные вещи, красные — потерянные.'}</p>
                <div className="lf-map-hero__legend" aria-label="Легенда карты">
                  <span><i className="is-lost" /> Потеряно</span>
                  <span><i className="is-found" /> Найдено</span>
                </div>
              </div>
              <div className="lf-map-hero__visual" aria-hidden="true">
                <svg viewBox="0 0 460 250">
                  <path d="M-8 54C75 31 114 102 193 78s107-4 146 29 87 21 132-5" />
                  <path d="M30 234c36-52 20-101 74-129s106 1 149-38S325 8 374-9" />
                  <path d="M-12 167c57-18 91-2 132 25s91 23 128-14 102-42 224-16" />
                  <path d="M82-12c2 50 35 72 30 116s-42 68-31 147" />
                  <path d="M319-8c-6 50-37 71-26 113s57 66 47 146" />
                </svg>
                <span className="lf-map-pin lf-map-pin--lost"><b>!</b></span>
                <span className="lf-map-pin lf-map-pin--found"><b>✓</b></span>
                <span className="lf-map-pin lf-map-pin--small"><b>⌖</b></span>
              </div>
            </div>
          )}
        </Container>
      </header>

      <Container className="lf-content" fullWidth>
        <main className="lf-main">
          {isDiscovery && <Filters value={filters} onApply={handleApply} context={isMap ? 'map' : 'feed'} />}
          <Outlet context={{ filters }} />
        </main>
      </Container>

      <footer className="lf-footer">
        <Container className="lf-footer__inner">
          <div className="lf-footer__identity">
            <Brand />
            <p>Возвращаем важное вместе — бережно и безопасно.</p>
          </div>
          <nav className="lf-footer__links" aria-label="Документы сервиса">
            <strong>Документы</strong>
            <Link to="/privacy">Конфиденциальность</Link>
            {!isDemo && <Link to="/privacy-request">Запрос по персональным данным</Link>}
            <Link to="/terms">Соглашение</Link>
            <Link to="/personal-data-consent">Согласие на обработку данных</Link>
            <Link to="/publication-rules">Правила публикации</Link>
          </nav>
          <div className="lf-footer__meta">
            <span>© {new Date().getFullYear()} Lost&amp;Found</span>
            {isDemo ? <small>Витрина проекта · без приёма заявок</small> : <>
              {isPrivacyEmailConfigured(privacyEmail) ? <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a> : <small>{privacyEmail}</small>}
              <small>Оператор: [OPERATOR_NAME]</small>
            </>}
          </div>
        </Container>
      </footer>
    </div>
  )
}
