import { useEffect, useRef, useState } from 'react';
import Filters from '../components/Filters.jsx';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

export default function MapPage() {
  const mapRef = useRef(null);
  const [listings, setListings] = useState([]);

  useEffect(() => {
    if (typeof ymaps === 'undefined') {
      console.error('Yandex Maps API не загружен');
      return;
    }
    ymaps.ready(() => {
      const map = new ymaps.Map('map', { center: [55.751244, 37.618423], zoom: 11 });
      mapRef.current = map;
      loadPoints();
    });
  }, []);

  async function loadPoints(filters={}) {
    const qs = new URLSearchParams({ limit: 200, ...filters });
    const r = await fetch(`${API_BASE}/listings?`+qs.toString());
    const data = await r.json();
    setListings(data);
    const map = mapRef.current;
    if (!map) return;
    const points = data.map(l => {
      const pm = new ymaps.Placemark([l.lat, l.lng], {
        balloonContent: `<strong>${l.title}</strong><br/>${l.category}<br/>
        <a href="/#/listing/${l.id}">Открыть</a>`
      });
      return pm;
    });
    const clusterer = new ymaps.Clusterer();
    clusterer.add(points);
    map.geoObjects.removeAll();
    map.geoObjects.add(clusterer);
  }

  return (
    <>
      <Filters onApply={(f)=>loadPoints(f)} />
      <div id="map" style={{width:'100%', height:'calc(100vh - 200px)'}}/>
    </>
  );
}
