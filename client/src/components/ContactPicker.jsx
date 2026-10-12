import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import { digits, formatStoredPhone, initials, maskPhone } from '../lib/format.js';

// Valor: { id, name, phone } (cliente já salvo) ou { id: null, name, phone } (cliente novo, salvo junto com o envio).
export const clientReady = (c) => Boolean(c && (c.id || (c.name.trim().length >= 2 && [10, 11].includes(digits(c.phone).length))));
export const clientPayload = (c) => (c.id ? { contactId: c.id } : { newContact: { name: c.name.trim(), phone: c.phone } });

export default function ContactPicker({ value, onChange }) {
  const [mode, setMode] = useState('search');
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (value?.id || mode !== 'search') return undefined;
    const t = setTimeout(() => {
      api.get(`/contacts?limit=6&q=${encodeURIComponent(q)}`).then((r) => { setResults(r.contacts); setTotal(r.total); }).catch(() => setResults([]));
    }, 220);
    return () => clearTimeout(t);
  }, [q, mode, value?.id]);

  if (value?.id) {
    return (
      <div className="picked">
        <span className="avatar">{initials(value.name)}</span>
        <div><strong>{value.name}</strong><span>{formatStoredPhone(value.phone)}</span></div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange(null); setQ(''); setMode('search'); }}>Trocar</button>
      </div>
    );
  }

  if (mode === 'new') {
    const c = value || { id: null, name: '', phone: '' };
    return (
      <div className="new-client">
        <div className="form-row">
          <label className="field"><span>Nome do cliente</span>
            <input className="input" value={c.name} onChange={(e) => onChange({ ...c, id: null, name: e.target.value })} autoFocus autoComplete="off" />
          </label>
          <label className="field"><span>WhatsApp</span>
            <input className="input" type="tel" inputMode="tel" value={c.phone} placeholder="(85) 99999-9999" onChange={(e) => onChange({ ...c, id: null, phone: maskPhone(e.target.value) })} autoComplete="off" />
          </label>
        </div>
        <small className="muted">O cliente fica salvo na sua lista para as próximas vezes.</small>
        <button type="button" className="link-btn" onClick={() => { onChange(null); setMode('search'); }}>← Voltar para a busca</button>
      </div>
    );
  }

  return (
    <div className="picker">
      <div className="search-box">
        <Icon name="search" size={18} />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente por nome ou telefone" aria-label="Buscar cliente" autoComplete="off" />
      </div>
      {results && results.length > 0 && (
        <ul className="picker-list">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onChange({ id: c.id, name: c.name, phone: c.phone })}>
                <span className="avatar avatar-sm">{initials(c.name)}</span>
                <strong>{c.name}</strong><span>{formatStoredPhone(c.phone)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results && results.length === 0 && <p className="muted small">{total === 0 ? 'Você ainda não tem clientes salvos.' : 'Nenhum cliente encontrado.'}</p>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange({ id: null, name: q.replace(/\d/g, '').trim(), phone: '' }); setMode('new'); }}>
        <Icon name="plus" size={16} /> Cadastrar novo cliente
      </button>
    </div>
  );
}
