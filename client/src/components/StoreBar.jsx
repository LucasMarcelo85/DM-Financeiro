import { useEffect, useState } from 'react';
import { api, getActiveStore, isShopMode, setActiveStore } from '../api.js';
import { useAuth } from '../auth.jsx';
import BuyMore from './BuyMore.jsx';
import { useToast } from './Toast.jsx';

// Escolhe a loja do painel (principal ou uma loja extra) e, com `manage`, cria e exclui lojas.
export default function StoreBar({ manage = false }) {
  const { user } = useAuth() || {};
  const toast = useToast();
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const active = getActiveStore();

  const load = () => api.get('/stores').then((r) => {
    setData(r);
    if (active && !r.stores.some((s) => String(s.id) === active)) { setActiveStore(null); window.location.reload(); }
  }).catch(() => setData({ stores: [], limit: 0 }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || (!data.limit && !data.stores.length) || isShopMode()) return null;

  const pick = (id) => { setActiveStore(id); window.location.reload(); };

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { store } = await api.post('/stores', { name });
      setName('');
      toast('Loja criada.');
      pick(store.id);
    } catch (e) { toast(e.message, 'error'); setBusy(false); }
  }

  async function remove() {
    const store = data.stores.find((s) => String(s.id) === active);
    if (!store || !window.confirm(`Excluir a loja "${store.name}" com todos os produtos, pedidos e páginas dela?`)) return;
    try { await api.del(`/stores/${store.id}`); toast('Loja excluída.'); pick(null); } catch (e) { toast(e.message, 'error'); }
  }

  const full = data.stores.length >= data.limit;
  return (
    <div className="banner" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <strong>Loja:</strong>
      <select className="input" style={{ maxWidth: 260 }} value={active || ''} onChange={(e) => pick(e.target.value || null)} aria-label="Loja ativa">
        <option value="">Loja principal</option>
        {data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {manage && active && <button className="btn btn-ghost btn-sm" onClick={remove}>Excluir esta loja</button>}
      {manage && !full && (
        <>
          <input className="input" style={{ maxWidth: 220 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da nova loja" maxLength={80} />
          <button className="btn btn-primary btn-sm" onClick={create} disabled={busy || !name.trim()}>Criar loja</button>
        </>
      )}
      {manage && full && <BuyMore resource="stores" label="Adquirir mais lojas" />}
      {manage && <span className="muted small">{user?.role === 'admin' ? `${data.stores.length} lojas (sem limite)` : `${data.stores.length} de ${data.limit} ${data.limit === 1 ? 'loja' : 'lojas'}`}</span>}
    </div>
  );
}
