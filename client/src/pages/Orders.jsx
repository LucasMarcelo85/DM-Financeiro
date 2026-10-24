import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import CatalogSettings from '../components/CatalogSettings.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { brl, dateTimeBR, formatStoredPhone, plural } from '../lib/format.js';

// Pedidos feitos no catálogo digital. Ficam guardados por 10 dias e depois são apagados sozinhos.
const DAY = 86400000;
const TYPE = { excursao: 'Excursão', motoboy: 'Motoboy', correios: 'Correios' };

function deliveryText(o) {
  const d = o.delivery || {};
  if (o.deliveryType === 'excursao') return `Galpão ${d.warehouse} · ${d.address}, ${d.city}`;
  const addr = [d.street, d.number, d.district, d.city && `${d.city}${d.state ? `/${d.state}` : ''}`].filter(Boolean).join(', ');
  if (o.deliveryType === 'motoboy') return `${addr || 'Endereço não informado'}${d.zip ? ` · CEP ${d.zip}` : ''}${d.km ? ` · ${String(d.km).replace('.', ',')} km${d.approx ? ' (aprox.)' : ''}` : ''}`;
  return `${d.service || 'Correios'} · CEP ${d.zip}${d.days ? ` · prazo até ${d.days.max} dias` : ''}${addr ? ` · ${addr}` : ''}`;
}

export default function Orders() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState(new Set());
  const [confirm, setConfirm] = useState(null); // { ids } | { all }
  const [settings, setSettings] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (status) qs.set('status', status);
    return api.get(`/catalog/orders?${qs}`).then((r) => alive.current && setData(r)).catch((e) => toast(e.message, 'error'));
  }, [q, status, toast]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]); // pedidos novos aparecem sozinhos

  const toggleSel = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function setDone(o) {
    try { await api.patch(`/catalog/orders/${o.id}`, { status: o.status === 'novo' ? 'atendido' : 'novo' }); load(); } catch (e) { toast(e.message, 'error'); }
  }
  async function doDelete(c) {
    setConfirm(null);
    try {
      const r = await api.post('/catalog/orders/bulk-delete', c.all ? { all: true } : { ids: c.ids });
      toast(`${plural(r.removed, 'pedido excluído', 'pedidos excluídos')}.`);
      setSel(new Set());
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <>
      <header className="page-head head-row">
        <div>
          <h1>Pedidos</h1>
          <p className="muted">Pedidos feitos no seu catálogo digital. Quem pede já fica salvo na aba Clientes. <strong>Os pedidos são apagados automaticamente depois de {data?.retentionDays || 10} dias.</strong></p>
        </div>
        <button className="btn btn-ghost" onClick={() => setSettings(true)}><Icon name="gear" size={18} /> Entregas e frete</button>
      </header>

      {data && (
        <div className="od-bar">
          <input className="input" type="search" placeholder="Buscar por nome, telefone ou código" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar pedidos" />
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
            <option value="">Todos ({data.total})</option>
            <option value="novo">Novos ({data.fresh})</option>
            <option value="atendido">Atendidos</option>
          </select>
          {sel.size > 0 && <button className="btn btn-danger btn-sm" onClick={() => setConfirm({ ids: [...sel] })}>Excluir {plural(sel.size, 'selecionado', 'selecionados')}</button>}
          {data.total > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ all: true })}>Excluir todos</button>}
        </div>
      )}

      {data === null ? <p className="muted">Carregando...</p> : data.orders.length === 0 ? (
        <section className="empty-hero">
          <span className="action-icon action-icon-lg"><Icon name="receipt" size={32} /></span>
          <h2>{data.total ? 'Nada encontrado' : 'Nenhum pedido ainda'}</h2>
          <p>{data.total ? 'Tente outra busca ou filtro.' : 'Quando um cliente finalizar um pedido no seu catálogo, ele aparece aqui na hora. Configure as entregas em “Entregas e frete”.'}</p>
        </section>
      ) : (
        <ul className="od-list">
          {data.orders.map((o) => {
            const daysLeft = Math.max(0, Math.ceil((o.createdAt + (data.retentionDays) * DAY - Date.now()) / DAY));
            const wa = `https://wa.me/${o.customerPhone}?text=${encodeURIComponent(`Olá, ${o.customerName}! Sobre o seu pedido ${o.code}:`)}`;
            return (
              <li key={o.id} className={`od-card ${o.status === 'novo' ? 'is-new' : ''}`}>
                <div className="od-head">
                  <label className="od-check"><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} aria-label={`Selecionar pedido ${o.code}`} /></label>
                  <strong className="od-code">#{o.code}</strong>
                  <span className={`pill ${o.status === 'novo' ? 'pill-partial' : 'pill-sent'}`}>{o.status === 'novo' ? 'Novo' : 'Atendido'}</span>
                  <span className="tag">{TYPE[o.deliveryType]}</span>
                  <span className="muted small od-date">{dateTimeBR(o.createdAt)} · some em {plural(daysLeft, 'dia', 'dias')}</span>
                </div>
                <div className="od-cust">
                  <strong>{o.customerName}</strong>
                  <a href={wa} target="_blank" rel="noopener noreferrer">{formatStoredPhone(o.customerPhone)}</a>
                </div>
                <p className="od-deliv">{deliveryText(o)}</p>
                <ul className="od-items">
                  {o.items.map((i, n) => <li key={n}><span>{i.qty}× {i.name}{i.variation ? ` (${i.variation})` : ''}</span><span>{brl(i.totalCents)}</span></li>)}
                </ul>
                {o.notes && <p className="od-notes"><Icon name="note" size={14} /> {o.notes}</p>}
                <div className="od-total">
                  <span>Subtotal {brl(o.subtotalCents)}</span>
                  <span>{o.deliveryType === 'excursao' ? 'Frete a combinar' : `Frete ${brl(o.shippingCents)}${o.deliveryType === 'correios' ? ' (SuperFrete)' : ''}`}</span>
                  <strong>Total {brl(o.totalCents)}{o.deliveryType === 'excursao' ? ' + frete' : ''}</strong>
                </div>
                <div className="od-actions">
                  <a className="btn btn-primary btn-sm" href={wa} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={16} /> Chamar no WhatsApp</a>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDone(o)}><Icon name="check" size={16} /> {o.status === 'novo' ? 'Marcar como atendido' : 'Voltar para novo'}</button>
                  <button className="icon-btn icon-btn-danger" onClick={() => setConfirm({ ids: [o.id] })} aria-label={`Excluir pedido ${o.code}`} title="Excluir"><Icon name="trash" size={17} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {settings && <CatalogSettings onClose={() => setSettings(false)} />}
      {confirm && (
        <Modal title={confirm.all ? 'Excluir todos os pedidos?' : 'Excluir pedido(s)?'} onClose={() => setConfirm(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => doDelete(confirm)}>Excluir</button></>}>
          <p>{confirm.all ? 'Todos os pedidos serão apagados.' : `${plural(confirm.ids.length, 'pedido será apagado', 'pedidos serão apagados')}.`} Os clientes continuam salvos na aba Clientes. Não dá para desfazer.</p>
        </Modal>
      )}
    </>
  );
}
