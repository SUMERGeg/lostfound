import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { MaxUI } from '@maxhub/max-ui'
import AppLayout from './App.jsx'
import HomePage from './pages/Home.jsx'
import MapPage from './pages/Map.jsx'
import ListingPage from './pages/Listing.jsx'
import './styles/global.css'
import '@maxhub/max-ui/dist/styles.css'

const rootElement = document.getElementById('root')

createRoot(rootElement).render(
  <StrictMode>
    <MaxUI>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="map" element={<MapPage />} />
            <Route path="listing/:id" element={<ListingPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </MaxUI>
  </StrictMode>,
)
