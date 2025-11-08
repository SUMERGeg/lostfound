export function score(lost, found) {
  let s = 0;
  if (lost.category === found.category) s += 25;

  // время: чем ближе — тем выше (до 20)
  const dt = Math.abs(new Date(lost.occurred_at) - new Date(found.occurred_at));
  const hours = dt/3600000;
  s += Math.max(0, 20 - Math.min(20, Math.floor(hours/6)));

  // гео (очень грубо): <= 300м — 30, <= 1км — 20, <= 3км — 10
  const d = haversine(lost.lat, lost.lng, found.lat, found.lng);
  if (d <= 0.3) s += 30; else if (d <= 1) s += 20; else if (d <= 3) s += 10;

  // ключевые слова (упрощённо): title пересечения
  const inter = intersect(tokens(lost.title), tokens(found.title)).length;
  s += Math.min(25, inter*5);

  return s;
}
function tokens(t=''){ return t.toLowerCase().split(/[^a-zа-я0-9]+/i).filter(Boolean); }
function intersect(a,b){ const set = new Set(a); return b.filter(x=>set.has(x)); }
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = x=>x*Math.PI/180;
  const R=6371; // км
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
