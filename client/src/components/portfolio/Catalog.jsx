import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { ProductCard, minPrice } from './Canvas.jsx';
import { IconSvg } from './Canvas.jsx';
import { brl, maskPhone } from '../../lib/format.js';
import { track } from '../../lib/portfolio/pixel.js';

// Catálogo digital (duas páginas): início com os produtos e carrinho com a finalização do pedido.

// ---------------------------------------------------------------- carrinho (guardado no aparelho do cliente)
export function useCart(slug) {
  const key = `dm:cart:${slug}`;
  const [items, setItems] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key)) || [];
      const merged = new Map();
      for (const item of saved) {
        const id = `${item.productId}:${item.imageId || 0}:0`;
        const old = merged.get(id);
        merged.set(id, { id, productId: item.productId, imageId: item.imageId || null, qty: Math.min(99, (old?.qty || 0) + (Number(item.qty) || 1)) });
      }
      return [...merged.values()];
    } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* sem armazenamento: o carrinho vale só nesta visita */ } }, [key, items]);
  const idOf = (productId, imageId) => `${productId}:${imageId || 0}:0`;
  return {
    items,
    add: (productId, imageId, _priceOptionId, qty = 1) => setItems((l) => {
      const id = idOf(productId, imageId);
      const f = l.find((x) => x.id === id);
      return f ? l.map((x) => (x.id === id ? { ...x, qty: Math.min(99, x.qty + qty) } : x)) : [...l, { id, productId, imageId: imageId || null, qty: Math.min(99, qty) }];
    }),
    setQty: (id, qty) => setItems((l) => (qty < 1 ? l.filter((x) => x.id !== id) : l.map((x) => (x.id === id ? { ...x, qty: Math.min(99, qty) } : x)))),
    remove: (id) => setItems((l) => l.filter((x) => x.id !== id)),
    clear: () => setItems([]),
  };
}

// Junta o carrinho com os dados atuais dos produtos (preço e imagem sempre vêm do cadastro).
export function priced(items, products) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [];
  for (const it of items) {
    const p = byId.get(it.productId);
    if (!p) continue;
    const img = p.images.find((i) => i.id === it.imageId) || null;
    const staleSelection = Boolean(it.imageId && !img);
    const priceOption = [...p.priceOptions]
      .filter((option) => (option.minQuantity || 1) <= it.qty)
      .sort((a, b) => (b.minQuantity || 1) - (a.minQuantity || 1))[0] || null;
    const unit = staleSelection ? 0 : priceOption ? priceOption.priceCents ?? 0 : img && img.priceCents !== null ? img.priceCents : p.priceCents;
    lines.push({ ...it, p, img, priceOption, staleSelection, unit, total: unit * it.qty });
  }
  return { lines, subtotal: lines.reduce((s, l) => s + l.total, 0), count: lines.reduce((s, l) => s + l.qty, 0) };
}

const Qty = ({ value, onChange, label }) => (
  <span className="cat-qty" role="group" aria-label={label}>
    <button type="button" onClick={() => onChange(value - 1)} aria-label="Diminuir">−</button>
    <span aria-live="polite">{value}</span>
    <button type="button" onClick={() => onChange(value + 1)} aria-label="Aumentar">+</button>
  </span>
);

// ---------------------------------------------------------------- início: busca, categorias e produtos
function ProductModal({ p, addLabel, onAdd, onClose }) {
  const [idx, setIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const img = p.images[idx] || p.images[0];
  const priceOption = [...p.priceOptions]
    .filter((option) => (option.minQuantity || 1) <= qty)
    .sort((a, b) => (b.minQuantity || 1) - (a.minQuantity || 1))[0] || null;
  const unit = priceOption ? priceOption.priceCents ?? 0 : img && img.priceCents !== null ? img.priceCents : p.priceCents;
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="cat-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cat-modal" role="dialog" aria-modal="true" aria-label={p.name}>
        <button type="button" className="cat-x" onClick={onClose} aria-label="Fechar">×</button>
        <div className="cat-modal-img">{img && <img src={img.url} alt={p.name} />}</div>
        <div className="cat-modal-body">
          <span className="pv-card-cat">{p.category}</span>
          <h2>{p.name}</h2>
          {p.images.length > 1 && (
            <div className="cat-vars" role="radiogroup" aria-label="Variação">
              {p.images.map((i, n) => (
                <button key={i.id} type="button" role="radio" aria-checked={n === idx} className={`cat-var${n === idx ? ' is-on' : ''}`} onClick={() => setIdx(n)}>
                  <img src={i.url} alt="" /><span>{i.label}</span>
                </button>
              ))}
            </div>
          )}
          {p.priceOptions.length > 0 && <div className="cat-price-options" aria-label="Valores por quantidade">
            <strong>Descontos por quantidade</strong>
            {p.priceOptions.map((option) => <span key={option.id}>{option.label} a partir de {option.minQuantity || 1} un. — {option.priceCents === null ? 'Sob consulta' : `${brl(option.priceCents)} cada`}</span>)}
            <small>O valor correspondente é aplicado automaticamente no carrinho.</small>
          </div>}
          {p.description && <p className="cat-desc">{p.description}</p>}
          <div className="cat-buy">
            <strong className="cat-price">{unit > 0 ? brl(unit) : 'Sob consulta'}</strong>
            <Qty value={qty} onChange={(n) => setQty(Math.max(1, Math.min(99, n)))} label="Quantidade" />
          </div>
          <button type="button" className="cat-btn" onClick={() => { onAdd(p, img, qty); onClose(); }}>{addLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function CatalogHome({ doc, products, cart, onOpenCart, pixelOn }) {
  const cfg = doc.catalog;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState(null);
  const only = cfg.display === 'only' && cfg.onlyCategory ? cfg.onlyCategory : '';
  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [products]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products.filter((p) => (!only || p.category === only) && (!cat || p.category === cat) && (!t || p.name.toLowerCase().includes(t) || p.category.toLowerCase().includes(t)));
  }, [products, q, cat, only]);

  const groups = useMemo(() => {
    if (cfg.display !== 'category') return [{ title: '', list: [...shown].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) }];
    const m = new Map();
    for (const p of shown) { if (!m.has(p.category)) m.set(p.category, []); m.get(p.category).push(p); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([title, list]) => ({ title, list }));
  }, [shown, cfg.display]);

  const { count, subtotal } = priced(cart.items, products);
  const add = (p, img, qty) => {
    cart.add(p.id, p.images.length > 1 ? img?.id : null, null, qty);
    const tier = [...p.priceOptions]
      .filter((option) => (option.minQuantity || 1) <= qty)
      .sort((a, b) => (b.minQuantity || 1) - (a.minQuantity || 1))[0];
    const unit = tier ? tier.priceCents || 0 : img && img.priceCents !== null ? img.priceCents : p.priceCents;
    if (pixelOn) track('AddToCart', { value: (unit * qty) / 100, name: p.name, id: p.id });
  };
  const view = (p) => { setOpen(p); if (pixelOn) track('ViewContent', { value: minPrice(p) / 100, name: p.name, id: p.id }); };
  const cols = cfg.columns;

  return (
    <section className="cat-home" style={{ '--cd': cols.desktop, '--ct': cols.tablet, '--cm': cols.mobile }}>
      {(cfg.showSearch || (cfg.showCategories && !only && categories.length > 1)) && (
        <div className="cat-tools">
          {cfg.showSearch && <input className="cat-search" type="search" placeholder="Buscar produtos" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produtos" />}
          {cfg.showCategories && !only && categories.length > 1 && (
            <div className="cat-chips" role="group" aria-label="Categorias">
              <button type="button" className={`cat-chip${!cat ? ' is-on' : ''}`} onClick={() => setCat('')}>Todas</button>
              {categories.map((c) => <button key={c} type="button" className={`cat-chip${cat === c ? ' is-on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
            </div>
          )}
        </div>
      )}
      {!shown.length ? <p className="cat-empty">{products.length ? 'Nenhum produto encontrado.' : 'Em breve novidades por aqui.'}</p> : groups.map((g) => (
        <div key={g.title || 'all'} className="cat-group">
          {g.title && <h2 className="cat-group-title">{g.title}</h2>}
          <div className="cat-grid">
            {g.list.map((p) => (
              <button key={p.id} type="button" className="cat-card" onClick={() => view(p)} aria-label={`Ver ${p.name}`}>
                <ProductCard p={p} cardStyle={cfg.cardStyle} action={<span className="pv-card-btn">{cfg.addLabel}</span>} />
              </button>
            ))}
          </div>
        </div>
      ))}
      {count > 0 && (
        <button type="button" className="cat-cartbar" onClick={onOpenCart}>
          <IconSvg name="cart" size={20} /><span>Ver carrinho ({count})</span><strong>{brl(subtotal)}</strong>
        </button>
      )}
      {open && <ProductModal p={open} addLabel={cfg.addLabel} onAdd={add} onClose={() => setOpen(null)} />}
    </section>
  );
}

// ---------------------------------------------------------------- carrinho e finalização
const cepMask = (v) => { const d = v.replace(/\D/g, '').slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
const TYPES = [['retirada', 'Retirada', 'Retire o pedido no endereço da loja.'], ['motoboy', 'Motoboy', 'Entrega na sua cidade por motoboy.'], ['excursao', 'Excursão', 'Você informa o galpão; o frete é combinado com a loja.'], ['correios', 'Correios', 'Envio pelos Correios (PAC, SEDEX...).']];
const loadCustomer = (slug) => {
  try {
    const value = JSON.parse(localStorage.getItem(`dm:checkout:${slug}`));
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
};

export function CartPage({ doc, products, store, slug, cart, onBack, pixelOn }) {
  const cfg = doc.catalog;
  const { lines, subtotal } = priced(cart.items, products);
  const enabled = TYPES.filter(([key]) => (key === 'excursao' ? store.excursion : store[key])?.enabled);
  const [saved] = useState(() => loadCustomer(slug));
  const skipNextSave = useRef(false);
  const [customerRevision, setCustomerRevision] = useState(0);
  const [name, setName] = useState(saved.name || '');
  const [phone, setPhone] = useState(saved.phone || '');
  const [type, setType] = useState(enabled.some(([key]) => key === saved.type) ? saved.type : enabled[0]?.[0] || '');
  const [exc, setExc] = useState(saved.exc || { warehouse: '', city: '', address: '' });
  const [addr, setAddr] = useState(saved.addr || { zip: '', street: '', number: '', district: '', city: '', state: '', complement: '' });
  const [quote, setQuote] = useState(null); // { options, provider }
  const [serviceId, setServiceId] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const tracked = useRef(false);
  const clearSavedCustomer = () => {
    try { localStorage.removeItem(`dm:checkout:${slug}`); } catch { /* Dados locais indisponíveis. */ }
    skipNextSave.current = true;
    setCustomerRevision((revision) => revision + 1);
    setName('');
    setPhone('');
    setType(enabled[0]?.[0] || '');
    setExc({ warehouse: '', city: '', address: '' });
    setAddr({ zip: '', street: '', number: '', district: '', city: '', state: '', complement: '' });
  };

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    try { localStorage.setItem(`dm:checkout:${slug}`, JSON.stringify({ name, phone, type, exc, addr })); } catch { /* Dados mantidos apenas durante esta visita. */ }
  }, [slug, name, phone, type, exc, addr, customerRevision]);
  useEffect(() => { if (pixelOn && lines.length && !tracked.current) { tracked.current = true; track('InitiateCheckout', { value: subtotal / 100 }); } }, [pixelOn, lines.length, subtotal]);
  useEffect(() => { setQuote(null); setQuoteErr(''); setServiceId(''); }, [type, addr.zip, addr.street, addr.city, addr.number, subtotal]);

  const setA = (k) => (e) => setAddr((a) => ({ ...a, [k]: e.target.value }));

  async function fillZip(zip) {
    const d = zip.replace(/\D/g, '');
    if (d.length !== 8) return;
    try {
      const { address } = await api.get(`/public/cep/${d}`);
      setAddr((a) => ({ ...a, street: a.street || address.street, district: a.district || address.district, city: a.city || address.city, state: a.state || address.state }));
    } catch (e) { setQuoteErr(e.message); }
  }

  async function calc() {
    setQuoting(true); setQuoteErr('');
    try {
      const body = { u: slug, type, subtotalCents: subtotal, ...(type === 'correios' ? { zip: addr.zip } : addr) };
      const r = await api.post('/public/catalog/shipping/quote', body);
      setQuote(r);
      setServiceId(r.options[0]?.id || '');
      if (type === 'motoboy') setAddr((a) => ({ ...a, street: a.street || r.address.street || '', district: a.district || r.address.district || '', city: a.city || r.address.city || '', state: a.state || r.address.state || '' }));
    } catch (e) { setQuoteErr(e.message); } finally { setQuoting(false); }
  }

  const option = quote?.options.find((o) => o.id === serviceId) || null;
  const shipping = type === 'excursao' ? 0 : option?.priceCents ?? null;
  const total = subtotal + (shipping || 0);
  const needsQuote = type === 'motoboy' || type === 'correios';
  const zipOk = addr.zip.replace(/\D/g, '').length === 8;
  const canQuote = type === 'correios' ? zipOk : zipOk || (addr.street.trim() && addr.city.trim());

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!lines.length) return setError('O carrinho está vazio.');
    if (name.trim().length < 2) return setError('Informe o seu nome.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Informe o seu telefone com DDD.');
    if (!type) return setError('Escolha a forma de entrega.');
    if (type === 'retirada' && !store.pickup?.enabled) return setError('A retirada não está disponível nesta loja.');
    if (type === 'excursao' && (exc.warehouse.trim().length < 2 || exc.city.trim().length < 2 || exc.address.trim().length < 3)) return setError('Excursão: informe o nome do galpão, a cidade e o endereço do galpão.');
    if (type === 'motoboy' && !canQuote) return setError('Motoboy: informe o CEP ou o endereço de entrega.');
    if (type === 'correios' && !zipOk) return setError('Correios: informe o CEP de destino.');
    if (needsQuote && !option) return setError('Calcule o frete antes de finalizar.');
    setBusy(true);
    try {
      const delivery = type === 'retirada' ? { type }
        : type === 'excursao' ? { type, ...exc }
          : type === 'motoboy' ? { type, ...addr }
            : { type, zip: addr.zip, number: addr.number, complement: addr.complement, serviceId };
      const r = await api.post(`/webhooks/orders/${encodeURIComponent(slug)}`, {
        customer: { name, phone }, delivery, notes, items: lines.map((l) => ({ productId: l.productId, imageId: l.imageId, qty: l.qty })),
      });
      if (pixelOn) track('Purchase', { value: r.order.totalCents / 100, transaction: r.order.code });
      cart.clear();
      setDone(r);
      window.scrollTo({ top: 0 });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <section className="cat-cart cat-done">
        <div className="cat-doneicon"><IconSvg name="check-circle" size={56} color="var(--p)" /></div>
        <h1>Pedido enviado!</h1>
        <p>Seu pedido <strong>#{done.order.code}</strong> foi registrado. Total: <strong>{brl(done.order.totalCents)}</strong>{done.order.deliveryType === 'excursao' ? ' + frete a combinar' : ''}.</p>
        <p className="cat-muted">A loja vai entrar em contato pelo telefone informado.</p>
        {done.whatsappUrl && <a className="cat-btn" href={done.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => pixelOn && track('Contact')}>Enviar o pedido pelo WhatsApp</a>}
        <button type="button" className="cat-btn cat-btn-ghost" onClick={onBack}>Voltar ao catálogo</button>
      </section>
    );
  }

  const minimumItems = Number(store.checkout?.minItems) || 1;
  const minimumSubtotal = Number(store.checkout?.minSubtotalCents) || 0;
  const itemCount = lines.reduce((total, line) => total + line.qty, 0);
  const itemsMet = itemCount >= minimumItems;
  const subtotalMet = subtotal >= minimumSubtotal;
  const meetsMinimum = itemsMet && subtotalMet;
  const progress = Math.round(Math.min(1, minimumItems > 0 ? itemCount / minimumItems : 1, minimumSubtotal > 0 ? subtotal / minimumSubtotal : 1) * 100);
  return (
    <section className={`cat-cart is-${cfg.cartLayout || 'standard'}`}>
      <button type="button" className="cat-back" onClick={onBack}>← Continuar comprando</button>
      <h1>{cfg.cartTitle}</h1>
      {cfg.cartButtonLabel && cfg.cartButtonUrl && <a className="cat-btn cat-btn-custom" href={cfg.cartButtonUrl} target="_blank" rel="noopener noreferrer">{cfg.cartButtonLabel}</a>}
      {!lines.length ? <p className="cat-empty">Seu carrinho está vazio.</p> : (
        <form className="cat-form" onSubmit={submit} noValidate>
          <ul className="cat-lines">
            {lines.map((l) => (
              <li key={l.id}>
                <span className="cat-line-img">{(l.img || l.p.images[0]) && <img src={(l.img || l.p.images[0]).url} alt="" />}</span>
                <span className="cat-line-info"><strong>{l.p.name}</strong>{l.img?.label && <small>{l.img.label}</small>}{l.priceOption && <small>{l.priceOption.label} · a partir de {l.priceOption.minQuantity || 1} un.</small>}{l.staleSelection ? <small className="cat-error">Esta opção mudou. Remova e adicione o item novamente.</small> : <small>{l.unit > 0 ? `${brl(l.unit)} cada` : 'Sob consulta'}</small>}</span>
                <Qty value={l.qty} onChange={(n) => cart.setQty(l.id, n)} label={`Quantidade de ${l.p.name}`} />
                <strong className="cat-line-total">{brl(l.total)}</strong>
                <button type="button" className="cat-line-x" onClick={() => cart.remove(l.id)} aria-label={`Remover ${l.p.name}`}>×</button>
              </li>
            ))}
          </ul>

          <h2>Seus dados</h2>
          <p className="cat-saved-hint">Seus dados de contato e endereço são salvos apenas neste aparelho para agilizar os próximos pedidos. <button type="button" onClick={clearSavedCustomer}>Apagar dados salvos</button></p>
          <div className="cat-fields">
            <label><span>Nome *</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" /></label>
            <label><span>Telefone (WhatsApp) *</span><input value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} inputMode="tel" placeholder="(85) 99999-9999" autoComplete="tel" /></label>
          </div>

          <h2>Entrega</h2>
          {!enabled.length ? <p className="cat-error">Esta loja ainda não configurou as formas de entrega. Fale com a loja pelo WhatsApp.</p> : (
            <div className="cat-types" role="radiogroup" aria-label="Forma de entrega">
              {enabled.map(([k, label, hint]) => (
                <label key={k} className={`cat-type${type === k ? ' is-on' : ''}`}>
                  <input type="radio" name="delivery" checked={type === k} onChange={() => setType(k)} />
                  <strong>{label}</strong><small>{hint}</small>
                </label>
              ))}
            </div>
          )}

          {type === 'retirada' && <div className="cat-pickup-info"><IconSvg name="map-pin" size={22} /><span><strong>{store.pickup?.name || store.storeName || 'Retirada na loja'}</strong><small>{store.pickup?.address}</small></span></div>}
          {type === 'excursao' && (
            <div className="cat-fields">
              <label><span>Nome do galpão *</span><input value={exc.warehouse} onChange={(e) => setExc({ ...exc, warehouse: e.target.value })} maxLength={120} /></label>
              <label><span>Cidade do galpão *</span><input value={exc.city} onChange={(e) => setExc({ ...exc, city: e.target.value })} maxLength={80} /></label>
              <label className="wide"><span>Endereço do galpão *</span><input value={exc.address} onChange={(e) => setExc({ ...exc, address: e.target.value })} maxLength={200} /></label>
            </div>
          )}

          {needsQuote && (
            <>
              <div className="cat-fields">
                <label><span>{type === 'correios' ? 'CEP de destino *' : 'CEP'}</span>
                  <input value={addr.zip} onChange={(e) => { const v = cepMask(e.target.value); setAddr((a) => ({ ...a, zip: v })); if (type === 'motoboy' && v.replace(/\D/g, '').length === 8) fillZip(v); }} inputMode="numeric" placeholder="00000-000" autoComplete="postal-code" />
                </label>
                {type === 'motoboy' && (
                  <>
                    <label className="wide"><span>Rua</span><input value={addr.street} onChange={setA('street')} maxLength={120} autoComplete="address-line1" /></label>
                    <label><span>Número</span><input value={addr.number} onChange={setA('number')} maxLength={20} /></label>
                    <label><span>Bairro</span><input value={addr.district} onChange={setA('district')} maxLength={80} /></label>
                    <label><span>Cidade</span><input value={addr.city} onChange={setA('city')} maxLength={80} /></label>
                    <label><span>Estado</span><input value={addr.state} onChange={(e) => setAddr((a) => ({ ...a, state: e.target.value.toUpperCase().slice(0, 2) }))} maxLength={2} /></label>
                  </>
                )}
                {type === 'correios' && (
                  <>
                    <label><span>Número</span><input value={addr.number} onChange={setA('number')} maxLength={20} /></label>
                    <label><span>Complemento</span><input value={addr.complement} onChange={setA('complement')} maxLength={80} /></label>
                  </>
                )}
              </div>
              {type === 'motoboy' && <p className="cat-muted">Informe o CEP ou o endereço completo (o resto é preenchido sozinho).</p>}
              <button type="button" className="cat-btn cat-btn-ghost" onClick={calc} disabled={quoting || !canQuote}>{quoting ? 'Calculando...' : 'Calcular frete'}</button>
              {quoteErr && <p className="cat-error" role="alert">{quoteErr}</p>}
              {quote && (
                <div className="cat-quote">
                  {quote.options.map((o) => (
                    <label key={o.id} className={`cat-opt${serviceId === o.id ? ' is-on' : ''}`}>
                      <input type="radio" name="service" checked={serviceId === o.id} onChange={() => setServiceId(o.id)} />
                      <span><strong>{o.name}</strong>{o.days && <small>até {o.days.max} {o.days.max === 1 ? 'dia útil' : 'dias úteis'}</small>}{o.km ? <small>{String(o.km).replace('.', ',')} km{o.approx ? ' (aproximado)' : ''}</small> : null}</span>
                      <strong>{brl(o.priceCents)}</strong>
                    </label>
                  ))}
                  {quote.provider && <small className="cat-muted">Frete simulado pelo {quote.provider}.</small>}
                </div>
              )}
            </>
          )}

          <label className="cat-notes"><span>Observações (opcional)</span><textarea rows={2} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></label>
          {cfg.checkoutNote && <p className="cat-muted cat-note">{cfg.checkoutNote}</p>}

          <div className="cat-totals">
            <span>Subtotal <strong>{brl(subtotal)}</strong></span>
            <span>Frete <strong>{type === 'excursao' ? 'a combinar' : shipping === null ? '—' : brl(shipping)}</strong></span>
            <span className="cat-grand">Total <strong>{brl(total)}{type === 'excursao' ? ' + frete' : ''}</strong></span>
          </div>
          {!meetsMinimum && <div className="cat-checkout-progress" role="status" aria-live="polite">
            <div className="cat-checkout-progress-head"><strong>Quase lá!</strong><span>{progress}%</span></div>
            <div className="cat-progress-track"><span style={{ width: `${progress}%` }} /></div>
            <ul>
              {!itemsMet && <li>Adicione mais {minimumItems - itemCount} {minimumItems - itemCount === 1 ? 'item' : 'itens'} para atingir o mínimo de {minimumItems}.</li>}
              {!subtotalMet && <li>Faltam {brl(minimumSubtotal - subtotal)} para atingir o valor mínimo.</li>}
            </ul>
          </div>}
          {error && <p className="cat-error" role="alert">{error}</p>}
          <button className={`cat-btn cat-submit${!meetsMinimum ? ' is-locked' : ''}`} disabled={busy || !enabled.length || !meetsMinimum || lines.some((line) => line.staleSelection)}>{busy ? 'Enviando...' : !meetsMinimum ? 'Continue adicionando para finalizar' : 'Finalizar pedido'}</button>
        </form>
      )}
    </section>
  );
}

// Cartões da vitrine pública usam o mesmo `useCallback` de navegação do carrinho pela barra de endereço.
export function useCartView(cartLink = 'carrinho') {
  const key = /^[a-z0-9_-]{1,24}$/i.test(cartLink) ? cartLink : 'carrinho';
  const read = () => { const qs = new URLSearchParams(window.location.search); return qs.has(key) || qs.has('carrinho'); };
  const [cartOpen, setCartOpen] = useState(read);
  useEffect(() => {
    const on = () => setCartOpen(read());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = useCallback((open) => {
    const url = new URL(window.location.href);
    if (open) url.searchParams.set(key, '1'); else { url.searchParams.delete(key); url.searchParams.delete('carrinho'); }
    window.history.pushState({}, '', url);
    setCartOpen(open);
    window.scrollTo({ top: 0 });
  }, [key]);
  return [cartOpen, go];
}
