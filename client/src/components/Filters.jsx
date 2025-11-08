import { useState } from 'react';

export default function Filters({ onApply }) {
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');

  return (
    <div className="filters" style={{ padding: '16px', background: '#fff', marginBottom: '16px', borderRadius: '8px' }}>
      <h3 style={{ marginTop: 0 }}>Фильтры</h3>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <select value={type} onChange={e=>setType(e.target.value)} style={{ padding: '8px' }}>
          <option value="">Все</option>
          <option value="LOST">Потеряно</option>
          <option value="FOUND">Найдено</option>
        </select>
        <select value={category} onChange={e=>setCategory(e.target.value)} style={{ padding: '8px' }}>
          <option value="">Любая категория</option>
          <option value="keys">Ключи</option>
          <option value="phone">Телефон</option>
          <option value="wallet">Кошелёк</option>
          <option value="document">Документ</option>
          <option value="pet">Животное</option>
          <option value="bag">Сумка</option>
        </select>
        <button onClick={()=>onApply && onApply({type,category})} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          Применить
        </button>
      </div>
    </div>
  );
}
