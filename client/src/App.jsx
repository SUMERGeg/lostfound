import { Outlet, Link } from 'react-router-dom'
import Filters from './components/Filters.jsx'

export default function AppLayout() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '16px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        <nav style={{ display: 'flex', gap: '12px' }}>
          <Link to="/">Лента</Link>
          <Link to="/map">Карта</Link>
        </nav>
      </header>
      <main style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Filters />
        <Outlet />
      </main>
    </div>
  )
}

