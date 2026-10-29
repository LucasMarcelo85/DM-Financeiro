import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isShopMode } from '../api.js';
import CatalogSettings from '../components/CatalogSettings.jsx';
import Icon from '../components/Icon.jsx';
import StoreBar from '../components/StoreBar.jsx';
import CsvTransfer from '../components/CsvTransfer.jsx';
import Modal from '../components/Modal.jsx';
import PointOfSale from '../components/PointOfSale.jsx';
import { useToast } from '../components/Toast.jsx';
import { brl, dateTimeBR, formatStoredPhone, plural } from '../lib/format.js';
import { importCsvBatches } from '../lib/csv.js';
import { BRAZIL_MAP } from '../lib/brazilMap.js';

const DAY = 86400000;
const TYPE = { retirada: 'Retirada', excursao: 'Excursão', motoboy: 'Motoboy', correios: 'Correios' };
const PAYMENT_PROVIDER = { infinitepay: 'InfinitePay', manual: 'manualmente' };
const ORDER_CSV_COLUMNS = [
  { key: 'code', type: 'string' }, { key: 'customerName', type: 'string' }, { key: 'customerPhone', type: 'string' },
  { key: 'deliveryType', type: 'string' }, { key: 'delivery', type: 'json' }, { key: 'items', type: 'json' },
  { key: 'subtotalCents', type: 'number' }, { key: 'shippingCents', type: 'number' }, { key: 'totalCents', type: 'number' },
  { key: 'notes', type: 'string' }, { key: 'status', type: 'string' }, { key: 'paymentStatus', type: 'string' },
  { key: 'source', type: 'string' }, { key: 'paymentMethod', type: 'string' }, { key: 'paymentBreakdown', type: 'json' },
  { key: 'discountCents', type: 'number' }, { key: 'surchargeCents', type: 'number' },
  { key: 'paymentProvider', type: 'string' }, { key: 'paymentId', type: 'string' }, { key: 'paymentProofUrl', type: 'string' },
  { key: 'paidAt', type: 'date' }, { key: 'createdAt', type: 'date' }, { key: 'deletedAt', type: 'date' },
];
const CUSTOMER_CSV_COLUMNS = [
  { key: 'name', type: 'string' }, { key: 'phone', type: 'string' }, { key: 'labels', type: 'json' },
  { key: 'notes', type: 'string' }, { key: 'updatedAt', type: 'date' },
];
const timeSince = (timestamp) => {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes === 0) return 'agora';
  if (minutes < 60) return `há ${plural(minutes, 'minuto', 'minutos')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${plural(hours, 'hora', 'horas')}`;
  return `há ${plural(Math.floor(hours / 24), 'dia', 'dias')}`;
};

const SALES_REGIONS = [
  { key: 'norte', name: 'Norte', ddds: [63, 68, 69, 91, 92, 93, 94, 95, 96, 97], color: '#0e9f6e' },
  { key: 'nordeste', name: 'Nordeste', ddds: [71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 98, 99], color: '#d97706' },
  { key: 'centro-oeste', name: 'Centro-Oeste', ddds: [61, 62, 64, 65, 66, 67], color: '#7c3aed' },
  { key: 'sudeste', name: 'Sudeste', ddds: [11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38], color: '#2563eb' },
  { key: 'sul', name: 'Sul', ddds: [41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55], color: '#db2777' },
];
const regionForPhone = (phone) => {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  const ddd = Number(digits.slice(0, 2));
  return SALES_REGIONS.find((region) => region.ddds.includes(ddd)) || null;
};

function StrategyDashboard({ data, days, query, sort, onSortChange, kind, onKindChange, onOpenCustomer }) {
  const [activeRegion, setActiveRegion] = useState(null);
  const regions = SALES_REGIONS.map((region) => {
    const customers = data.customers.filter((customer) => regionForPhone(customer.phone)?.key === region.key);
    return {
      ...region,
      ...BRAZIL_MAP.centers[region.key],
      customers: customers.length,
      buyers: customers.filter((customer) => customer.orders > 0).length,
      salesCents: customers.reduce((sum, customer) => sum + customer.totalCents, 0),
    };
  });
  const rankedRegions = [...regions].sort((a, b) => b.salesCents - a.salesCents);
  const regionColor = Object.fromEntries(regions.map((region) => [region.key, region.color]));
  const maxRegionCustomers = Math.max(1, ...regions.map((region) => region.customers));
  const highlight = (key) => ({ onMouseEnter: () => setActiveRegion(key), onMouseLeave: () => setActiveRegion(null), onFocus: () => setActiveRegion(key), onBlur: () => setActiveRegion(null) });
  const customersWithoutRegion = data.customers.filter((customer) => !regionForPhone(customer.phone)).length;
  const filtered = data.customers
    .filter((customer) => !query.trim() || `${customer.name} ${customer.phone} ${customer.labels.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((customer) => kind === 'recurring' ? customer.orders > 1 : kind === 'once' ? customer.orders === 1 : kind === 'none' ? customer.orders === 0 : true)
    .sort((a, b) => sort === 'low'
      ? a.totalCents - b.totalCents
      : sort === 'recent'
        ? (b.lastOrderAt || 0) - (a.lastOrderAt || 0)
        : b.totalCents - a.totalCents);

  return (
    <section className="od-strategy">
      <div className="od-strategy-heading">
        <div><h2>Estratégia de vendas</h2><p className="muted">Resumo dos últimos {days} dias. Os relatórios ficam salvos; os filtros aceitam até 90 dias.</p></div>
        <span className="od-strategy-note">Região aproximada pelo DDD</span>
      </div>
      <div className="od-stats od-strategy-stats">
        <article><span>Clientes cadastrados</span><strong>{data.totalCustomers}</strong></article>
        <article><span>Compraram no período</span><strong>{data.buyingCustomers}</strong></article>
        <article><span>Recorrentes · 2+ pedidos</span><strong>{data.recurringCustomers}</strong></article>
        <article><span>Uma compra</span><strong>{data.oneTimeCustomers}</strong></article>
        <article><span>Sem compra no período</span><strong>{data.nonBuyingCustomers}</strong></article>
        <article><span>Vendas pagas no período</span><strong>{brl(data.salesCents)}</strong></article>
      </div>

      <div className="od-strategy-grid">
        <section className="od-strategy-map-card">
          <div className="od-strategy-subhead"><div><h3>Clientes por região</h3><p className="muted small">Os pinos agrupam clientes pela região do DDD, não pelo endereço exato. Passe o mouse ou toque em um pino para destacar a região.</p></div></div>
          <div className="od-brazil-map">
            <svg viewBox={`0 0 ${BRAZIL_MAP.width} ${BRAZIL_MAP.height}`} role="img" aria-label="Mapa do Brasil com os estados e os clientes agrupados por região">
              <g className="od-map-states">
                {BRAZIL_MAP.states.map((state) => (
                  <path key={state.uf} d={state.d} fill={regionColor[state.region]} className={`od-map-state${activeRegion === state.region ? ' is-active' : activeRegion ? ' is-dim' : ''}`}>
                    <title>{`${state.name} (${state.uf})`}</title>
                  </path>
                ))}
              </g>
              {[...regions].sort((a, b) => (a.key === activeRegion) - (b.key === activeRegion)).map((region) => {
                const scale = 0.8 + 0.5 * Math.sqrt(region.customers / maxRegionCustomers);
                const digits = String(region.customers).length;
                return (
                  <g key={region.key} className={`od-map-pin${activeRegion === region.key ? ' is-active' : ''}${region.customers === 0 ? ' is-empty' : ''}`} transform={`translate(${region.x} ${region.y})`} tabIndex={0} role="img" aria-label={`${region.name}: ${region.customers} clientes, ${brl(region.salesCents)} em vendas pagas`} {...highlight(region.key)}>
                    <ellipse className="od-map-pin-shadow" cx="0" cy="0" rx={6 * scale} ry={2.2 * scale} />
                    <g transform={`scale(${scale})`}>
                      <path className="od-map-pin-body" fill={region.color} d="M0 0C-4 -7 -13 -13 -13 -24a13 13 0 0 1 26 0C13 -13 4 -7 0 0Z" />
                      <circle cx="0" cy="-24" r="9.5" fill="#fff" fillOpacity="0.18" />
                      <text className="od-map-count" x="0" y="-24" textAnchor="middle" dominantBaseline="central" fontSize={digits > 3 ? 7.5 : digits > 2 ? 9 : 11.5}>{region.customers}</text>
                    </g>
                    <text className="od-map-label-halo" x="0" y={13 * scale} textAnchor="middle" fontSize="9" aria-hidden="true">{region.name}</text>
                    <text className="od-map-label" x="0" y={13 * scale} textAnchor="middle" fontSize="9">{region.name}</text>
                    <title>{`${region.name}: ${region.customers} clientes, ${brl(region.salesCents)} em vendas pagas`}</title>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="od-region-ranking">
            <article className="is-best"><span>Mais vende</span><strong>{rankedRegions[0].name}</strong><b>{brl(rankedRegions[0].salesCents)}</b></article>
              <article className="is-low"><span>Menos vende</span><strong>{rankedRegions[rankedRegions.length - 1].name}</strong><b>{brl(rankedRegions[rankedRegions.length - 1].salesCents)}</b></article>
          </div>
          {customersWithoutRegion > 0 && <p className="muted small">{customersWithoutRegion} {plural(customersWithoutRegion, 'cliente sem DDD identificado', 'clientes sem DDD identificado')} não aparecem no mapa.</p>}
          <ul className="od-region-list">
            {rankedRegions.map((region) => <li key={region.key} className={activeRegion === region.key ? 'is-active' : undefined} tabIndex={0} {...highlight(region.key)}><span className="od-region-dot" style={{ background: region.color }} /><strong>{region.name}</strong><span>{region.customers} clientes · {region.buyers} compradores</span><b>{brl(region.salesCents)}</b></li>)}
          </ul>
        </section>

        <section className="od-strategy-customers">
          <div className="od-strategy-subhead"><div><h3>Clientes e oportunidades</h3><p className="muted small">Compare valor comprado e frequência neste período.</p></div></div>
          <div className="od-strategy-filters">
            <select className="input" value={kind} onChange={(event) => onKindChange(event.target.value)} aria-label="Filtrar tipo de cliente">
              <option value="all">Todos os clientes</option><option value="recurring">Recorrentes</option><option value="once">Uma compra</option><option value="none">Sem compra</option>
            </select>
            <select className="input" value={sort} onChange={(event) => onSortChange(event.target.value)} aria-label="Ordenar clientes">
              <option value="high">Maior valor comprado</option><option value="low">Menor valor comprado</option><option value="recent">Pedido mais recente</option>
            </select>
          </div>
          {!filtered.length ? <p className="muted">Nenhum cliente nesta categoria e período.</p> : (
            <ul className="od-strategy-customer-list">
              {filtered.map((customer) => (
                <li key={customer.phone}>
                  {onOpenCustomer ? <button type="button" className="od-strategy-customer" onClick={() => onOpenCustomer(customer.phone)}>
                    <span className="od-strategy-customer-main"><strong>{customer.name}</strong><small>{formatStoredPhone(customer.phone)}{regionForPhone(customer.phone) ? ` · ${regionForPhone(customer.phone).name}` : ''}</small></span>
                    <span><small>Valor pago</small><b>{brl(customer.totalCents)}</b></span>
                    <span><small>Pedidos</small><b>{customer.orders}</b></span>
                    <span><small>Último pedido</small><b>{customer.lastOrderAt ? timeSince(customer.lastOrderAt) : 'Sem compra no período'}</b></span>
                  </button> : <div className="od-strategy-customer">
                    <span className="od-strategy-customer-main"><strong>{customer.name}</strong><small>{formatStoredPhone(customer.phone)}{regionForPhone(customer.phone) ? ` · ${regionForPhone(customer.phone).name}` : ''}</small></span>
                    <span><small>Valor pago</small><b>{brl(customer.totalCents)}</b></span>
                    <span><small>Pedidos</small><b>{customer.orders}</b></span>
                    <span><small>Último pedido</small><b>{customer.lastOrderAt ? timeSince(customer.lastOrderAt) : 'Sem compra no período'}</b></span>
                  </div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function deliveryText(o) {
  const d = o.delivery || {};
  if (o.deliveryType === 'retirada') return `${d.name || 'Retirada na loja'} · ${d.address || 'Endereço não informado'}`;
  if (o.deliveryType === 'excursao') return `Galpão ${d.warehouse} · ${d.address}, ${d.city}`;
  const addr = [d.street, d.number, d.district, d.city && `${d.city}${d.state ? `/${d.state}` : ''}`].filter(Boolean).join(', ');
  if (o.deliveryType === 'motoboy') return `${addr || 'Endereço não informado'}${d.zip ? ` · CEP ${d.zip}` : ''}${d.km ? ` · ${String(d.km).replace('.', ',')} km${d.approx ? ' (aprox.)' : ''}` : ''}`;
  return `${d.service || 'Correios'} · CEP ${d.zip}${d.days ? ` · prazo até ${d.days.max} dias` : ''}${addr ? ` · ${addr}` : ''}`;
}

export default function Orders({ allow }) {
  const can = (key) => !allow || allow.includes(key);
  const toast = useToast();
  const [data, setData] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [strategy, setStrategy] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState(false);
  const [customerDelete, setCustomerDelete] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState('30');
  const [deliveryType, setDeliveryType] = useState('');
  const [source, setSource] = useState('');
  const [tab, setTab] = useState(() => (can('pedidos') ? 'orders' : can('clientes') ? 'customers' : can('estrategia') ? 'strategy' : can('pdv') ? 'pos' : 'log'));
  const [customerKind, setCustomerKind] = useState('all');
  const [customerSort, setCustomerSort] = useState('high');
  const [strategyKind, setStrategyKind] = useState('all');
  const [strategySort, setStrategySort] = useState('high');
  const [sel, setSel] = useState(new Set());
  const [confirm, setConfirm] = useState(null);
  const [settings, setSettings] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    if (tab === 'customers' || tab === 'strategy' || tab === 'pos' || !can('pedidos')) return Promise.resolve();
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (status) qs.set('status', status);
    qs.set('days', period);
    if (deliveryType) qs.set('deliveryType', deliveryType);
    if (source) qs.set('source', source);
    if (tab === 'log') qs.set('view', 'log');
    return api.get(`/catalog/orders?${qs}`).then((r) => alive.current && setData(r)).catch((e) => toast(e.message, 'error'));
  }, [q, status, period, deliveryType, source, tab, toast, allow]);
  const loadCustomers = useCallback(() => api.get(`/catalog/customers?days=${period}`).then((r) => alive.current && setCustomers(r)).catch((e) => toast(e.message, 'error')), [period, toast]);
  const loadStrategy = useCallback(() => api.get(`/catalog/strategy?days=${period}`).then((r) => alive.current && setStrategy(r)).catch((e) => toast(e.message, 'error')), [period, toast]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (tab === 'customers') loadCustomers(); }, [tab, loadCustomers]);
  useEffect(() => { if (tab === 'strategy') loadStrategy(); }, [tab, loadStrategy]);

  const toggleSel = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function setDone(o) {
    try { await api.patch(`/catalog/orders/${o.id}`, { status: o.status === 'novo' ? 'atendido' : 'novo' }); load(); } catch (e) { toast(e.message, 'error'); }
  }
  async function restoreOrder(o) {
    try {
      await api.post(`/catalog/orders/${o.id}/restore`);
      toast('Pedido voltou para Pedidos e o estoque foi atualizado.');
      load();
    } catch (e) { toast(e.message, 'error'); }
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
  async function createCustomer(data) {
    try {
      await api.post('/catalog/customers', data);
      setCustomerForm(false);
      loadCustomers();
      toast('Cliente cadastrado.');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function deleteCustomer() {
    if (!customerDelete) return;
    try {
      await api.del(`/catalog/customers/${encodeURIComponent(customerDelete.phone)}`, { pin: customerDelete.pin });
      setCustomerDelete(null);
      setCustomer(null);
      loadCustomers();
      toast('Cadastro do cliente excluído. Os pedidos e relatórios históricos foram preservados.');
    } catch (e) { toast(e.message, 'error'); }
  }

  const shownCustomers = (customers?.customers || [])
    .filter((c) => !q.trim() || `${c.name} ${c.phone} ${c.labels.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((c) => customerKind === 'recurring' ? c.orders > 1 : customerKind === 'once' ? c.orders === 1 : customerKind === 'none' ? c.orders === 0 : true)
    .sort((a, b) => customerSort === 'low' ? a.totalCents - b.totalCents : customerSort === 'recent' ? (b.lastOrderAt || 0) - (a.lastOrderAt || 0) : b.totalCents - a.totalCents);
  const isLog = tab === 'log';

  if (tab === 'pos') return <PointOfSale
    onClose={can('pedidos') ? () => setTab('orders') : can('clientes') ? () => setTab('customers') : can('estrategia') ? () => setTab('strategy') : null}
    allowCustomers={can('clientes')}
  />;

  return (
    <>
      <header className="page-head head-row">
        <div>
          <h1>Pedidos e clientes</h1>
          <p className="muted">Acompanhe vendas, clientes e estratégias. Pedidos ficam ativos por até 90 dias; os arquivados são removidos após 20 dias.</p>
        </div>
        <div className="btn-group">
          {tab !== 'strategy' && can(tab === 'customers' ? 'clientes' : 'pedidos') && (
            <CsvTransfer
              resource={tab === 'customers' ? 'order-customers' : 'orders'}
              title={tab === 'customers' ? 'clientes' : 'pedidos'}
              filename={tab === 'customers' ? 'clientes-da-loja.csv' : 'pedidos.csv'}
              exportUrl={tab === 'customers' ? '/catalog/customers/export' : '/catalog/orders/export'}
              columns={tab === 'customers' ? CUSTOMER_CSV_COLUMNS : ORDER_CSV_COLUMNS}
              dateDescription={tab === 'customers' ? 'última atualização' : 'criação'}
              description={tab === 'customers'
                ? 'Exporte os clientes da loja, incluindo etiquetas e observações.'
                : 'Exporte pedidos ativos e arquivados, com itens, entrega e informações de pagamento.'}
              onImport={async (rows) => {
                const result = tab === 'customers'
                  ? await importCsvBatches(rows, (batch) => api.post('/catalog/customers/import', { customers: batch }), 500, 2 * 1024 * 1024)
                  : await importCsvBatches(rows, (batch) => api.post('/catalog/orders/import', { orders: batch }), 500, 5 * 1024 * 1024);
                if (tab === 'customers') loadCustomers();
                else load();
                return result;
              }}
            />
          )}
          {!isShopMode() && <button className="btn btn-ghost" onClick={() => setSettings(true)}><Icon name="gear" size={18} /> Entregas e frete</button>}
          {can('pdv') && <button className="btn btn-primary" onClick={() => setTab('pos')}>Abrir frente de caixa</button>}
          {tab === 'customers' && can('clientes') && <button className="btn btn-primary" onClick={() => setCustomerForm(true)}>Novo cliente</button>}
        </div>
      </header>
      <StoreBar />

      <nav className="od-tabs" aria-label="Área de pedidos">
        {can('pedidos') && <button type="button" className={tab === 'orders' ? 'is-on' : ''} onClick={() => { setTab('orders'); setSel(new Set()); }}>Pedidos {data && <span>{data.fresh} novos</span>}</button>}
        {can('clientes') && <button type="button" className={tab === 'customers' ? 'is-on' : ''} onClick={() => { setTab('customers'); setSel(new Set()); }}>Clientes</button>}
        {can('arquivados') && <button type="button" className={tab === 'log' ? 'is-on' : ''} onClick={() => { setTab('log'); setSel(new Set()); }}>Arquivados {data && <span>{data.archived}</span>}</button>}
        {can('estrategia') && <button type="button" className={tab === 'strategy' ? 'is-on' : ''} onClick={() => { setTab('strategy'); setSel(new Set()); }}>Estratégia</button>}
      </nav>

      {tab === 'orders' && data && (
        <div className="od-stats">
          <article><span>Pedidos ativos</span><strong>{data.total}</strong></article>
          <article><span>Clientes cadastrados</span><strong>{data.customerCount}</strong></article>
          <article><span>Novos</span><strong>{data.fresh}</strong></article>
          <article><span>Vendido (pagos)</span><strong>{brl(data.stats.totalCents)}</strong></article>
          <article><span>Ticket médio</span><strong>{brl(data.stats.averageCents)}</strong></article>
        </div>
      )}

      {(tab !== 'customers' || customers) && (
        <div className="od-bar">
          <input className="input" type="search" placeholder={tab === 'customers' || tab === 'strategy' ? 'Buscar cliente, telefone ou etiqueta' : 'Buscar por nome, telefone ou código'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
          {(tab === 'orders' || tab === 'log') && (
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
              <option value="">Todas as situações</option>
              <option value="novo">Novos ({data?.fresh || 0})</option>
              <option value="atendido">Atendidos</option>
            </select>
          )}
          <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Período">
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="60">Últimos 60 dias</option>
            <option value="90">Últimos 90 dias</option>
          </select>
          {(tab === 'orders' || tab === 'log') && <select className="input" value={deliveryType} onChange={(e) => setDeliveryType(e.target.value)} aria-label="Forma de entrega">
            <option value="">Todas as entregas</option><option value="retirada">Retirada</option><option value="excursao">Excursão</option><option value="motoboy">Motoboy</option><option value="correios">Correios</option>
          </select>}
          {tab === 'orders' && <select className="input" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Origem do pedido">
            <option value="">Todas as origens</option><option value="catalog">Catálogo</option><option value="pdv">Frente de caixa (PDV)</option>
          </select>}
          {tab === 'customers' && <>
            <select className="input" value={customerKind} onChange={(e) => setCustomerKind(e.target.value)} aria-label="Tipo de cliente">
              <option value="all">Todos os clientes</option><option value="recurring">Recorrentes</option><option value="once">Uma compra</option><option value="none">Sem compra no período</option>
            </select>
            <select className="input" value={customerSort} onChange={(e) => setCustomerSort(e.target.value)} aria-label="Ordenar clientes">
              <option value="high">Maior valor</option><option value="low">Menor valor</option><option value="recent">Pedido mais recente</option>
            </select>
          </>}
          {tab === 'orders' && sel.size > 0 && !isShopMode() && <button className="btn btn-danger btn-sm" onClick={() => setConfirm({ ids: [...sel] })}>Excluir {plural(sel.size, 'selecionado', 'selecionados')}</button>}
          {tab === 'orders' && data?.total > 0 && !isShopMode() && <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ all: true })}>Arquivar todos</button>}
        </div>
      )}

      {tab === 'strategy' ? (
        strategy === null ? <p className="muted">Carregando estratégia...</p> : <StrategyDashboard
          data={strategy} days={period} query={q} sort={strategySort} onSortChange={setStrategySort}
          kind={strategyKind} onKindChange={setStrategyKind} onOpenCustomer={can('clientes') ? openCustomer : null}
        />
      ) : tab === 'customers' ? (
        customers === null ? <p className="muted">Carregando clientes...</p> : (
          <>
            <div className="od-stats od-customer-stats">
              <article><span>Total de clientes</span><strong>{customers.totalCustomers}</strong></article>
              <article><span>Recorrentes</span><strong>{customers.recurringCustomers}</strong></article>
              <article><span>Uma compra</span><strong>{customers.oneTimeCustomers}</strong></article>
              <article><span>Sem compra no período</span><strong>{customers.nonBuyingCustomers}</strong></article>
            </div>
            {shownCustomers.length ? <div className="od-customer-list">
              {shownCustomers.map((c) => (
                <button type="button" key={c.phone} className="od-customer" onClick={() => openCustomer(c.phone)}>
                  <span className="od-customer-main"><strong>{c.name}</strong><small>{formatStoredPhone(c.phone)}</small><span>{c.labels.map((label) => <i key={label}>{label}</i>)}</span></span>
                  <span><small>Total comprado</small><strong>{brl(c.totalCents)}</strong></span>
                  <span><small>Ticket médio</small><strong>{brl(c.averageCents)}</strong></span>
                  <span><small>Compras ({customers.days} dias)</small><strong>{c.orders}</strong></span>
                  <span><small>Último pedido</small><strong title={c.lastOrderAt ? dateTimeBR(c.lastOrderAt) : undefined}>{c.lastOrderAt ? timeSince(c.lastOrderAt) : 'Sem pedidos recentes'}</strong></span>
                </button>
              ))}
            </div> : <section className="empty-hero"><h2>Nenhum cliente encontrado</h2><p>Ajuste a busca ou o filtro de clientes.</p></section>}
          </>
        )
      ) : data === null ? <p className="muted">Carregando...</p> : data.orders.length === 0 ? (
        <section className="empty-hero">
          <span className="action-icon action-icon-lg"><Icon name="receipt" size={32} /></span>
          <h2>{isLog ? 'Arquivados vazios' : data.total ? 'Nada encontrado' : 'Nenhum pedido ainda'}</h2>
          <p>{isLog ? `Pedidos arquivados aparecem aqui por até ${data.archivedRetentionDays} dias; os clientes e relatórios estratégicos são mantidos.` : data.total ? 'Tente outra busca ou filtro.' : 'Quando um cliente finalizar um pedido no seu catálogo, ele aparece aqui. Configure as entregas em “Entregas e frete”.'}</p>
        </section>
      ) : (
        <ul className={`od-list${isLog ? ' is-log' : ''}`}>
          {data.orders.map((o) => {
            const daysLeft = Math.max(0, Math.ceil(((o.deletedAt || o.createdAt) + data.archivedRetentionDays * DAY - Date.now()) / DAY));
            const wa = `https://wa.me/${o.customerPhone}?text=${encodeURIComponent(`Olá, ${o.customerName}! Sobre o seu pedido ${o.code}:`)}`;
            return (
              <li key={o.id} className={`od-card ${o.status === 'novo' ? 'is-new' : ''}`}>
                <div className="od-head">
                  {!isLog && <label className="od-check"><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} aria-label={`Selecionar pedido ${o.code}`} /></label>}
                  <strong className="od-code">#{o.code}</strong>
                  <span className={`pill ${o.status === 'novo' ? 'pill-partial' : 'pill-sent'}`}>{o.status === 'novo' ? 'Novo' : 'Atendido'}</span>
                  <span className={`pill ${o.paymentStatus === 'paid' ? 'pill-sent' : 'pill-partial'}`}>{o.paymentStatus === 'paid' ? `Pago · ${PAYMENT_PROVIDER[o.paymentProvider] || 'online'}` : o.paymentStatus === 'pending' ? 'Pagamento pendente' : 'Não pago'}</span>
                  {o.source === 'pdv' ? <span className="tag">Frente de caixa</span> : <span className="tag">{TYPE[o.deliveryType]}</span>}
                  <span className="muted small od-date">{dateTimeBR(o.createdAt)}{isLog ? ` · apaga em ${plural(daysLeft, 'dia', 'dias')}` : ''}</span>
                </div>
                <div className="od-cust">{can('clientes') && o.customerPhone ? <button type="button" className="od-customer-link" onClick={() => openCustomer(o.customerPhone)}>{o.customerName}</button> : <strong>{o.customerName}</strong>}{o.customerPhone && <a href={wa} target="_blank" rel="noopener noreferrer">{formatStoredPhone(o.customerPhone)}</a>}</div>
                <p className="od-deliv">{deliveryText(o)}</p>
                <ul className="od-items">{o.items.map((i, n) => <li key={n}><span>{i.qty}× {i.name}{i.variation ? ` (${i.variation})` : ''}</span><span>{brl(i.totalCents)}</span></li>)}</ul>
                {o.notes && <p className="od-notes"><Icon name="note" size={14} /> {o.notes}</p>}
                {o.source === 'pdv' && <p className="muted small">Pagamento: {(o.paymentBreakdown || []).map((payment) => `${payment.method}: ${brl(payment.amountCents)}`).join(' · ')}</p>}
                {o.paymentStatus === 'paid' && <p className="muted small">Pagamento confirmado{o.paymentId ? ` · ID ${o.paymentId}` : ''}{o.paidAt ? ` · ${dateTimeBR(o.paidAt)}` : ''}{o.paymentProofUrl ? <> · <a href={o.paymentProofUrl} download={`comprovante-${o.code}`}>Baixar comprovante</a></> : o.source !== 'pdv' ? ' · Comprovante ainda não disponibilizado pela InfinitePay.' : ''}</p>}
                <div className="od-total"><span>Subtotal {brl(o.subtotalCents)}</span>{o.discountCents > 0 && <span>Desconto −{brl(o.discountCents)}</span>}{o.surchargeCents > 0 && <span>Acréscimo +{brl(o.surchargeCents)}</span>}<span>{o.deliveryType === 'excursao' ? 'Frete a combinar' : `Frete ${brl(o.shippingCents)}${o.deliveryType === 'correios' ? ' (SuperFrete)' : ''}`}</span><strong>Total {brl(o.totalCents)}{o.deliveryType === 'excursao' ? ' + frete' : ''}</strong></div>
                {!isLog && <div className="od-actions">
                  {o.customerPhone && <a className="btn btn-primary btn-sm" href={wa} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={16} /> Chamar no WhatsApp</a>}
                  {o.source !== 'pdv' && <button className="btn btn-ghost btn-sm" onClick={() => setDone(o)}><Icon name="check" size={16} /> {o.status === 'novo' ? (o.paymentStatus === 'paid' ? 'Marcar como atendido' : 'Marcar como pago e atendido') : 'Voltar para novo'}</button>}
                  <button className="icon-btn" onClick={() => setConfirm({ ids: [o.id] })} aria-label={`Arquivar pedido ${o.code}`} title="Arquivar"><Icon name="archive" size={17} /></button>
                </div>}
                {isLog && <div className="od-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => restoreOrder(o)}><Icon name="undo" size={16} /> Voltar para pedidos e estoque</button>
                </div>}
              </li>
            );
          })}
        </ul>
      )}

      {settings && <CatalogSettings onClose={() => setSettings(false)} />}
      {customer && <CustomerModal value={customer} onClose={() => setCustomer(null)} onSave={saveCustomer} onDelete={(phone) => setCustomerDelete({ phone, pin: '', pinRequired: customer.pinRequired })} />}
      {customerForm && <CustomerCreateModal onClose={() => setCustomerForm(false)} onSave={createCustomer} />}
      {customerDelete && <Modal title="Excluir cadastro do cliente?" onClose={() => setCustomerDelete(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setCustomerDelete(null)}>Cancelar</button><button className="btn btn-danger" onClick={deleteCustomer}>Excluir cadastro</button></>}>
        <p>O cadastro do cliente será removido. Pedidos e relatórios históricos permanecem salvos.</p>
        {customerDelete.pinRequired && <label className="ce-field"><span>Confirme com seu PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={customerDelete.pin} onChange={(event) => setCustomerDelete((current) => ({ ...current, pin: event.target.value }))} /></label>}
      </Modal>}
      {confirm && (
        <Modal title={confirm.all ? 'Arquivar todos os pedidos?' : 'Arquivar pedido(s)?'} onClose={() => setConfirm(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => doDelete(confirm)}>Arquivar</button></>}>
          <p>{confirm.all ? 'Todos os pedidos que correspondem aos filtros ativos vão para Arquivados.' : `${plural(confirm.ids.length, 'pedido vai para Arquivados', 'pedidos vão para Arquivados')}.`} Os pedidos arquivados ficam por até 20 dias; os dados dos clientes e os relatórios estratégicos são mantidos.</p>
        </Modal>
      )}
    </>
  );
}

function CustomerModal({ value, onClose, onSave, onDelete }) {
  const { customer, orders } = value;
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [labels, setLabels] = useState(customer.labels.join(', '));
  const [notes, setNotes] = useState(customer.notes);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await onSave({ name, phone, labels: [...new Set(labels.split(',').map((x) => x.trim()).filter(Boolean))], notes, ...(value.pinRequired ? { pin } : {}) }); } finally { setBusy(false); }
  }
  return (
    <Modal title={customer.name} onClose={onClose} wide footer={<><button className="btn btn-ghost" onClick={onClose}>Fechar</button><button className="btn btn-danger" onClick={() => onDelete(customer.phone)}>Excluir cadastro</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Salvando...' : 'Salvar cliente'}</button></>}>
      <p className="muted">{formatStoredPhone(customer.phone)} · últimos {value.days} dias de pedidos</p>
      <div className="form">
        <label className="ce-field"><span>Nome</span><input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
        <label className="ce-field"><span>Telefone</span><input className="input input-sm" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" /></label>
        <label className="ce-field"><span>Etiquetas separadas por vírgula</span><input className="input input-sm" value={labels} onChange={(e) => setLabels(e.target.value)} maxLength={620} placeholder="VIP, recorrente, atacado" /></label>
        <label className="ce-field"><span>Anotações</span><textarea className="input input-sm" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></label>
        {value.pinRequired && <label className="ce-field"><span>PIN de confirmação</span><input className="input input-sm" type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)} /></label>}
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

function CustomerCreateModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return <Modal title="Cadastrar cliente" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={name.trim().length < 2 || !phone.trim()} onClick={() => onSave({ name, phone })}>Salvar cliente</button></>}>
    <div className="form">
      <label className="ce-field"><span>Nome</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus /></label>
      <label className="ce-field"><span>Telefone</span><input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={20} inputMode="tel" /></label>
    </div>
  </Modal>;
}