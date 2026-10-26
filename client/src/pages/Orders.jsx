import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isShopMode } from '../api.js';
import CatalogSettings from '../components/CatalogSettings.jsx';
import Icon from '../components/Icon.jsx';
import StoreBar from '../components/StoreBar.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { brl, dateTimeBR, formatStoredPhone, plural } from '../lib/format.js';

const DAY = 86400000;
const TYPE = { retirada: 'Retirada', excursao: 'Excursão', motoboy: 'Motoboy', correios: 'Correios' };
const timeSince = (timestamp) => {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes === 0) return 'agora';
  if (minutes < 60) return `há ${plural(minutes, 'minuto', 'minutos')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${plural(hours, 'hora', 'horas')}`;
  return `há ${plural(Math.floor(hours / 24), 'dia', 'dias')}`;
};

function deliveryText(o) {
  const d = o.delivery || {};
  if (o.deliveryType === 'retirada') return `${d.name || 'Retirada na loja'} · ${d.address || 'Endereço não informado'}`;
  if (o.deliveryType === 'excursao') return `Galpão ${d.warehouse} · ${d.address}, ${d.city}`;
  const addr = [d.street, d.number, d.district, d.city && `${d.city}${d.state ? `/${d.state}` : ''}`].filter(Boolean).join(', ');
  if (o.deliveryType === 'motoboy') return `${addr || 'Endereço não informado'}${d.zip ? ` · CEP ${d.zip}` : ''}${d.km ? ` · ${String(d.km).replace('.', ',')} km${d.approx ? ' (aprox.)' : ''}` : ''}`;
  return `${d.service || 'Correios'} · CEP ${d.zip}${d.days ? ` · prazo até ${d.days.max} dias` : ''}${addr ? ` · ${addr}` : ''}`;
}

export default function Orders() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState('20');
  const [deliveryType, setDeliveryType] = useState('');
  const [tab, setTab] = useState('orders');
  const [sel, setSel] = useState(new Set());
  const [confirm, setConfirm] = useState(null);
  const [settings, setSettings] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    if (tab === 'customers') return Promise.resolve();
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (status) qs.set('status', status);
    qs.set('days', period);
    if (deliveryType) qs.set('deliveryType', deliveryType);
    if (tab === 'log') qs.set('view', 'log');
    return api.get(`/catalog/orders?${qs}`).then((r) => alive.current && setData(r)).catch((e) => toast(e.message, 'error'));
  }, [q, status, period, deliveryType, tab, toast]);
  const loadCustomers = useCallback(() => api.get(`/catalog/customers?days=${period}`).then((r) => alive.current && setCustomers(r)).catch((e) => toast(e.message, 'error')), [period, toast]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (tab === 'customers') loadCustomers(); }, [tab, loadCustomers]);

  const toggleSel = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function setDone(o) {
    try { await api.patch(`/catalog/orders/${o.id}`, { status: o.status === 'novo' ? 'atendido' : 'novo' }); load(); } catch (e) { toast(e.message, 'error'); }
  }
  async function doDelete(c) {
    setConfirm(null);
    try {
      const r = await api.post('/catalog/orders/bulk-delete', c.all ? { all: true, days: period, status, deliveryType, q } : { ids: c.ids });
      toast(`${plural(r.removed, 'pedido enviado para arquivados', 'pedidos enviados para arquivados')}.`);
      setSel(new Set());
      load();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function openCustomer(phone) {
    try { setCustomer(await api.get(`/catalog/customers/${encodeURIComponent(phone)}?days=${period}`)); } catch (e) { toast(e.message, 'error'); }
  }
  async function saveCustomer(patch) {
    if (!customer) return;
    try {
      const r = await api.patch(`/catalog/customers/${encodeURIComponent(customer.customer.phone)}`, patch);
      setCustomer((current) => ({ ...current, customer: { ...current.customer, ...r.customer } }));
      loadCustomers();
      toast('Dados do cliente salvos.');
    } catch (e) { toast(e.message, 'error'); }
  }

  const shownCustomers = (customers?.customers || []).filter((c) => !q.trim() || `${c.name} ${c.phone} ${c.labels.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
  const isLog = tab === 'log';

  return (
    <>
      <header className="page-head head-row">
        <div>
          <h1>Pedidos e clientes</h1>
          <p className="muted">Acompanhe as vendas, clientes e o histórico. Pedidos removidos ficam em Arquivados por até {data?.retentionDays || 20} dias.</p>
        </div>
        {!isShopMode() && <button className="btn btn-ghost" onClick={() => setSettings(true)}><Icon name="gear" size={18} /> Entregas e frete</button>}
      </header>
      <StoreBar />

      <nav className="od-tabs" aria-label="Área de pedidos">
        <button type="button" className={tab === 'orders' ? 'is-on' : ''} onClick={() => { setTab('orders'); setSel(new Set()); }}>Pedidos {data && <span>{data.fresh} novos</span>}</button>
        <button type="button" className={tab === 'customers' ? 'is-on' : ''} onClick={() => { setTab('customers'); setSel(new Set()); }}>Clientes</button>
        <button type="button" className={tab === 'log' ? 'is-on' : ''} onClick={() => { setTab('log'); setSel(new Set()); }}>Arquivados {data && <span>{data.archived}</span>}</button>
      </nav>

      {tab === 'orders' && data && (
        <div className="od-stats">
          <article><span>Pedidos ativos</span><strong>{data.total}</strong></article>
          <article><span>Novos</span><strong>{data.fresh}</strong></article>
          <article><span>Vendido</span><strong>{brl(data.stats.totalCents)}</strong></article>
          <article><span>Ticket médio</span><strong>{brl(data.stats.averageCents)}</strong></article>
        </div>
      )}

      {(tab !== 'customers' || customers) && (
        <div className="od-bar">
          <input className="input" type="search" placeholder={tab === 'customers' ? 'Buscar cliente, telefone ou etiqueta' : 'Buscar por nome, telefone ou código'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
          {tab !== 'customers' && (
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
              <option value="">Todas as situações</option>
              <option value="novo">Novos ({data?.fresh || 0})</option>
              <option value="atendido">Atendidos</option>
            </select>
          )}
          <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Período">
            <option value="7">Últimos 7 dias</option>
            <option value="20">Últimos 20 dias</option>
          </select>
          {tab !== 'customers' && <select className="input" value={deliveryType} onChange={(e) => setDeliveryType(e.target.value)} aria-label="Forma de entrega">
            <option value="">Todas as entregas</option><option value="retirada">Retirada</option><option value="excursao">Excursão</option><option value="motoboy">Motoboy</option><option value="correios">Correios</option>
          </select>}
          {tab === 'orders' && sel.size > 0 && !isShopMode() && <button className="btn btn-danger btn-sm" onClick={() => setConfirm({ ids: [...sel] })}>Excluir {plural(sel.size, 'selecionado', 'selecionados')}</button>}
          {tab === 'orders' && data?.total > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ all: true })}>Arquivar todos</button>}
        </div>
      )}

      {tab === 'customers' ? (
        customers === null ? <p className="muted">Carregando clientes...</p> : shownCustomers.length ? (
          <div className="od-customer-list">
            {shownCustomers.map((c) => (
              <button type="button" key={c.phone} className="od-customer" onClick={() => openCustomer(c.phone)}>
                <span className="od-customer-main"><strong>{c.name}</strong><small>{formatStoredPhone(c.phone)}</small><span>{c.labels.map((label) => <i key={label}>{label}</i>)}</span></span>
                <span><small>Total comprado</small><strong>{brl(c.totalCents)}</strong></span>
                <span><small>Ticket médio</small><strong>{brl(c.averageCents)}</strong></span>
                <span><small>Compras ({customers.days} dias)</small><strong>{c.orders}</strong></span>
                <span><small>Último pedido</small><strong title={c.lastOrderAt ? dateTimeBR(c.lastOrderAt) : undefined}>{c.lastOrderAt ? timeSince(c.lastOrderAt) : 'Sem pedidos recentes'}</strong></span>
              </button>
            ))}
          </div>
        ) : <section className="empty-hero"><h2>Nenhum cliente encontrado</h2><p>Os clientes aparecem aqui quando finalizam pedidos na sua loja.</p></section>
      ) : data === null ? <p className="muted">Carregando...</p> : data.orders.length === 0 ? (
        <section className="empty-hero">
          <span className="action-icon action-icon-lg"><Icon name="receipt" size={32} /></span>
          <h2>{isLog ? 'Arquivados vazios' : data.total ? 'Nada encontrado' : 'Nenhum pedido ainda'}</h2>
          <p>{isLog ? `Pedidos arquivados aparecem aqui e são apagados após ${data.retentionDays} dias.` : data.total ? 'Tente outra busca ou filtro.' : 'Quando um cliente finalizar um pedido no seu catálogo, ele aparece aqui. Configure as entregas em “Entregas e frete”.'}</p>
        </section>
      ) : (
        <ul className={`od-list${isLog ? ' is-log' : ''}`}>
          {data.orders.map((o) => {
            const daysLeft = Math.max(0, Math.ceil(((o.deletedAt || o.createdAt) + data.retentionDays * DAY - Date.now()) / DAY));
            const wa = `https://wa.me/${o.customerPhone}?text=${encodeURIComponent(`Olá, ${o.customerName}! Sobre o seu pedido ${o.code}:`)}`;
            return (
              <li key={o.id} className={`od-card ${o.status === 'novo' ? 'is-new' : ''}`}>
                <div className="od-head">
                  {!isLog && <label className="od-check"><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} aria-label={`Selecionar pedido ${o.code}`} /></label>}
                  <strong className="od-code">#{o.code}</strong>
                  <span className={`pill ${o.status === 'novo' ? 'pill-partial' : 'pill-sent'}`}>{o.status === 'novo' ? 'Novo' : 'Atendido'}</span>
                  <span className="tag">{TYPE[o.deliveryType]}</span>
                  <span className="muted small od-date">{dateTimeBR(o.createdAt)}{isLog ? ` · apaga em ${plural(daysLeft, 'dia', 'dias')}` : ''}</span>
                </div>
                <div className="od-cust"><button type="button" className="od-customer-link" onClick={() => openCustomer(o.customerPhone)}>{o.customerName}</button><a href={wa} target="_blank" rel="noopener noreferrer">{formatStoredPhone(o.customerPhone)}</a></div>
                <p className="od-deliv">{deliveryText(o)}</p>
                <ul className="od-items">{o.items.map((i, n) => <li key={n}><span>{i.qty}× {i.name}{i.variation ? ` (${i.variation})` : ''}</span><span>{brl(i.totalCents)}</span></li>)}</ul>
                {o.notes && <p className="od-notes"><Icon name="note" size={14} /> {o.notes}</p>}
                <div className="od-total"><span>Subtotal {brl(o.subtotalCents)}</span><span>{o.deliveryType === 'excursao' ? 'Frete a combinar' : `Frete ${brl(o.shippingCents)}${o.deliveryType === 'correios' ? ' (SuperFrete)' : ''}`}</span><strong>Total {brl(o.totalCents)}{o.deliveryType === 'excursao' ? ' + frete' : ''}</strong></div>
                {!isLog && <div className="od-actions">
                  <a className="btn btn-primary btn-sm" href={wa} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={16} /> Chamar no WhatsApp</a>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDone(o)}><Icon name="check" size={16} /> {o.status === 'novo' ? 'Marcar como atendido' : 'Voltar para novo'}</button>
                  <button className="icon-btn" onClick={() => setConfirm({ ids: [o.id] })} aria-label={`Arquivar pedido ${o.code}`} title="Arquivar"><Icon name="archive" size={17} /></button>
                </div>}
              </li>
            );
          })}
        </ul>
      )}

      {settings && <CatalogSettings onClose={() => setSettings(false)} />}
      {customer && <CustomerModal value={customer} onClose={() => setCustomer(null)} onSave={saveCustomer} />}
      {confirm && (
        <Modal title={confirm.all ? 'Arquivar todos os pedidos?' : 'Arquivar pedido(s)?'} onClose={() => setConfirm(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => doDelete(confirm)}>Arquivar</button></>}>
          <p>{confirm.all ? 'Todos os pedidos que correspondem aos filtros ativos vão para Arquivados.' : `${plural(confirm.ids.length, 'pedido vai para Arquivados', 'pedidos vão para Arquivados')}.`} O histórico fica disponível por até {data?.retentionDays || 20} dias e os dados dos clientes são mantidos.</p>
        </Modal>
      )}
    </>
  );
}

function CustomerModal({ value, onClose, onSave }) {
  const { customer, orders } = value;
  const [labels, setLabels] = useState(customer.labels.join(', '));
  const [notes, setNotes] = useState(customer.notes);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await onSave({ labels: [...new Set(labels.split(',').map((x) => x.trim()).filter(Boolean))], notes }); } finally { setBusy(false); }
  }
  return (
    <Modal title={customer.name} onClose={onClose} wide footer={<><button className="btn btn-ghost" onClick={onClose}>Fechar</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Salvando...' : 'Salvar etiquetas e anotações'}</button></>}>
      <p className="muted">{formatStoredPhone(customer.phone)} · últimos {value.days} dias de pedidos</p>
      <div className="form">
        <label className="ce-field"><span>Etiquetas separadas por vírgula</span><input className="input input-sm" value={labels} onChange={(e) => setLabels(e.target.value)} maxLength={620} placeholder="VIP, recorrente, atacado" /></label>
        <label className="ce-field"><span>Anotações</span><textarea className="input input-sm" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></label>
      </div>
      <h3>Pedidos recentes</h3>
      {!orders.length ? <p className="muted">Nenhum pedido no período de retenção.</p> : (
        <ul className="od-customer-orders">{orders.map((o) => (
          <li key={o.id}>
            <strong>#{o.code}</strong><span>{dateTimeBR(o.createdAt)}</span><span>{o.items.reduce((sum, item) => sum + item.qty, 0)} itens</span><strong>{brl(o.totalCents)}</strong>
            <details><summary>Ver itens e entrega</summary><p>{o.items.map((item) => `${item.qty}× ${item.name}${item.variation ? ` (${item.variation})` : ''}`).join(' · ')}</p><p>{deliveryText(o)}</p></details>
          </li>
        ))}</ul>
      )}
    </Modal>
  );
}
