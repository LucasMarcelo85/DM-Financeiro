import { useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';
import { IMAGE_ACCEPT } from '../lib/contract/image.js';
import { centsToMasked, maskMoney, moneyToCents, plural } from '../lib/format.js';
import { prepareProductImage } from '../lib/portfolio/imageTools.js';

const MAX_IMAGES = 12;
const MAX_BATCH = 30;
const DEFAULT_VARIATION_TYPES = ['Cor', 'Tamanho', 'Litros', 'Unidade'];
const newKey = () => `draft-${Date.now()}-${Math.random()}`;

async function imageFromFile(file) {
  const { src } = await prepareProductImage(file);
  return { key: newKey(), data: src, url: src, label: '', stockQuantity: '0' };
}

function blankDraft(image = null) {
  return {
    key: newKey(),
    kind: 'produto',
    name: '',
    category: '',
    description: '',
    price: '',
    onRequest: false,
    active: true,
    stockEnabled: false,
    stockQuantity: '0',
    priceOptions: [],
    mainImage: image,
    variations: [],
  };
}

function variationFields(image) {
  const label = image.label || '';
  if (image.color) return { variationType: 'Cor', variationValue: image.color };
  if (image.size) return { variationType: 'Tamanho', variationValue: image.size };
  const separator = label.indexOf(':');
  if (separator > 0) {
    return {
      variationType: label.slice(0, separator).trim(),
      variationValue: label.slice(separator + 1).trim(),
    };
  }
  return { variationType: 'Cor', variationValue: label === 'Principal' ? '' : label };
}

function draftFromProduct(product) {
  const rows = product.images || [];
  const variation = (image) => ({
    key: `image-${image.id}`,
    id: image.id,
    url: image.url,
    label: image.label || '',
    color: image.color || '',
    colorHex: image.colorHex || '',
    size: image.size || '',
    stockQuantity: String(image.stockQuantity || 0),
    ...variationFields(image),
  });
  return {
    key: `product-${product.id}`,
    id: product.id,
    kind: product.kind,
    name: product.name,
    category: product.category,
    description: product.description,
    price: centsToMasked(product.priceCents),
    onRequest: product.priceCents === 0,
    active: product.active,
    stockEnabled: Boolean(product.stockEnabled),
    stockQuantity: String(product.stockQuantity || 0),
    priceOptions: (product.priceOptions || []).map((option) => ({
      key: `option-${option.id}`,
      id: option.id,
      label: option.label,
      scope: option.scope || 'same_product',
      minQuantity: String(option.minQuantity || 1),
      minCartValue: centsToMasked(option.minCartCents || 0),
      price: option.priceCents === null ? '' : centsToMasked(option.priceCents),
      onRequest: option.priceCents === null,
    })),
    mainImage: rows[0] ? variation(rows[0]) : null,
    variations: rows.slice(1).map(variation),
  };
}

function productBody(draft) {
  const name = draft.name.trim();
  const category = draft.category.trim();
  if (name.length < 2) throw new Error('Informe um nome com pelo menos 2 caracteres.');
  if (!category) throw new Error('Informe a categoria.');
  if (!draft.onRequest && !draft.price) throw new Error('Informe o preço base ou marque “Sob consulta”.');
  if (draft.variations.some((image) => !(image.variationType === 'Outro' ? image.customVariationType : image.variationType)?.trim() || !image.variationValue?.trim())) {
    throw new Error('Escolha o tipo e informe o valor de cada variação com foto.');
  }
  if (!/^\d+$/.test(draft.stockQuantity) || Number(draft.stockQuantity) > 1_000_000) throw new Error('Informe um estoque válido entre 0 e 1.000.000.');
  if ([draft.mainImage, ...draft.variations].filter(Boolean).some((image) => !/^\d+$/.test(image.stockQuantity || '0') || Number(image.stockQuantity || 0) > 1_000_000)) throw new Error('Informe uma quantidade válida no estoque de cada imagem.');

  const priceOptions = draft.priceOptions.map((option) => {
    if (!option.label.trim()) throw new Error('Informe o nome de cada faixa de preço.');
    if (!option.onRequest && !option.price) throw new Error(`${option.label}: informe o valor por unidade ou marque “Sob consulta”.`);
    if (option.scope === 'cart_value') {
      if (moneyToCents(option.minCartValue) < 1) throw new Error(`${option.label}: informe o valor mínimo do carrinho.`);
    } else if (!/^\d+$/.test(option.minQuantity) || Number(option.minQuantity) < 1 || Number(option.minQuantity) > 999) {
      throw new Error(`${option.label}: informe a quantidade mínima entre 1 e 999.`);
    }
    return {
      ...(option.id ? { id: option.id } : {}),
      label: option.label.trim(),
      priceCents: option.onRequest ? null : moneyToCents(option.price),
      minQuantity: Number(option.minQuantity) || 1,
      scope: option.scope,
      minCartCents: moneyToCents(option.minCartValue),
    };
  });

  const images = [draft.mainImage, ...draft.variations].filter(Boolean);
  return {
    kind: draft.kind,
    name,
    category,
    description: draft.description.trim(),
    priceCents: draft.onRequest ? 0 : moneyToCents(draft.price),
    active: draft.active,
    stockEnabled: draft.stockEnabled,
    stockQuantity: Number(draft.stockQuantity) || 0,
    priceOptions,
    images: images.map((image, index) => ({
      ...(image.id ? { id: image.id } : { data: image.data }),
      ...(images.length > 1 ? (() => {
        if (index === 0) return { label: 'Principal', color: '', colorHex: '', size: '' };
        const type = (image.variationType === 'Outro' ? image.customVariationType : image.variationType).trim();
        const value = image.variationValue.trim();
        const normalizedType = type.toLocaleLowerCase('pt-BR');
        return {
          label: `${type}: ${value}`.slice(0, 40),
          color: normalizedType === 'cor' ? value : '',
          colorHex: image.colorHex || '',
          size: normalizedType === 'tamanho' ? value : '',
        };
      })() : {}),
      stockQuantity: Number(image.stockQuantity) || 0,
      priceCents: null,
    })),
  };
}

export default function ProductWorkspace({ product, categories, preferences, available, onClose, onSaved }) {
  const editing = Boolean(product);
  const toast = useToast();
  const [drafts, setDrafts] = useState(() => product ? [draftFromProduct(product)] : []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pickerId = 'product-batch-photo-picker';
  const existingDraftCount = drafts.length;

  function patchDraft(key, changes) {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...changes } : draft));
  }

  async function addProductsFromPhotos(files) {
    const selected = [...files];
    if (!selected.length) return;
    if (editing) return setError('Para editar, troque a foto principal ou adicione variações neste card.');
    if (selected.length > MAX_BATCH || selected.length + existingDraftCount > Math.min(available, MAX_BATCH)) {
      return setError(`Você pode selecionar até ${Math.max(0, Math.min(available, MAX_BATCH) - existingDraftCount)} foto(s) para este lote.`);
    }
    setUploading(true);
    setError('');
    try {
      const prepared = [];
      for (const file of selected) prepared.push(await imageFromFile(file));
      setDrafts((current) => [...current, ...prepared.map((image) => blankDraft(image))]);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function replaceMainPhoto(key, file) {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const photo = await imageFromFile(file);
      setDrafts((current) => current.map((draft) => {
        if (draft.key !== key) return draft;
        return { ...draft, mainImage: { ...photo, ...(draft.mainImage?.stockQuantity ? { stockQuantity: draft.mainImage.stockQuantity } : {}) } };
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function addVariations(key, files) {
    const selected = [...files];
    if (!selected.length) return;
    const draft = drafts.find((item) => item.key === key);
    if (!draft?.mainImage) return setError('Adicione primeiro a foto principal deste produto.');
    if (draft.variations.length + selected.length > MAX_IMAGES - 1) return setError(`Cada produto pode ter até ${MAX_IMAGES - 1} fotos de variação.`);
    setUploading(true);
    setError('');
    try {
      const prepared = [];
      for (const file of selected) prepared.push(await imageFromFile(file));
      const defaultType = preferences?.variationTypes?.[0] || 'Cor';
      setDrafts((current) => current.map((item) => item.key === key ? {
        ...item,
        variations: [...item.variations, ...prepared.map((image) => ({ ...image, variationType: defaultType, variationValue: '' }))],
      } : item));
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setError('');
    let payload;
    try {
      payload = drafts.map(productBody);
      const photoSize = payload.reduce((sum, item) => sum + item.images.reduce((size, image) => size + (image.data?.length || 0), 0), 0);
      if (photoSize > 32 * 1024 * 1024) throw new Error('O lote de fotos ficou muito grande. Cadastre menos produtos ou reduza o número de imagens.');
    } catch (e) {
      setError(e.message);
      return;
    }

    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/products/${product.id}`, payload[0]);
        toast?.('Alterações salvas.');
      } else {
        if (payload.length > available) throw new Error(`O seu plano permite cadastrar mais ${available} produto(s) agora.`);
        await api.post('/products/bulk', { products: payload });
        toast?.(`${plural(payload.length, 'produto cadastrado', 'produtos cadastrados')}!`);
      }
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <section className="pr-workspace" aria-labelledby="pr-workspace-title">
      <header className="pr-workspace-head">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>← Voltar aos produtos</button>
        <div>
          <h1 id="pr-workspace-title">{editing ? 'Editar produto' : 'Cadastrar produtos'}</h1>
          <p className="muted">{editing ? 'Atualize os dados e confira o card antes de salvar.' : 'Cada foto selecionada cria um produto. Preencha o card correspondente; variações são adicionadas dentro dele.'}</p>
        </div>
        {!editing && <label className={`btn btn-primary pr-photo-picker ${uploading || existingDraftCount >= Math.min(available, MAX_BATCH) ? 'is-disabled' : ''}`} htmlFor={pickerId}>
          <Icon name="plus" size={18} /> {uploading ? 'Preparando fotos...' : 'Selecionar fotos de produtos'}
          <input id={pickerId} className="pr-picker-input" type="file" accept={IMAGE_ACCEPT} multiple disabled={uploading || existingDraftCount >= Math.min(available, MAX_BATCH)} onChange={(event) => {
            const files = Array.from(event.currentTarget.files || []);
            event.currentTarget.value = '';
            void addProductsFromPhotos(files);
          }} />
        </label>}
      </header>

      {drafts.length === 0 && <div className="pr-upload-empty rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="pr-upload-empty-icon mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-brand-ink"><Icon name="box" size={30} /></div>
        <h2>Comece adicionando seus produtos</h2>
        <p>Selecione várias fotos de uma vez — cada imagem cria um produto separado. Se preferir, cadastre sem foto.</p>
        <div className="pr-upload-empty-actions">
          <label className={`btn btn-primary ${uploading || existingDraftCount >= Math.min(available, MAX_BATCH) ? 'is-disabled' : ''}`} htmlFor={pickerId}>
            <Icon name="plus" size={18} /> Escolher fotos
          </label>
          <button type="button" className="btn btn-ghost" onClick={() => setDrafts([blankDraft()])} disabled={available < 1}>Começar sem foto</button>
        </div>
      </div>}

      <div className="pr-workspace-cards">
        {drafts.map((draft, index) => <ProductDraftCard
          key={draft.key}
          draft={draft}
          index={index}
          count={drafts.length}
          categories={categories}
          preferences={preferences}
          editing={editing}
          uploading={uploading}
          onPatch={(changes) => patchDraft(draft.key, changes)}
          onReplaceMain={(file) => replaceMainPhoto(draft.key, file)}
          onAddVariations={(files) => addVariations(draft.key, files)}
          onRemove={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}
          onRemoveVariation={(variationKey) => patchDraft(draft.key, { variations: draft.variations.filter((image) => image.key !== variationKey) })}
          onPatchVariation={(variationKey, changes) => patchDraft(draft.key, { variations: draft.variations.map((image) => image.key === variationKey ? { ...image, ...changes } : image) })}
        />)}
      </div>

      {!editing && drafts.length > 0 && <button type="button" className="btn btn-ghost pr-add-blank" onClick={() => setDrafts((current) => current.length < Math.min(available, MAX_BATCH) ? [...current, blankDraft()] : current)} disabled={drafts.length >= Math.min(available, MAX_BATCH)}>
        <Icon name="plus" size={17} /> Adicionar produto sem foto
      </button>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="pr-workspace-footer">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || uploading || drafts.length === 0}>
          {busy ? 'Salvando...' : editing ? 'Salvar alterações' : `Finalizar ${plural(drafts.length, 'produto', 'produtos')}`}
        </button>
      </footer>
    </section>
  );
}

function ProductDraftCard({ draft, index, count, categories, preferences, editing, uploading, onPatch, onReplaceMain, onAddVariations, onRemove, onRemoveVariation, onPatchVariation }) {
  const mainPhotoPickerId = `main-photo-${draft.key}`;
  const variationPickerId = `variation-photo-${draft.key}`;
  const images = [draft.mainImage, ...draft.variations].filter(Boolean);
  const updateOption = (key, changes) => onPatch({ priceOptions: draft.priceOptions.map((option) => option.key === key ? { ...option, ...changes } : option) });
  const addPriceOption = () => onPatch({ priceOptions: [...draft.priceOptions, {
    key: newKey(), label: '', scope: 'same_product', minQuantity: String(draft.priceOptions.length ? Number(draft.priceOptions[draft.priceOptions.length - 1].minQuantity || 1) + 1 : 1), minCartValue: '', price: '', onRequest: false,
  }] });

  return (
    <article className="pr-product-editor-card">
      <header className="pr-product-card-head">
        <div className="pr-product-number">{index + 1}</div>
        <div><h2>{draft.name || `Produto ${index + 1}`}</h2><p>{draft.category || 'Categoria ainda não informada'}</p></div>
        {!editing && count > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`Remover produto ${index + 1}`}>Remover produto</button>}
      </header>

      <div className="pr-product-editor-layout">
        <aside className="pr-product-preview">
          <label className="pr-main-photo" htmlFor={mainPhotoPickerId} aria-label={draft.mainImage ? 'Trocar foto principal' : 'Adicionar foto principal'}>
            <input id={mainPhotoPickerId} className="pr-picker-input" type="file" accept={IMAGE_ACCEPT} disabled={uploading} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void onReplaceMain(file);
            }} />
            {draft.mainImage ? <img src={draft.mainImage.url} alt={`Foto principal de ${draft.name || `produto ${index + 1}`}`} /> : <><Icon name="box" size={32} /><span>Adicionar foto principal</span></>}
            {draft.mainImage && <span className="pr-photo-change">Trocar foto</span>}
          </label>
          <strong>Foto principal</strong>
          <small className="muted">Esta é a imagem de referência para os dados abaixo.</small>
          {draft.variations.length > 0 && <div className="pr-mini-gallery">{draft.variations.map((image) => <img key={image.key} src={image.url} alt={image.label || 'Foto de variação'} />)}</div>}
        </aside>

        <div className="pr-product-editor-content">
          <label className="check-line pr-active-check"><input type="checkbox" checked={draft.active} onChange={(event) => onPatch({ active: event.target.checked })} /><span>Ativo e visível na área de vendas</span></label>

          <section className="pr-editor-section">
            <div className="pr-section-title"><span>1</span><div><h3>Variações</h3><p>Adicione fotos e indique o que muda: cor, tamanho, volume ou unidade.</p></div></div>
            <div className="pr-variation-list">
              {draft.variations.map((image, variationIndex) => <div className="pr-variation-row" key={image.key}>
                <div className="pr-variation-thumb"><img src={image.url} alt={`Variação ${variationIndex + 1} de ${draft.name || `produto ${index + 1}`}`} /><span>Variação {variationIndex + 1}</span></div>
                <label className="field"><span>Tipo de variação</span><select className="input" value={image.variationType || preferences?.variationTypes?.[0] || 'Cor'} onChange={(event) => onPatchVariation(image.key, { variationType: event.target.value, customVariationType: '' })}>
                  {[...new Set([
                    ...(preferences?.variationTypes?.length ? preferences.variationTypes : DEFAULT_VARIATION_TYPES),
                    'Unidade',
                    ...(image.variationType ? [image.variationType] : []),
                    'Outro',
                  ])].map((type) => <option key={type} value={type}>{type}</option>)}
                </select></label>
                {image.variationType === 'Outro' && <label className="field"><span>Qual tipo?</span><input className="input" value={image.customVariationType || ''} maxLength={20} onChange={(event) => onPatchVariation(image.key, { customVariationType: event.target.value })} placeholder="Ex.: Material" /></label>}
                <label className="field"><span>Valor</span><input className="input" value={image.variationValue || ''} maxLength={32} onChange={(event) => onPatchVariation(image.key, { variationValue: event.target.value })} placeholder={image.variationType === 'Cor' ? 'Ex.: Azul-marinho' : image.variationType === 'Tamanho' ? 'Ex.: M, 42' : 'Ex.: 2 litros'} /></label>
                <button type="button" className="btn btn-ghost btn-sm pr-remove-variation" onClick={() => onRemoveVariation(image.key)} aria-label={`Remover só a variação ${variationIndex + 1}`}>Remover</button>
              </div>)}
            </div>
            {draft.variations.length < MAX_IMAGES - 1 && <>
              <label className={`btn btn-ghost btn-sm pr-add-variation ${!draft.mainImage || uploading ? 'is-disabled' : ''}`} htmlFor={variationPickerId}>
                <Icon name="plus" size={16} /> Adicionar fotos das variações
                <input id={variationPickerId} className="pr-picker-input" type="file" accept={IMAGE_ACCEPT} multiple disabled={!draft.mainImage || uploading} onChange={(event) => {
                  const files = Array.from(event.currentTarget.files || []);
                  event.currentTarget.value = '';
                  void onAddVariations(files);
                }} />
              </label>
              {!draft.mainImage && <small className="muted">Adicione primeiro a foto principal para criar variações.</small>}
            </>}
          </section>

          <section className="pr-editor-section">
            <div className="pr-section-title"><span>2</span><div><h3>Preço e descontos</h3><p>O preço base é unitário. As faixas definem o preço por peça conforme a quantidade.</p></div></div>
            <div className="pr-base-price">
              <div className="pr-current-product-image">{draft.mainImage && <img src={draft.mainImage.url} alt="" />}</div>
              <label className="field"><span>Preço unitário base</span><input className="input" inputMode="numeric" value={draft.price} disabled={draft.onRequest} onChange={(event) => onPatch({ price: maskMoney(event.target.value) })} placeholder="0,00" /><small>{draft.onRequest ? 'O cliente consulta o valor com a loja.' : 'Valor aplicado quando nenhuma faixa de desconto é atingida.'}</small></label>
              <label className="check-line"><input type="checkbox" checked={draft.onRequest} onChange={(event) => onPatch({ onRequest: event.target.checked, price: event.target.checked ? '' : draft.price })} /><span>Sob consulta</span></label>
            </div>
            {draft.priceOptions.map((option, optionIndex) => <div className="pr-price-rule" key={option.key}>
              <div className="pr-current-product-image">{draft.mainImage && <img src={draft.mainImage.url} alt="" />}</div>
              <div className="pr-price-rule-fields">
                <label className="field"><span>Nome da faixa</span><input className="input" list={`price-labels-${draft.key}`} value={option.label} onChange={(event) => updateOption(option.key, { label: event.target.value })} placeholder="Ex.: Varejo, Atacarejo" /></label>
                <label className="field"><span>Aplicar quando</span><select className="input" value={option.scope} onChange={(event) => updateOption(option.key, { scope: event.target.value })}><option value="same_product">Atingir peças deste produto</option><option value="cart_quantity">Atingir peças totais no carrinho</option><option value="cart_value">Atingir valor total no carrinho</option></select></label>
                {option.scope === 'cart_value'
                  ? <label className="field"><span>Subtotal mínimo (R$)</span><input className="input" inputMode="numeric" value={option.minCartValue} onChange={(event) => updateOption(option.key, { minCartValue: maskMoney(event.target.value) })} placeholder="0,00" /></label>
                  : <label className="field"><span>Quantidade mínima (peças)</span><input className="input" type="number" min="1" max="999" value={option.minQuantity} onChange={(event) => updateOption(option.key, { minQuantity: event.target.value })} /></label>}
                <label className="field"><span>Preço por unidade (R$)</span><input className="input" inputMode="numeric" value={option.price} disabled={option.onRequest} onChange={(event) => updateOption(option.key, { price: maskMoney(event.target.value) })} placeholder="0,00" /></label>
                <label className="check-line"><input type="checkbox" checked={option.onRequest} onChange={(event) => updateOption(option.key, { onRequest: event.target.checked, price: event.target.checked ? '' : option.price })} /><span>Preço sob consulta</span></label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPatch({ priceOptions: draft.priceOptions.filter((item) => item.key !== option.key) })}>Excluir faixa</button>
              </div>
              <datalist id={`price-labels-${draft.key}`}>{(preferences?.priceLabels || []).map((label) => <option key={label} value={label} />)}</datalist>
              <span className="pr-rule-number">Faixa {optionIndex + 1}</span>
            </div>)}
            {draft.priceOptions.length < 12 && <button type="button" className="btn btn-ghost btn-sm" onClick={addPriceOption}><Icon name="plus" size={16} /> Adicionar faixa de preço</button>}
          </section>

          <section className="pr-editor-section">
            <div className="pr-section-title"><span>3</span><div><h3>Estoque</h3><p>Controle o saldo total do produto ou informe quantidades por variação.</p></div></div>
            <label className="check-line"><input type="checkbox" checked={draft.stockEnabled} onChange={(event) => onPatch({ stockEnabled: event.target.checked })} /><span>Controlar estoque deste produto</span></label>
            {draft.stockEnabled && <div className="pr-stock-list">
              {images.length > 0 ? images.map((image, imageIndex) => <label className="field pr-stock-row" key={image.key}>
                <span className="pr-stock-product"><img src={image.url} alt="" />{imageIndex === 0 ? 'Principal' : image.label || `Variação ${imageIndex}`}</span>
                <input className="input" type="number" min="0" max="1000000" value={image.stockQuantity || '0'} onChange={(event) => {
                  const value = event.target.value;
                  if (imageIndex === 0) onPatch({ mainImage: { ...draft.mainImage, stockQuantity: value } });
                  else onPatch({ variations: draft.variations.map((row) => row.key === image.key ? { ...row, stockQuantity: value } : row) });
                }} />
              </label>) : <div className="pr-stock-row">
                <div className="pr-stock-product">{draft.mainImage && <img src={draft.mainImage.url} alt="" />}<span>Estoque deste produto</span></div>
                <input className="input" type="number" min="0" max="1000000" value={draft.stockQuantity} onChange={(event) => onPatch({ stockQuantity: event.target.value })} />
              </div>}
            </div>}
          </section>

          <section className="pr-editor-section">
            <div className="pr-section-title"><span>4</span><div><h3>Detalhes e conferência</h3><p>Revise a imagem, as variações, os preços e complete as informações do produto.</p></div></div>
            <div className="pr-review-card">
              <div className="pr-review-photos">{images.map((image) => <img key={image.key} src={image.url} alt={image.label || 'Foto do produto'} />)}{!images.length && <span>Sem foto</span>}</div>
              <p><strong>{draft.name || 'Nome do produto'}</strong> · {draft.category || 'Categoria'}</p>
              <p>{draft.variations.length ? `${draft.variations.length} ${plural(draft.variations.length, 'variação', 'variações')}` : 'Sem variações'} · {draft.onRequest ? 'Preço sob consulta' : draft.price ? `Base ${draft.price}` : 'Preço não informado'}</p>
              <p>{draft.stockEnabled ? 'Controle de estoque ativo' : 'Sem controle de estoque'}</p>
            </div>
            <div className="pr-details-fields">
              <label className="field"><span>Nome do produto *</span><input className="input" value={draft.name} maxLength="120" onChange={(event) => onPatch({ name: event.target.value })} placeholder="Ex.: Camiseta básica" /></label>
              <label className="field"><span>Categoria *</span><input className="input" list={`categories-${draft.key}`} value={draft.category} maxLength="60" onChange={(event) => onPatch({ category: event.target.value })} placeholder="Ex.: Roupas" /><datalist id={`categories-${draft.key}`}>{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
              <label className="field pr-description"><span>Descrição</span><textarea className="input" rows="3" maxLength="2000" value={draft.description} onChange={(event) => onPatch({ description: event.target.value })} placeholder="Detalhes que ajudam o cliente a conhecer o produto" /></label>
              <label className="check-line"><input type="checkbox" checked={draft.kind === 'servico'} onChange={(event) => onPatch({ kind: event.target.checked ? 'servico' : 'produto' })} /><span>Este item é um serviço</span></label>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}
