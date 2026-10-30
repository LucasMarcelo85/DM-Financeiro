import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isShopMode } from '../api.js';
import BuyMore from '../components/BuyMore.jsx';
import StoreBar from '../components/StoreBar.jsx';
import ProductWorkspace from '../components/ProductWorkspace.jsx';
import Icon from '../components/Icon.jsx';
import CsvTransfer from '../components/CsvTransfer.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { IMAGE_ACCEPT } from '../lib/contract/image.js';
import { brl, centsToMasked, maskMoney, moneyToCents, plural } from '../lib/format.js';
import { prepareProductImage } from '../lib/portfolio/imageTools.js';
import InventoryManager from '../components/InventoryManager.jsx';

// Cadastro de produtos e serviços: usados no catálogo digital e nos cartões de produtos do portfólio.
const MAX_IMAGES = 12;
const PRODUCT_VIEW_KEY = 'dm:products:view';
const DEFAULT_PRODUCT_VIEW = { cardWidth: 208, imageHeight: 150 };
const PRODUCT_CSV_COLUMNS = [
  { key: 'kind', type: 'string' }, { key: 'name', type: 'string' }, { key: 'category', type: 'string' },
  { key: 'description', type: 'string' }, { key: 'priceCents', type: 'number' },
  { key: 'stockEnabled', type: 'boolean' }, { key: 'stockQuantity', type: 'number' },
  { key: 'active', type: 'boolean' }, { key: 'mainImage', type: 'json' },
  { key: 'images', type: 'json' }, { key: 'priceOptions', type: 'json' },
  { key: 'sourceId', type: 'number' }, { key: 'sourceUserId', type: 'number' },
  { key: 'sourceStoreId', type: 'number' },
];

function productPriceLabel(product) {
  if (product.priceCents > 0) return brl(product.priceCents);
  const tier = [...product.priceOptions]
    .filter((option) => option.priceCents !== null)
    .sort((a, b) => (a.minQuantity || 1) - (b.minQuantity || 1))[0];
  if (tier) return `A partir de ${brl(tier.priceCents)} · ${tier.scope === 'cart_value' ? `carrinho ${brl(tier.minCartCents)}` : `${tier.minQuantity || 1} un.`}`;
  return 'Sob consulta';
}

export default function Products({ allow = [] }) {
  const shop = isShopMode();
  const canManageProducts = !shop || allow.includes('produtos');
  const canManageStock = !shop || allow.includes('estoque');
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | produto
  const [confirmDel, setConfirmDel] = useState(null);
  const [managePreferences, setManagePreferences] = useState(false);
  const [manageInventory, setManageInventory] = useState(false);
  const [batchDrafts, setBatchDrafts] = useState([]);
  const [cardView, setCardView] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PRODUCT_VIEW_KEY) || '{}');
      return {
        cardWidth: Math.min(360, Math.max(160, Number(saved.cardWidth) || DEFAULT_PRODUCT_VIEW.cardWidth)),
        imageHeight: Math.min(280, Math.max(90, Number(saved.imageHeight) || DEFAULT_PRODUCT_VIEW.imageHeight)),
      };
    } catch {
      return DEFAULT_PRODUCT_VIEW;
    }
  });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (category) qs.set('category', category);
    if (kind) qs.set('kind', kind);
    return api.get(`/products?${qs}`).then((r) => alive.current && setData(r)).catch((e) => toast(e.message, 'error'));
  }, [q, category, kind, toast]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { localStorage.setItem(PRODUCT_VIEW_KEY, JSON.stringify(cardView)); }, [cardView]);

  const blocked = data && data.limit < 1;
  const full = data && data.limit > 0 && data.count >= data.limit;

  if (editing) return (
    <>
      <StoreBar />
      <ProductWorkspace
        product={editing === 'new' ? null : editing}
        categories={data?.categories || []}
        preferences={data?.preferences}
        available={Math.max(0, (data?.limit || 0) - (data?.count || 0))}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    </>
  );

  async function toggle(p) {
    try { await api.patch(`/products/${p.id}`, { active: !p.active }); load(); } catch (e) { toast(e.message, 'error'); }
  }
  async function remove(p) {
    setConfirmDel(null);
    try { await api.del(`/products/${p.id}`); toast('Excluído.'); load(); } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <>
      <header className="page-head head-row rounded-2xl border border-slate-200 bg-gradient-to-r from-white to-slate-50 p-5 shadow-sm">
        <div>
          <h1>Produtos e serviços</h1>
          <p className="muted">
            Cadastre o que você vende. Eles aparecem no catálogo digital e nos cartões de produtos do portfólio.
            {data && data.limit > 0 ? ` Você usou ${data.count} de ${plural(data.limit, 'item', 'itens')} do seu plano.` : ''}
          </p>
        </div>
        <div className="btn-group">
          {canManageProducts && <CsvTransfer
            resource="products" title="produtos" filename="produtos.csv" exportUrl="/products/export"
            columns={PRODUCT_CSV_COLUMNS}
            description="Exporte produtos e serviços com descrições, preços, estoque, faixas de preço, variações e imagens."
            onImport={async (products) => {
              const result = await importCsvBatches(products, (batch) => api.post('/products/import', { products: batch }), 500, 25 * 1024 * 1024);
              load();
              return result;
            }}
          />}
          {canManageStock && <button className="btn btn-ghost shadow-sm" onClick={() => setManageInventory(true)}><Icon name="box" size={18} /> Estoques</button>}
          {canManageProducts && <button className="btn btn-primary shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => setEditing('new')} disabled={!data || blocked || full}><Icon name="plus" size={18} /> Novo produto</button>}
        </div>
      </header>
      <StoreBar />
      {data && <div className="pr-toolbar rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="pr-view-control"><span>Tamanho dos cards <strong>{cardView.cardWidth}px</strong></span><input type="range" min="160" max="360" step="8" value={cardView.cardWidth} onChange={(e) => setCardView((v) => ({ ...v, cardWidth: Number(e.target.value) }))} aria-label="Largura dos cards de produtos" /></label>
        <label className="pr-view-control"><span>Altura das fotos <strong>{cardView.imageHeight}px</strong></span><input type="range" min="90" max="280" step="10" value={cardView.imageHeight} onChange={(e) => setCardView((v) => ({ ...v, imageHeight: Number(e.target.value) }))} aria-label="Altura das fotos dos produtos" /></label>
        {!shop && <button className="btn btn-ghost btn-sm" onClick={() => setManagePreferences(true)}>Organizar categorias e opções</button>}
      </div>}

      {blocked && (
        <div className="banner banner-amber">
          <div><strong>O seu plano não inclui produtos e catálogo digital.</strong><span>Mude para um plano com catálogo para cadastrar produtos e serviços.</span></div>
          {!shop && <Link className="btn btn-ghost btn-sm" to="/plano">Ver planos</Link>}
        </div>
      )}
      {full && !blocked && (
        <div className="banner banner-amber">
          <div><strong>{shop ? 'Você atingiu o limite de produtos liberado para este app.' : 'Você usou todos os itens do seu plano.'}</strong><span>{shop ? 'Peça ao criador do aplicativo para ajustar o limite.' : 'Exclua algum, adquira limite extra ou mude de plano para cadastrar mais.'}</span></div>
          {!shop && <BuyMore resource="catalogProducts" />}
          {!shop && <Link className="btn btn-ghost btn-sm" to="/plano">Ver planos</Link>}
        </div>
      )}

      {data && data.count > 0 && (
        <div className="pr-filters rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <input className="input" type="search" placeholder="Buscar por nome ou categoria" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
            <option value="">Produtos e serviços</option>
            <option value="produto">Só produtos</option>
            <option value="servico">Só serviços</option>
          </select>
        </div>
      )}

      {data === null ? <p className="muted">Carregando...</p> : data.products.length === 0 ? (
        <section className="empty-hero">
          <span className="action-icon action-icon-lg"><Icon name="box" size={32} /></span>
          <h2>{data.count ? 'Nada encontrado' : 'Cadastre o primeiro produto ou serviço'}</h2>
          <p>{data.count ? 'Tente outra busca ou outro filtro.' : 'Cadastre nome e categoria; fotos, variações e faixas de preço são opcionais.'}</p>
          {!data.count && !blocked && canManageProducts && <button className="btn btn-primary" onClick={() => setEditing('new')}>Cadastrar</button>}
        </section>
      ) : (
        <ul className="pr-grid gap-4" style={{ '--pr-card-width': `${cardView.cardWidth}px`, '--pr-image-height': `${cardView.imageHeight}px` }}>
          {data.products.map((p) => (
            <li key={p.id} className={`pr-card rounded-xl border-slate-200 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${p.active ? '' : 'is-off'}`}>
              <button type="button" className="pr-img transition duration-200 hover:brightness-95" onClick={() => canManageProducts && setEditing(p)} disabled={!canManageProducts} aria-label={`Editar ${p.name}`}>
                {(p.mainImage || p.images[0]) ? <img src={(p.mainImage || p.images[0]).url} alt="" loading="lazy" /> : <Icon name="box" size={28} />}
                {p.images.length > 0 && <span className="pr-var">{p.images.length} {plural(p.images.length, 'variação', 'variações')}</span>}
              </button>
              <div className="pr-body">
                <span className="pr-cat">{p.category}<em>{p.kind === 'servico' ? 'Serviço' : 'Produto'}</em></span>
                <strong title={p.name}>{p.name}</strong>
                <span className="pr-price">{productPriceLabel(p)}</span>
                {p.priceOptions.length > 0 && <small className="muted">{p.priceOptions.length} formas de preço</small>}
                {p.stockEnabled && <small className="muted">Estoque: {p.images.length ? p.images.reduce((sum, image) => sum + image.stockQuantity, 0) : p.stockQuantity}</small>}
              </div>
              <div className="pr-actions">
                {canManageProducts && <>
                  <label className="pr-switch" title={p.active ? 'Visível no catálogo' : 'Escondido do catálogo'}>
                    <input type="checkbox" checked={p.active} onChange={() => toggle(p)} /><span>{p.active ? 'Ativo' : 'Inativo'}</span>
                  </label>
                  <button type="button" className="icon-btn pr-card-action" onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`} title="Editar"><Icon name="edit" size={17} /><span>Editar</span></button>
                  {!shop && <button type="button" className="icon-btn icon-btn-danger pr-card-action" onClick={() => setConfirmDel(p)} aria-label={`Excluir ${p.name}`} title="Excluir"><Icon name="trash" size={17} /><span>Excluir</span></button>}
                </>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {managePreferences && <ProductPreferencesModal preferences={data?.preferences} onClose={() => setManagePreferences(false)} onSaved={(preferences) => {
        setData((current) => current ? { ...current, preferences } : current);
        setManagePreferences(false);
        toast('Opções salvas.');
        load();
      }} />}
      {manageInventory && <InventoryManager onClose={() => { setManageInventory(false); load(); }} />}
      {confirmDel && (
        <Modal title="Excluir este item?" onClose={() => setConfirmDel(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => remove(confirmDel)}>Excluir</button></>}>
          <p><strong>{confirmDel.name}</strong> será apagado do catálogo e das páginas onde aparece. Pedidos já feitos continuam guardados. Não dá para desfazer.</p>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- formulário
function ProductForm({ product, categories, preferences, onClose, onSaved, batchDrafts = [], setBatchDrafts = () => {} }) {
  const toast = useToast();
  const editing = Boolean(product);
  const steps = ['Fotos', 'Variações', 'Preços', 'Estoque', 'Detalhes'];
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState(product?.kind || 'produto');
  const [name, setName] = useState(product?.name || '');
  const [category, setCategory] = useState(product?.category || '');
  const [description, setDescription] = useState(product?.description || '');
  const [price, setPrice] = useState(product ? centsToMasked(product.priceCents) : '');
  const [priceOptions, setPriceOptions] = useState(() => (product?.priceOptions || []).map((option) => ({
    id: option.id,
    key: `price-${option.id}`,
    label: option.label,
    price: option.priceCents === null ? '' : centsToMasked(option.priceCents),
    minQuantity: String(option.minQuantity || 1),
    scope: option.scope || 'same_product',
    minCartValue: centsToMasked(option.minCartCents || 0),
  })));
  const [stockEnabled, setStockEnabled] = useState(Boolean(product?.stockEnabled));
  const [stockQuantity, setStockQuantity] = useState(String(product?.stockQuantity || 0));
  const [moreProductPhotos, setMoreProductPhotos] = useState([]);
  const [active, setActive] = useState(product ? product.active : true);
  const [varied, setVaried] = useState(editing
    ? (product?.images.length || 0) > 0
    : (product?.images.length || 0) > 1 || Boolean(product?.images.some((image) => image.label || image.color || image.size)));
  const [images, setImages] = useState(() => (product?.images || []).map((i) => ({
    key: `i${i.id}`, id: i.id, url: i.url,
    color: i.color || (!i.size ? i.label : ''), colorHex: i.colorHex || '', size: i.size || '',
    stockQuantity: String(i.stockQuantity || 0),
  })));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const batchFileRef = useRef(null);
  const target = useRef(null); // índice da imagem a trocar (ou null = adicionar)

  const visible = useMemo(() => images.slice(0, MAX_IMAGES), [images]);

  async function onFile(file) {
    if (!file) return;
    const imageIndex = target.current;
    target.current = null;
    setUploading(true); setError('');
    try {
      const { src } = await prepareProductImage(file);
      setImages((list) => {
        const item = { key: `n${Date.now()}${Math.random()}`, data: src, url: src, color: '', colorHex: '', size: '', stockQuantity: '0' };
        if (imageIndex !== null && list[imageIndex]) return list.map((x, n) => (n === imageIndex ? { ...x, id: undefined, data: src, url: src } : x));
        return [...list, item].slice(0, MAX_IMAGES);
      });
    } catch (e) { setError(e.message); } finally { setUploading(false); }
  }
  const pick = (i) => { target.current = i; fileRef.current?.click(); };
  const setImg = (i, patch) => setImages((list) => list.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  async function onBatchPhotos(files) {
    const reserveCurrent = images.length || name.trim() ? 1 : 0;
    const available = Math.max(0, 30 - batchDrafts.length - moreProductPhotos.length - reserveCurrent);
    const selected = [...files];
    if (!selected.length) return;
    if (selected.length > available) return setError(`Você pode incluir mais ${available} foto(s) para o lote, que aceita até 30 produtos.`);
    setUploading(true);
    setError('');
    try {
      const prepared = [];
      for (const file of selected) {
        const { src } = await prepareProductImage(file);
        prepared.push({ key: `n${Date.now()}${Math.random()}`, data: src, url: src, color: '', colorHex: '', size: '', stockQuantity: '0' });
      }
      if (!images.length && !name.trim()) {
        setImages((current) => current.length ? current : [prepared[0]]);
        setMoreProductPhotos((current) => [...current, ...prepared.slice(1)]);
      } else {
        setMoreProductPhotos((current) => [...current, ...prepared]);
      }
    } catch (e) { setError(e.message); } finally { setUploading(false); }
  }

  function continueStep() {
    setError('');
    if (step === 1 && varied && visible.some((image) => !image.id && !image.color.trim() && !image.size.trim())) {
      return setError('Preencha cor ou tamanho para cada variação com foto, ou remova a foto sem variação.');
    }
    if (step === 2 && priceOptions.some((option) => !option.label.trim())) {
      return setError('Informe o nome de cada forma de preço ou remova a linha vazia.');
    }
    if (step === 2 && priceOptions.some((option) => option.scope !== 'cart_value' && (!/^\d+$/.test(option.minQuantity) || Number(option.minQuantity) < 1 || Number(option.minQuantity) > 999))) {
      return setError('Informe a quantidade mínima de cada faixa entre 1 e 999.');
    }
    if (step === 2 && priceOptions.some((option) => option.scope === 'cart_value' && moneyToCents(option.minCartValue) < 1)) {
      return setError('Informe o valor mínimo do carrinho para cada faixa baseada em valor.');
    }
    setStep((current) => current + 1);
  }

  function productBody() {
    if (name.trim().length < 2) return { error: 'Informe o nome.' };
    if (!category.trim()) return { error: 'Informe a categoria.' };
    if (varied && visible.some((i) => !i.id && !i.color.trim() && !i.size.trim())) return { error: 'Informe cor ou tamanho de cada variação com foto.' };
    if (priceOptions.some((option) => !option.label.trim())) return { error: 'Informe o nome de cada forma de preço ou remova a linha vazia.' };
    if (priceOptions.some((option) => option.scope !== 'cart_value' && (!/^\d+$/.test(option.minQuantity) || Number(option.minQuantity) < 1 || Number(option.minQuantity) > 999))) return { error: 'Informe a quantidade mínima de cada faixa entre 1 e 999.' };
    if (priceOptions.some((option) => option.scope === 'cart_value' && moneyToCents(option.minCartValue) < 1)) return { error: 'Informe o valor mínimo do carrinho para cada faixa baseada em valor.' };
    if (!/^\d+$/.test(stockQuantity) || Number(stockQuantity) > 1_000_000) return { error: 'Informe uma quantidade de estoque válida (0 a 1.000.000).' };
    if (images.some((image) => !/^\d+$/.test(image.stockQuantity) || Number(image.stockQuantity) > 1_000_000)) return { error: 'Informe uma quantidade válida no estoque de cada variação (0 a 1.000.000).' };
    return { body: {
      kind, name: name.trim(), category: category.trim(), description: description.trim(), priceCents: moneyToCents(price), active,
      stockEnabled, stockQuantity: Number(stockQuantity) || 0,
      priceOptions: priceOptions.map((option) => ({ ...(option.id ? { id: option.id } : {}), label: option.label.trim(), priceCents: option.price === '' ? null : moneyToCents(option.price), minQuantity: Number(option.minQuantity) || 1, scope: option.scope, minCartCents: moneyToCents(option.minCartValue) })),
      ...(editing ? { mainImage: product.mainImage ? { id: product.mainImage.id } : null } : {}),
      images: (varied ? visible : visible.slice(0, 1)).map((i) => ({ ...(i.id ? { id: i.id } : { data: i.data }), ...(varied ? { color: i.color.trim(), colorHex: i.colorHex, size: i.size.trim() } : {}), stockQuantity: Number(i.stockQuantity) || 0, priceCents: null })),
    } };
  }

  function startNextDraft() {
    if (batchDrafts.length >= 29) return setError('O lote já tem espaço para 30 produtos. Finalize o produto atual para concluir o cadastro.');
    const result = productBody();
    if (result.error) return setError(result.error);
    setBatchDrafts((drafts) => [...drafts, result.body]);
    const nextPhoto = moreProductPhotos[0];
    setMoreProductPhotos((photos) => photos.slice(1));
    setKind('produto'); setName(''); setCategory(''); setDescription(''); setPrice('');
    setPriceOptions([]); setActive(true); setVaried(false); setImages(nextPhoto ? [nextPhoto] : []);
    setStockEnabled(false); setStockQuantity('0'); setStep(0); setError('');
  }

  async function save() {
    setError('');
    const result = productBody();
    if (result.error) return setError(result.error);
    const body = result.body;
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/products/${product.id}`, body);
        toast('Alterações salvas.');
      } else {
        const products = [...batchDrafts, body];
        const photoSize = products.reduce((sum, item) => sum + item.images.reduce((size, image) => size + (image.data?.length || 0), 0), 0);
        if (photoSize > 32 * 1024 * 1024) throw new Error('O lote de fotos ficou muito grande. Cadastre menos produtos ou reduza o número de imagens por produto.');
        await api.post('/products/bulk', { products });
        toast(`${plural(products.length, 'item cadastrado', 'itens cadastrados')}!`);
      }
      onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal title={editing ? 'Editar item' : 'Novo produto ou serviço'} onClose={busy ? () => {} : onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={step ? () => { setError(''); setStep((s) => s - 1); } : onClose} disabled={busy}> {step ? 'Voltar' : 'Cancelar'}</button>
        {step < steps.length - 1
          ? <button className="btn btn-primary" onClick={continueStep} disabled={busy || uploading}>Continuar</button>
          : <button className="btn btn-primary" onClick={save} disabled={busy || uploading}>{busy ? 'Salvando...' : editing ? 'Salvar alterações' : `Finalizar ${plural(batchDrafts.length + 1, 'produto', 'produtos')}`}</button>}
      </>}>
      <div className="form pr-form">
        {!editing && batchDrafts.length > 0 && <div className="pr-batch-queue">
          <strong>{batchDrafts.length} {plural(batchDrafts.length, 'produto pronto', 'produtos prontos')} para cadastrar</strong>
          <ul>{batchDrafts.map((draft, index) => <li key={`${draft.name}-${index}`}><span>{draft.name}</span><button type="button" className="link-btn" onClick={() => setBatchDrafts((list) => list.filter((_, n) => n !== index))}>Remover</button></li>)}</ul>
        </div>}
        <div className="pr-wizard-head">
          <div className="pr-wizard-steps" aria-label={`Etapa ${step + 1} de ${steps.length}`}>
            {steps.map((label, index) => <span key={label} className={index === step ? 'is-current' : index < step ? 'is-done' : ''}><i>{index + 1}</i>{label}</span>)}
          </div>
          <p className="muted small">Etapa {step + 1} de {steps.length} · Você pode deixar fotos e variações em branco.</p>
        </div>
        {step === 4 && <>
          <div className="seg" role="radiogroup" aria-label="Tipo" style={{ '--n': 2 }}>
            <button type="button" role="radio" aria-checked={kind === 'produto'} className={kind === 'produto' ? 'is-on' : ''} onClick={() => setKind('produto')}>Produto</button>
            <button type="button" role="radio" aria-checked={kind === 'servico'} className={kind === 'servico' ? 'is-on' : ''} onClick={() => setKind('servico')}>Serviço</button>
          </div>
          <label className="field"><span>Nome *</span><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <div className="grid-2">
            <label className="field">
              <span>Categoria *</span>
              <input className="input" list="pr-cats" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: Camisetas" />
              <datalist id="pr-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="field"><span>Preço base (R$)</span><input className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(maskMoney(e.target.value))} placeholder="0,00" /><small>Deixe em branco para “sob consulta”.</small></label>
          </div>
          <label className="field"><span>Descrição</span><textarea className="input" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="pe-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Ativo (aparece no catálogo)</span></label>
          {!editing && <>
            <button type="button" className="btn btn-ghost" onClick={startNextDraft} disabled={busy || uploading}><Icon name="plus" size={16} /> {moreProductPhotos.length ? `Adicionar à lista e preencher próximo produto (${moreProductPhotos.length} foto(s) restante(s))` : 'Adicionar à lista e cadastrar outro produto'}</button>
            <p className="muted small">A descrição é salva separadamente para cada produto desta lista.</p>
          </>}
        </>}
        {step === 2 && <>
        <fieldset className="field pr-price-options">
          <legend>Formas de preço (opcional)</legend>
          <small>Defina o desconto por quantidade deste produto, quantidade total no carrinho ou valor bruto mínimo dos itens no carrinho antes desta faixa. O preço correspondente é aplicado automaticamente.</small>
          {priceOptions.map((option, index) => (
            <div className="pr-price-option" key={option.key}>
              <input className="input" list="pr-price-labels" value={option.label} maxLength={40} onChange={(e) => setPriceOptions((list) => list.map((item, n) => (n === index ? { ...item, label: e.target.value } : item)))} placeholder="Nome personalizado" aria-label={`Nome da forma de preço ${index + 1}`} />
              <select className="input pr-option-scope" value={option.scope} onChange={(e) => setPriceOptions((list) => list.map((item, n) => (n === index ? { ...item, scope: e.target.value } : item)))} aria-label={`Critério da forma de preço ${index + 1}`}>
                <option value="same_product">Peças deste produto</option><option value="cart_quantity">Peças no carrinho</option><option value="cart_value">Valor do carrinho</option>
              </select>
              {option.scope === 'cart_value'
                ? <label className="pr-option-price"><span>R$</span><input className="input" inputMode="numeric" value={option.minCartValue} onChange={(e) => setPriceOptions((list) => list.map((item, n) => (n === index ? { ...item, minCartValue: maskMoney(e.target.value) } : item)))} placeholder="Mínimo" aria-label={`Valor mínimo do carrinho para a faixa ${index + 1}`} /></label>
                : <label className="pr-option-quantity"><span>A partir de</span><input className="input" inputMode="numeric" value={option.minQuantity} onChange={(e) => setPriceOptions((list) => list.map((item, n) => (n === index ? { ...item, minQuantity: e.target.value.replace(/\D/g, '').slice(0, 3) } : item)))} aria-label={`Quantidade mínima da faixa ${index + 1}`} /><span>un.</span></label>}
              <label className="pr-option-price"><span>R$</span><input className="input" inputMode="numeric" value={option.price} onChange={(e) => setPriceOptions((list) => list.map((item, n) => (n === index ? { ...item, price: maskMoney(e.target.value) } : item)))} placeholder="Opcional" aria-label={`Preço da forma ${index + 1}`} /></label>
              <button type="button" className="icon-btn icon-btn-danger" onClick={() => setPriceOptions((list) => list.filter((_, n) => n !== index))} aria-label={`Remover forma de preço ${index + 1}`}><Icon name="trash" size={17} /></button>
            </div>
          ))}
          <datalist id="pr-price-labels">{(preferences?.priceLabels || []).map((label) => <option key={label} value={label} />)}</datalist>
          {priceOptions.length < 12 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPriceOptions((list) => [...list, { key: `price-new-${Date.now()}-${Math.random()}`, label: '', price: '', minQuantity: String(Math.min(999, Math.max(1, ...list.map((item) => Number(item.minQuantity) || 1)) + 1)), scope: 'same_product', minCartValue: '' }])}><Icon name="plus" size={16} /> Adicionar faixa de preço</button>}
        </fieldset>
        </>}
        {step === 3 && <>
          <fieldset className="field pr-images">
            <legend>Estoque (opcional)</legend>
            <label className="pe-check"><input type="checkbox" checked={stockEnabled} onChange={(e) => setStockEnabled(e.target.checked)} /><span>Controlar estoque deste produto</span></label>
            <small>Quando ativado, os pedidos validam e atualizam as quantidades automaticamente.</small>
            {stockEnabled && visible.length > 0
              ? <div className="pr-stock-list">{(varied ? visible : visible.slice(0, 1)).map((image, index) => <label className="field pr-stock-row" key={image.key}>
                <span>{image.color || image.size || `Variação ${index + 1}`}</span>
                <input className="input" type="number" min="0" max="1000000" value={image.stockQuantity} onChange={(e) => setImg(index, { stockQuantity: e.target.value.replace(/\D/g, '').slice(0, 7) })} aria-label={`Estoque de ${image.color || image.size || `variação ${index + 1}`}`} />
              </label>)}</div>
              : stockEnabled && <label className="field"><span>Quantidade em estoque</span><input className="input" type="number" min="0" max="1000000" value={stockQuantity} onChange={(e) => setStockQuantity(e.target.value.replace(/\D/g, '').slice(0, 7))} /></label>}
          </fieldset>
        </>}
        {step === 0 && <>
        <fieldset className="field pr-images">
          <legend>Fotos do produto (opcional)</legend>
          <small>Adicione uma foto principal ou várias fotos para preparar as variações na próxima etapa. Você também pode continuar sem imagens.</small>
          {!editing && <button type="button" className="btn btn-ghost btn-sm" onClick={() => batchFileRef.current?.click()} disabled={uploading}>Selecionar fotos de vários produtos</button>}
          {!editing && moreProductPhotos.length > 0 && <p className="muted small">{moreProductPhotos.length} foto(s) aguardando para virar produto(s) separado(s).</p>}
          <div className="pr-slots">
            {visible.map((im, i) => (
              <div key={im.key} className="pr-slot">
                <button type="button" className="pr-slot-img" onClick={() => pick(i)} disabled={uploading} aria-label={`Trocar imagem ${i + 1}`} title="Trocar imagem"><img src={im.url} alt="" /></button>
                <button type="button" className="link-btn" onClick={() => setImages((list) => list.filter((_, n) => n !== i))}>Remover</button>
              </div>
            ))}
            {visible.length < MAX_IMAGES && (
              <button type="button" className="pr-slot pr-slot-add" onClick={() => pick(null)} disabled={uploading}>
                <Icon name="plus" size={22} /><span>{uploading ? 'Enviando...' : 'Adicionar foto'}</span>
              </button>
            )}
          </div>
          <small>A imagem é reduzida automaticamente. Formatos: PNG, JPG, WebP, GIF ou HEIC/HEIF (fotos de alguns celulares).</small>
        </fieldset>
        </>}
        {step === 1 && <>
          <fieldset className="field pr-images">
            <legend>Tipos e valores das variações (opcional)</legend>
            <label className="pe-check"><input type="checkbox" checked={varied} onChange={(e) => setVaried(e.target.checked)} /><span>Este produto tem variações</span></label>
            <small>Escolha cor, tamanho ou ambos e informe os valores de cada foto. Sem variações, basta deixar desmarcado.</small>
            {!varied && visible.length > 1 && <p className="banner banner-amber">Você selecionou {visible.length} fotos. Ative as variações para usar todas; sem variações, somente a primeira será salva.</p>}
            {varied && visible.length > 0 ? (
              <div className="pr-var-list">
                {visible.map((im, i) => (
                  <div key={im.key} className="pr-var-card">
                    <button type="button" className="pr-slot-img" onClick={() => pick(i)} disabled={uploading} aria-label={`Trocar a foto da variação ${i + 1}`} title="Trocar foto"><img src={im.url} alt="" /></button>
                    <div className="pr-var-fields">
                      <strong className="small">Variação {i + 1}</strong>
                      <label className="field"><span>Cor</span>
                        <span className="pr-var-color">
                          <input type="color" value={im.colorHex || '#cccccc'} onChange={(e) => setImg(i, { colorHex: e.target.value })} aria-label={`Escolher a cor da variação ${i + 1}`} className={im.colorHex ? '' : 'is-empty'} />
                          <input className="input input-sm" list="pr-colors" value={im.color} maxLength={20} onChange={(e) => setImg(i, { color: e.target.value })} placeholder="Ex.: Azul" />
                          {im.colorHex && <button type="button" className="link-btn" onClick={() => setImg(i, { colorHex: '' })}>Sem amostra</button>}
                        </span>
                      </label>
                      <label className="field"><span>Tamanho, litros ou unidade</span>
                        <input className="input input-sm" list="pr-sizes" value={im.size} maxLength={20} onChange={(e) => setImg(i, { size: e.target.value })} placeholder="Ex.: M, 42, 2 litros, unidade" />
                      </label>
                      <button type="button" className="link-btn" onClick={() => setImages((list) => list.filter((_, n) => n !== i))}>Remover esta variação</button>
                    </div>
                  </div>
                ))}
                {visible.length < MAX_IMAGES && <button type="button" className="btn btn-ghost" onClick={() => pick(null)} disabled={uploading}><Icon name="plus" size={16} /> Adicionar outra variação com foto</button>}
                <datalist id="pr-colors">{['Preto', 'Branco', 'Cinza', 'Azul', 'Vermelho', 'Verde', 'Amarelo', 'Rosa', 'Roxo', 'Laranja', 'Marrom', 'Bege'].map((c) => <option key={c} value={c} />)}</datalist>
                <datalist id="pr-sizes">{['PP', 'P', 'M', 'G', 'GG', 'XG', 'Único', '36', '38', '40', '42', '44'].map((s) => <option key={s} value={s} />)}</datalist>
              </div>
            ) : varied ? <p className="muted small">Nenhuma foto adicionada. Você pode voltar e adicionar fotos antes de configurar variações.</p> : null}
          </fieldset>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f); }} />
      <input ref={batchFileRef} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => { const files = e.target.files; e.target.value = ''; onBatchPhotos(files); }} />
    </Modal>
  );
}

function ProductPreferencesModal({ preferences, onClose, onSaved }) {
  const toast = useToast();
  const defaults = {
    categories: [],
    variationTypes: ['Cor', 'Tamanho', 'Litros'],
    priceLabels: ['Varejo', 'Atacarejo', 'Atacado', 'Mensal', 'Semestral', 'Anual'],
    ...preferences,
  };
  const [lists, setLists] = useState(defaults);
  const [drafts, setDrafts] = useState({ categories: '', variationTypes: '', priceLabels: '' });
  const [busy, setBusy] = useState(false);
  const sections = [
    ['categories', 'Categorias', 'Ex.: Roupas, Bebidas, Consultoria'],
    ['variationTypes', 'Tipos de variação', 'Ex.: Cor, Tamanho, Litros, Material'],
    ['priceLabels', 'Nomes de preço', 'Ex.: Varejo, Atacado, Mensal, Anual'],
  ];

  function add(key) {
    const value = drafts[key].replace(/\s+/g, ' ').trim();
    if (!value) return;
    setLists((current) => current[key].some((item) => item.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR'))
      ? current
      : { ...current, [key]: [...current[key], value] });
    setDrafts((current) => ({ ...current, [key]: '' }));
  }

  async function save() {
    setBusy(true);
    try {
      const result = await api.put('/products/preferences', lists);
      onSaved(result.preferences);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal title="Organizar categorias e opções" onClose={busy ? () => {} : onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Salvando...' : 'Salvar opções'}</button></>}>
      <div className="form pr-preferences">
        <p className="muted">Crie listas para agilizar os próximos cadastros. Você também pode digitar uma opção diferente diretamente no produto.</p>
        {sections.map(([key, title, placeholder]) => (
          <fieldset className="field pr-preference-group" key={key}>
            <legend>{title}</legend>
            <div className="pr-preference-add">
              <input className="input" value={drafts[key]} maxLength={key === 'categories' ? 60 : 40} placeholder={placeholder} onChange={(e) => setDrafts((current) => ({ ...current, [key]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(key); } }} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(key)}>Adicionar</button>
            </div>
            <div className="pr-preference-chips">
              {lists[key].map((value) => <button type="button" className="pr-preference-chip" key={value} onClick={() => setLists((current) => ({ ...current, [key]: current[key].filter((item) => item !== value) }))} title={`Remover ${value}`}>{value}<span aria-hidden="true"> ×</span></button>)}
              {!lists[key].length && <small className="muted">Nenhuma opção salva.</small>}
            </div>
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}
