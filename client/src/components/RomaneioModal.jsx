import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { brl } from '../lib/format.js';
import {
  COLUMN_DEFS, defaultRomaneio, deliveryText, loadRomaneio, rowsFromOrder, rowsFromProducts, saveRomaneio,
} from '../lib/romaneio.js';
import BarcodeSvg from './BarcodeSvg.jsx';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import PrintPortal from './PrintPortal.jsx';
import { useToast } from './Toast.jsx';

const PAYMENT = { pix: 'Pix', card: 'Cartão', credit: 'Cartão de crédito', debit: 'Cartão de débito', cash: 'Dinheiro', money: 'Dinheiro' };

function RomaneioDoc({ config, rows, header, store }) {
  const cols = config.columns.filter((c) => c.visible);
  const fields = config.fields.filter((f) => f.visible && header[f.key]);
  const total = rows.reduce((sum, row) => sum + row.totalCents, 0);
  const qty = rows.reduce((sum, row) => sum + row.qty, 0);
  const img = `${config.imageSize}mm`;
  const cell = (col, row) => {
    switch (col.key) {
      case 'photo': return row.photo ? <img src={row.photo} alt="" style={{ width: img, height: img, objectFit: 'cover', display: 'block' }} /> : null;
      case 'barcode': return row.code ? <div style={{ textAlign: 'center' }}>
        {config.barcodeMode !== 'text' && <BarcodeSvg code={row.code} style={{ width: '28mm', height: '8mm', display: 'block', margin: '0 auto' }} />}
        {config.barcodeMode !== 'bars' && <small>{row.code}</small>}
      </div> : null;
      case 'name': return row.name;
      case 'variation': return row.variation;
      case 'category': return row.category;
      case 'qty': return row.qty;
      case 'unit': return row.unitCents ? brl(row.unitCents) : '';
      case 'total': return row.totalCents ? brl(row.totalCents) : '';
      case 'check': return <span style={{ display: 'inline-block', width: '4mm', height: '4mm', border: '1px solid #000' }} />;
      default: return '';
    }
  };
  return (
    <div className="rom-doc" style={{ fontSize: `${config.fontSize}pt`, width: config.paper === '80mm' ? '74mm' : '100%' }}>
      <h1 style={{ fontSize: '1.6em', margin: '0 0 2mm' }}>{config.title}</h1>
      {store && fields.some((f) => f.key === 'store') && <p style={{ margin: 0 }}><strong>{store}</strong></p>}
      <div className="rom-fields">
        {fields.filter((f) => f.key !== 'store').map((f) => <p key={f.key}><strong>{f.label}:</strong> {header[f.key]}</p>)}
      </div>
      <table>
        <thead><tr>{cols.map((c) => <th key={c.key} style={['qty', 'unit', 'total'].includes(c.key) ? { textAlign: 'right' } : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => <tr key={index}>{cols.map((c) => <td key={c.key} style={['qty', 'unit', 'total'].includes(c.key) ? { textAlign: 'right' } : undefined}>{cell(c, row)}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={cols.length || 1}>Nenhum item.</td></tr>}
        </tbody>
      </table>
      {config.showTotals && <p className="rom-totals"><strong>Itens: {qty}</strong>{total > 0 && <strong> · Total: {brl(total)}</strong>}</p>}
      {config.footer && <p className="rom-footer">{config.footer}</p>}
      {config.signatures && <div className="rom-sign"><span>Separado por</span><span>Conferido por</span></div>}
    </div>
  );
}

export default function RomaneioModal({ products, onClose }) {
  const toast = useToast();
  const [config, setConfig] = useState(loadRomaneio);
  const [mode, setMode] = useState('order');
  const [orders, setOrders] = useState(null);
  const [orderId, setOrderId] = useState('');
  const [store, setStore] = useState('');
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/catalog/orders?days=90').then((r) => { if (alive) { setOrders(r.orders || []); setOrderId(String(r.orders?.[0]?.id || '')); } }).catch((e) => { if (alive) { setOrders([]); toast(e.message, 'error'); } });
    api.get('/catalog/pos/settings').then((r) => alive && setStore(r.receipt?.storeName || '')).catch(() => {});
    return () => { alive = false; };
  }, [toast]);

  const patch = (p) => setConfig((c) => { const next = { ...c, ...p }; saveRomaneio(next); return next; });
  const patchItem = (list, key, p) => patch({ [list]: config[list].map((item) => (item.key === key ? { ...item, ...p } : item)) });
  const move = (list, index, dir) => {
    const copy = [...config[list]];
    const to = index + dir;
    if (to < 0 || to >= copy.length) return;
    [copy[index], copy[to]] = [copy[to], copy[index]];
    patch({ [list]: copy });
  };

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const order = (orders || []).find((o) => String(o.id) === orderId);
  const rows = useMemo(() => (mode === 'order' ? (order ? rowsFromOrder(order, productMap) : []) : rowsFromProducts(products)), [mode, order, productMap, products]);
  const header = useMemo(() => {
    if (mode !== 'order' || !order) return { date: new Date().toLocaleDateString('pt-BR') };
    return {
      order: order.code, date: new Date(order.createdAt).toLocaleString('pt-BR'), customer: order.customerName, phone: order.customerPhone,
      delivery: deliveryText(order), payment: PAYMENT[order.paymentMethod] || order.paymentMethod || '', notes: order.notes,
    };
  }, [mode, order]);

  const pageCss = config.paper === '80mm' ? 'size: 80mm auto; margin: 3mm;' : 'size: A4; margin: 10mm;';
  const finish = useCallback(() => setPrinting(false), []);

  const list = (name, defs) => <ul className="rom-list">
    {config[name].map((item, index) => <li key={item.key}>
      <label className="check-line"><input type="checkbox" checked={item.visible} onChange={(e) => patchItem(name, item.key, { visible: e.target.checked })} /></label>
      <input className="input" value={item.label} maxLength={30} onChange={(e) => patchItem(name, item.key, { label: e.target.value })} aria-label={`Nome de ${defs[item.key]}`} />
      <button type="button" className="icon-btn" onClick={() => move(name, index, -1)} disabled={index === 0} aria-label="Subir">↑</button>
      <button type="button" className="icon-btn" onClick={() => move(name, index, 1)} disabled={index === config[name].length - 1} aria-label="Descer">↓</button>
    </li>)}
  </ul>;

  return (
    <Modal wide title="Romaneio" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={() => { const d = defaultRomaneio(); saveRomaneio(d); setConfig(d); }}>Restaurar modelo</button><button className="btn btn-ghost" onClick={onClose}>Fechar</button><button className="btn btn-primary" onClick={() => (rows.length ? setPrinting(true) : toast('Nada para imprimir.', 'error'))}><Icon name="printer" size={16} /> Imprimir</button></>}>
      <div className="rom-layout">
        <section className="rom-config">
          <div className="lbl-presets">
            <button type="button" className={`btn btn-sm ${mode === 'order' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('order')}>De um pedido</button>
            <button type="button" className={`btn btn-sm ${mode === 'products' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('products')}>Lista de produtos</button>
          </div>
          {mode === 'order' && <label className="field"><span>Pedido (últimos 90 dias)</span>
            <select className="input" value={orderId} onChange={(e) => setOrderId(e.target.value)} disabled={!orders?.length}>
              {!orders?.length && <option value="">{orders ? 'Nenhum pedido' : 'Carregando...'}</option>}
              {(orders || []).map((o) => <option key={o.id} value={o.id}>{o.code} · {o.customerName} · {brl(o.totalCents)}</option>)}
            </select></label>}
          {mode === 'products' && <small className="muted">Usa os produtos filtrados na tela. Quantidade = estoque (ou 1 sem controle de estoque).</small>}
          <label className="field"><span>Título</span><input className="input" value={config.title} maxLength={60} onChange={(e) => patch({ title: e.target.value })} /></label>
          <div className="lbl-grid">
            <label className="field"><span>Papel</span><select className="input" value={config.paper} onChange={(e) => patch({ paper: e.target.value })}><option value="a4">A4</option><option value="80mm">Bobina 80 mm</option></select></label>
            <label className="field"><span>Fonte (pt)</span><input className="input" type="number" min="6" max="20" value={config.fontSize} onChange={(e) => patch({ fontSize: Math.max(6, Math.min(20, Number(e.target.value) || 10)) })} /></label>
            <label className="field"><span>Foto (mm)</span><input className="input" type="number" min="6" max="40" value={config.imageSize} onChange={(e) => patch({ imageSize: Math.max(6, Math.min(40, Number(e.target.value) || 12)) })} /></label>
            <label className="field"><span>Código de barras</span><select className="input" value={config.barcodeMode} onChange={(e) => patch({ barcodeMode: e.target.value })}><option value="both">Barras e número</option><option value="bars">Só barras</option><option value="text">Só número</option></select></label>
          </div>
          <h4>Colunas</h4>{list('columns', COLUMN_DEFS)}
          <h4>Dados do cabeçalho</h4>{list('fields', Object.fromEntries(config.fields.map((f) => [f.key, f.label])))}
          <label className="check-line"><input type="checkbox" checked={config.showTotals} onChange={(e) => patch({ showTotals: e.target.checked })} /><span>Mostrar totais</span></label>
          <label className="check-line"><input type="checkbox" checked={config.signatures} onChange={(e) => patch({ signatures: e.target.checked })} /><span>Linhas de assinatura</span></label>
          <label className="field"><span>Texto no rodapé</span><textarea className="input" rows="2" maxLength={300} value={config.footer} onChange={(e) => patch({ footer: e.target.value })} /></label>
        </section>
        <section className="rom-preview"><div className={`rom-paper ${config.paper === '80mm' ? 'is-narrow' : ''}`}><RomaneioDoc config={config} rows={rows} header={header} store={store} /></div></section>
      </div>
      {printing && <PrintPortal pageCss={pageCss} onDone={finish}><RomaneioDoc config={config} rows={rows} header={header} store={store} /></PrintPortal>}
    </Modal>
  );
}
