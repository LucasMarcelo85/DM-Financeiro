import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isShopMode } from '../api.js';
import BuyMore from '../components/BuyMore.jsx';
import StoreBar from '../components/StoreBar.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { IMAGE_ACCEPT } from '../lib/contract/image.js';
import { brl, centsToMasked, maskMoney, moneyToCents, plural } from '../lib/format.js';
import { prepareProductImage } from '../lib/portfolio/imageTools.js';

// Cadastro de produtos e serviços: usados no catálogo digital e nos cartões de produtos do portfólio.
const MAX_IMAGES = 4;

function productPriceLabel(product) {
  if (product.priceCents > 0) return brl(product.priceCents);
  const tier = [...product.priceOptions]
    .filter((option) => option.priceCents !== null)
    .sort((a, b) => (a.minQuantity || 1) - (b.minQuantity || 1))[0];
  if (tier) return `A partir de ${brl(tier.priceCents)} · ${tier.minQuantity || 1} un.`;
  return 'Sob consulta';
}

export default function Products() {
  const shop = isShopMode();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | produto
  const [confirmDel, setConfirmDel] = useState(null);
  const [managePreferences, setManagePreferences] = useState(false);
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

  const blocked = data && data.limit < 1;
  const full = data && data.limit > 0 && data.count >= data.limit;

  async function toggle(p) {
    try { await api.patch(`/products/${p.id}`, { active: !p.active }); load(); } catch (e) { toast(e.message, 'error'); }
  }
  async function remove(p) {
    setConfirmDel(null);
    try { await api.del(`/products/${p.id}`); toast('Excluído.'); load(); } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <>
      <header className="page-head head-row">
        <div>
          <h1>Produtos e serviços</h1>
          <p className="muted">
            Cadastre o que você vende. Eles aparecem no catálogo digital e nos cartões de produtos do portfólio.
            {data && data.limit > 0 ? ` Você usou ${data.count} de ${plural(data.limit, 'item', 'itens')} do seu plano.` : ''}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={!data || blocked || full}><Icon name="plus" size={18} /> Novo</button>
      </header>
      <StoreBar />
      {data && !shop && <div className="pr-preferences-action"><button className="btn btn-ghost btn-sm" onClick={() => setManagePreferences(true)}>Organizar categorias e opções</button></div>}

      {blocked && (
        <div className="banner banner-amber">
          <div><strong>O seu plano não inclui produtos e catálogo digital.</strong><span>Mude para um plano com catálogo para cadastrar produtos e serviços.</span></div>
          {!shop && <Link className="btn btn-ghost btn-sm" to="/plano">Ver planos</Link>}
        </div>
      )}
      {full && !blocked && (
        <div className="banner banner-amber">
          <div><strong>Você usou todos os itens do seu plano.</strong><span>Exclua algum, adquira limite extra ou mude de plano para cadastrar mais.</span></div>
          {!shop && <BuyMore resource="catalogProducts" />}
          {!shop && <Link className="btn btn-ghost btn-sm" to="/plano">Ver planos</Link>}
        </div>
      )}

      {data && data.count > 0 && (
        <div className="pr-filters">
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
          <p>{data.count ? 'Tente outra busca ou outro filtro.' : 'Cada item tem nome, categoria e uma imagem. Se tiver variações (cor, tamanho), pode colocar até 4 imagens.'}</p>
          {!data.count && !blocked && <button className="btn btn-primary" onClick={() => setEditing('new')}>Cadastrar</button>}
        </section>
      ) : (
        <ul className="pr-grid">
          {data.products.map((p) => (
            <li key={p.id} className={`pr-card ${p.active ? '' : 'is-off'}`}>
              <button type="button" className="pr-img" onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`}>
                {p.images[0] ? <img src={p.images[0].url} alt="" loading="lazy" /> : <Icon name="box" size={28} />}
                {p.images.length > 1 && <span className="pr-var">{p.images.length} variações</span>}
              </button>
              <div className="pr-body">
                <span className="pr-cat">{p.category}<em>{p.kind === 'servico' ? 'Serviço' : 'Produto'}</em></span>
                <strong title={p.name}>{p.name}</strong>
                <span className="pr-price">{productPriceLabel(p)}</span>
                {p.priceOptions.length > 0 && <small className="muted">{p.priceOptions.length} formas de preço</small>}
              </div>
              <div className="pr-actions">
                <label className="pr-switch" title={p.active ? 'Visível no catálogo' : 'Escondido do catálogo'}>
                  <input type="checkbox" checked={p.active} onChange={() => toggle(p)} /><span>{p.active ? 'Ativo' : 'Inativo'}</span>
                </label>
                <button className="icon-btn" onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`} title="Editar"><Icon name="edit" size={17} /></button>
                {!shop && <button className="icon-btn icon-btn-danger" onClick={() => setConfirmDel(p)} aria-label={`Excluir ${p.name}`} title="Excluir"><Icon name="trash" size={17} /></button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && <ProductForm product={editing === 'new' ? null : editing} categories={data?.categories || []} preferences={data?.preferences} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {managePreferences && <ProductPreferencesModal preferences={data?.preferences} onClose={() => setManagePreferences(false)} onSaved={(preferences) => {
        setData((current) => current ? { ...current, preferences } : current);
        setManagePreferences(false);
        toast('Opções salvas.');
        load();
      }} />}
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
function ProductForm({ product, categories, preferences, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(product);
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
  })));
  const [active, setActive] = useState(product ? product.active : true);
  const [varied, setVaried] = useState((product?.images.length || 0) > 1);
  const [variationType, setVariationType] = useState('');
  const [images, setImages] = useState(() => (product?.images || []).map((i) => ({ key: `i${i.id}`, id: i.id, url: i.url, label: i.label })));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const target = useRef(null); // índice da imagem a trocar (ou null = adicionar)

  const visible = useMemo(() => (varied ? images.slice(0, MAX_IMAGES) : images.slice(0, 1)), [images, varied]);

  async function onFile(file) {
    if (!file) return;
    const imageIndex = target.current;
    const allowMultiple = varied;
    target.current = null;
    setUploading(true); setError('');
    try {
      const { src } = await prepareProductImage(file);
      setImages((list) => {
        const item = { key: `n${Date.now()}${Math.random()}`, data: src, url: src, label: '' };
        if (imageIndex !== null && list[imageIndex]) return list.map((x, n) => (n === imageIndex ? { ...x, id: undefined, data: src, url: src } : x));
        return [...list, item].slice(0, allowMultiple ? MAX_IMAGES : 1);
      });
    } catch (e) { setError(e.message); } finally { setUploading(false); }
  }
  const pick = (i) => { target.current = i; fileRef.current?.click(); };
  const setImg = (i, patch) => setImages((list) => list.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  async function save() {
    setError('');
    if (name.trim().length < 2) return setError('Informe o nome.');
    if (!category.trim()) return setError('Informe a categoria.');
    if (!visible.length) return setError('Adicione pelo menos uma imagem.');
    if (varied && visible.length < 2) return setError('Com variações, coloque pelo menos 2 imagens (ou desmarque “Tem variações”).');
    if (varied && visible.some((i) => !i.label.trim())) return setError('Dê um nome a cada variação (ex.: cor ou tamanho).');
    if (varied && visible.some((i) => `${variationType.trim() ? `${variationType.trim()}: ` : ''}${i.label.trim()}`.length > 40)) return setError('O tipo e o valor da variação juntos devem ter até 40 caracteres.');
    if (priceOptions.some((option) => !option.label.trim())) return setError('Informe o nome de cada forma de preço ou remova a linha vazia.');
    if (priceOptions.some((option) => !/^\d+$/.test(option.minQuantity) || Number(option.minQuantity) < 1 || Number(option.minQuantity) > 999)) return setError('Informe a quantidade mínima de cada faixa entre 1 e 999.');
    const body = {
      kind, name: name.trim(), category: category.trim(), description: description.trim(), priceCents: moneyToCents(price), active,
      priceOptions: priceOptions.map((option) => ({ ...(option.id ? { id: option.id } : {}), label: option.label.trim(), priceCents: option.price === '' ? null : moneyToCents(option.price), minQuantity: Number(option.minQuantity) || 1 })),
      images: visible.map((i) => ({ ...(i.id ? { id: i.id } : { data: i.data }), label: varied ? `${variationType.trim() ? `${variationType.trim()}: ` : ''}${i.label.trim()}` : '', priceCents: null })),
    };
    setBusy(true);
    try {
      if (editing) await api.patch(`/products/${product.id}`, body); else await api.post('/products', body);
      toast(editing ? 'Alterações salvas.' : 'Cadastrado!');
      onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal title={editing ? 'Editar item' : 'Novo produto ou serviço'} onClose={busy ? () => {} : onClose} wide
      footer={<><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={busy || uploading}>{busy ? 'Salvando...' : 'Salvar'}</button></>}>
      <div className="form pr-form">
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
          <label className="field"><span>Preço (R$)</span><input className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(maskMoney(e.target.value))} placeholder="0,00" /><small>Deixe em branco para “sob consulta”.</small></label>
        </div>
        <fieldset className="field pr-price-options">
          <legend>Formas de preço (opcional)</legend>
          <small>Crie faixas de preço por quantidade. No carrinho, o sistema aplica automaticamente a faixa atingida — o cliente não escolhe um preço. O valor pode ficar em branco para “sob consulta”.</small>
          {priceOptions.map((option, index) => (
            <div className="pr-price-option" key={option.key}>
              <input className="input" list="pr-price-labels" value={option.label} maxLength={40} onChange={(e) => setPriceOptions((list) => list.map((item, n) => (n === index ? { ...item, label: e.target.value } : item)))} placeholder="Nome personalizado" aria-label={`Nome da forma de preço ${index + 1}`} />
              <label className="pr-option-quantity"><span>A partir de</span><input className="input" inputMode="numeric" value={option.minQuantity} onChange={(e) => setPriceOptions((list) => list.map((item, n) => (n === index ? { ...item, minQuantity: e.target.value.replace(/\D/g, '').slice(0, 3) } : item)))} aria-label={`Quantidade mínima da faixa ${index + 1}`} /><span>un.</span></label>
              <label className="pr-option-price"><span>R$</span><input className="input" inputMode="numeric" value={option.price} onChange={(e) => setPriceOptions((list) => list.map((item, n) => (n === index ? { ...item, price: maskMoney(e.target.value) } : item)))} placeholder="Opcional" aria-label={`Preço da forma ${index + 1}`} /></label>
              <button type="button" className="icon-btn icon-btn-danger" onClick={() => setPriceOptions((list) => list.filter((_, n) => n !== index))} aria-label={`Remover forma de preço ${index + 1}`}><Icon name="trash" size={17} /></button>
            </div>
          ))}
          <datalist id="pr-price-labels">{(preferences?.priceLabels || []).map((label) => <option key={label} value={label} />)}</datalist>
          {priceOptions.length < 12 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPriceOptions((list) => [...list, { key: `price-new-${Date.now()}-${Math.random()}`, label: '', price: '', minQuantity: String(Math.min(999, Math.max(1, ...list.map((item) => Number(item.minQuantity) || 1)) + 1)) }])}><Icon name="plus" size={16} /> Adicionar faixa de preço</button>}
        </fieldset>
        <label className="field"><span>Descrição</span><textarea className="input" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>

        <fieldset className="field pr-images">
          <legend>Fotos do produto</legend>
          <small>Adicione uma imagem principal ou ative variações para cadastrar fotos identificadas por cor, tamanho, litros ou outro atributo.</small>
          <label className="pe-check"><input type="checkbox" checked={varied} onChange={(e) => setVaried(e.target.checked)} /><span>Este produto tem variações com fotos próprias</span></label>
          {varied && <label className="field"><span>O que varia?</span><input className="input" list="pr-variation-types" value={variationType} maxLength={40} onChange={(e) => setVariationType(e.target.value)} placeholder="Ex.: Cor, tamanho ou litros" /><datalist id="pr-variation-types">{(preferences?.variationTypes || []).map((label) => <option key={label} value={label} />)}</datalist><small>Depois, informe o valor em cada foto (ex.: Azul, M ou 2 litros). O preço é definido acima em “Formas de preço”.</small></label>}
          <div className="pr-slots">
            {visible.map((im, i) => (
              <div key={im.key} className="pr-slot">
                <button type="button" className="pr-slot-img" onClick={() => pick(i)} disabled={uploading} aria-label={`Trocar a imagem ${i + 1}`} title="Trocar imagem"><img src={im.url} alt="" /></button>
                {varied && (
                  <>
                    <input className="input input-sm" placeholder={variationType ? `Valor (${variationType})` : 'Valor da variação'} value={im.label} maxLength={40} onChange={(e) => setImg(i, { label: e.target.value })} aria-label={`Valor da variação ${i + 1}`} />
                  </>
                )}
                {(varied || visible.length > 1) && <button type="button" className="link-btn" onClick={() => setImages((l) => l.filter((_, n) => n !== i))}>Remover</button>}
              </div>
            ))}
            {visible.length < (varied ? MAX_IMAGES : 1) && (
              <button type="button" className="pr-slot pr-slot-add" onClick={() => pick(null)} disabled={uploading}>
                <Icon name="plus" size={22} /><span>{uploading ? 'Enviando...' : 'Adicionar imagem'}</span>
              </button>
            )}
          </div>
          <small>A imagem é reduzida automaticamente. Formatos: PNG, JPG, WebP, GIF ou HEIC/HEIF (fotos de alguns celulares).</small>
        </fieldset>
        <label className="pe-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Ativo (aparece no catálogo)</span></label>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f); }} />
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
