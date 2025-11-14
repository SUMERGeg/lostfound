import { useMemo, useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { Button, Container, Flex, Panel, Typography } from '@maxhub/max-ui'
import Filters from './components/Filters.jsx'

const initialFilters = { type: '', category: '' }

const VK_DOBRO_URL = import.meta.env.VITE_VK_DOBRO_URL || 'https://dobro.mail.ru/projects/?recipient=animals'

export default function AppLayout() {
  const [filters, setFilters] = useState(initialFilters)
  const location = useLocation()

  const showFilters = location.pathname === '/' || location.pathname.startsWith('/map')

  const navigation = useMemo(
    () => [
      { to: '/', label: 'Лента', active: location.pathname === '/' },
      { to: '/map', label: 'Карта', active: location.pathname.startsWith('/map') }
    ],
    [location.pathname]
  )

  function handleApply(nextFilters) {
    setFilters(prev => ({ ...prev, ...nextFilters }))
  }

  return (
    <div className="lf-shell">
      <Panel mode="primary" className="lf-hero">
        <Container className="lf-hero__content">
          <Flex direction="column" gap={12}>
            <Typography.Title variant="large-strong">Lost&Found MAX</Typography.Title>
            <Typography.Body variant="medium" className="lf-hero__subtitle">
              Помогаем быстро найти потерянное и вернуть найденное. Смотрите обновления, отмечайте
              находки на карте и подключайтесь к поискам.
            </Typography.Body>
            <Flex gap={8} wrap="wrap">
              {navigation.map(item => (
                <Button
                  key={item.to}
                  asChild
                  size="large"
                  mode={item.active ? 'primary' : 'secondary'}
                  appearance={item.active ? 'themed' : 'neutral-themed'}
                  className={item.active ? 'lf-nav-btn lf-nav-btn--active' : 'lf-nav-btn'}
                >
                  <Link to={item.to}>{item.label}</Link>
                </Button>
              ))}
              <Button
                asChild
                size="large"
                mode="secondary"
                appearance="contrast-static"
                className="lf-nav-btn lf-nav-btn--support"
              >
                <a href={VK_DOBRO_URL} target="_blank" rel="noopener noreferrer">
                  ❤️ Поддержать хвостатых
                </a>
              </Button>
            </Flex>
          </Flex>
        </Container>
      </Panel>

      <Container className="lf-content" fullWidth>
        <main className="lf-main">
          {showFilters && <Filters value={filters} onApply={handleApply} />}
          <Outlet context={{ filters }} />
        </main>
      </Container>
    </div>
  )
}

