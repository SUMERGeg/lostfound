import { useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import Filters from './components/Filters.jsx'

const initialFilters = { type: '', category: '' }

export default function AppLayout() {
  const [filters, setFilters] = useState(initialFilters)
  const location = useLocation()

  const showFilters = location.pathname === '/' || location.pathname.startsWith('/map')

  function handleApply(nextFilters) {
    setFilters(prev => ({ ...prev, ...nextFilters }))
  }

  return (
    <div className="layout">
      <header className="layout__header">
        <nav className="layout__nav">
          <Link to="/">Лента</Link>
          <Link to="/map">Карта</Link>
        </nav>
      </header>
      <main className="layout__main">
        {showFilters && <Filters value={filters} onApply={handleApply} />}
        <Outlet context={{ filters }} />
      </main>
    </div>
  )
}

