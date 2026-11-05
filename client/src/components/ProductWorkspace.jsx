import { useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';
import { IMAGE_ACCEPT } from '../lib/contract/image.js';
import { centsToMasked, maskMoney, moneyToCents, plural } from '../lib/format.js';
import { generateEan13 } from '../lib/barcode.js';
import { prepareProductImage } from '../lib/portfolio/imageTools.js';

const MAX_IMAGES = 12;
const MAX_BATCH = 30;
const DEFAULT_VARIATION_TYPES = ['Cor', 'Tamanho', 'Litros', 'Unidade'];
const newKey = () => `draft-${Date.now()}-${Math.random()}`;

async function imageFromFile(file) {
  const { src } = await prepareProductImage(file);
  return { key: newKey(), data: src, url: src, label: '', stockQuantity: '0' };
}

function blankDraft(image = null, activeFlowIds = []) {
  return {
    key: newKey(),
    kind: 'produto',
    name: '',
    category: '',
    description: '',
    barcode: '',
    price: '',
    onRequest: false,
    active: true,
    stockEnabled: false,
    stockQuantity: '0',
    activeFlowIds,
    priceOptions: [],
    mainImage: image,
    variations: [],
  };
}

function variationFields(image) {
  const parsed = Object.entries((image.label || '').split(' · ').map((part) => {
    const separator = part.indexOf(':');
    return separator > 0 ? [part.slice(0, separator).trim(), part.slice(separator + 1).trim()] : ['', ''];
  }).filter(([type]) => type));
  const extra = parsed.find(([type]) => !['cor', 'tamanho'].includes(type.toLocaleLowerCase('pt-BR')));
  const plainLabel = !image.color && !image.size && image.label && !image.label.includes(':');
  return {
    variationType: extra?.[0] || (plainLabel ? 'Outro' : ''),
    variationValue: extra?.[1] || (plainLabel ? image.label : ''),
    customVariationType: extra ? '' : (plainLabel ? 'Variação' : ''),
    customVariationValue: '',
  };
}

function draftFromProduct(product, stockFlows) {
  const rows = product.images || [];
  const variation = (image) => ({
    key: `image-${image.id}`,
    id: image.id,
    url: image.url,
    label: image.label || '',
    color: image.color || '',
    colorHex: image.colorHex || '',
    barcode: image.barcode || '',
    size: image.size || '',
    stockQuantity: String(image.stockQuantity || 0),
    ...variationFields(image),
  });
  const legacyRows = rows.some((image) => image.isPrimary);
  const mainImage = product.mainImage
    ? { key: `image-${product.mainImage.id}`, id: product.mainImage.id, url: product.mainImage.url, stockQuantity: String(product.stockQuantity || 0) }
    : legacyRows
      ? (rows.find((image) => image.isPrimary) ? variation(rows.find((image) => image.isPrimary)) : null)
      : rows[0] || null;
  const variationRows = product.mainImage || legacyRows ? rows.filter((image) => !image.isPrimary) : rows.slice(1);
  return {
    key: `product-${product.id}`,
    id: product.id,
    kind: product.kind,
    name: product.name,
    category: product.category,
    description: product.description,
    barcode: product.barcode || '',
    price: centsToMasked(product.priceCents),
    onRequest: product.priceCents === 0,
    active: product.active,
    stockEnabled: Boolean(product.stockEnabled),
    stockQuantity: String(product.stockQuantity || 0),
    activeFlowIds: product.activeFlowIds || stockFlows.filter((flow) => flow.isDefault).map((flow) => flow.id),
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
    mainImage,
    variations: variationRows.map(variation),
  };
}

function productBody(draft) {
  const name = draft.name.trim();
  const category = draft.category.trim();
  if (name.length < 2) throw new Error('Informe um nome com pelo menos 2 caracteres.');
  if (!category) throw new Error('Informe a categoria.');
  if (!draft.onRequest && !draft.price) throw new Error('Informe o preço base ou marque “Sob consulta”.');
  if (draft.variations.some((image) => {
    const type = image.variationType === 'Outro' ? image.customVariationType : image.variationType;
    return !image.color?.trim() && !image.size?.trim() && !(type?.trim() && image.variationValue?.trim()) && !(image.customVariationType?.trim() && image.customVariationValue?.trim());
  })) {
    throw new Error('Informe pelo menos uma característica para cada foto de variação.');
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

  const images = draft.variations;
  const variationPayload = (image) => {
    const extraType = image.variationType === 'Outro' ? image.customVariationType : image.variationType;
    const details = [
      image.color?.trim() && `Cor: ${image.color.trim()}`,
      image.size?.trim() && `Tamanho: ${image.size.trim()}`,
      image.variationValue?.trim() && extraType?.trim() && `${extraType.trim()}: ${image.variationValue.trim()}`,
      image.customVariationValue?.trim() && `${image.customVariationType.trim()}: ${image.customVariationValue.trim()}`,
    ].filter(Boolean);
    return {
      ...(image.id ? { id: image.id } : { data: image.data }),
      label: details.join(' · ').slice(0, 100),
      color: image.color?.trim() || '',
      colorHex: image.colorHex || '',
      barcode: image.barcode?.trim() || '',
      size: image.size?.trim() || '',
      stockQuantity: Number(image.stockQuantity) || 0,
      priceCents: null,
    };
  };
  return {
    kind: draft.kind,
    name,
    category,
    description: draft.description.trim(),
    barcode: draft.barcode?.trim() || '',
    priceCents: draft.onRequest ? 0 : moneyToCents(draft.price),
    active: draft.active,
    stockEnabled: draft.stockEnabled,
    stockQuantity: Number(draft.stockQuantity) || 0,
    activeFlowIds: draft.activeFlowIds,
    priceOptions,
    mainImage: draft.mainImage ? {
      ...(draft.mainImage.id ? { id: draft.mainImage.id } : { data: draft.mainImage.data }),
    } : null,
    images: images.map(variationPayload),
  };
}

export default function ProductWorkspace({ product, categories, preferences, stockFlows = [], available, onClose, onSaved }) {
  const editing = Boolean(product);
  const toast = useToast();
  const defaultFlowIds = stockFlows.filter((flow) => flow.isDefault).map((flow) => flow.id);
  const [drafts, setDrafts] = useState(() => product ? [draftFromProduct(product, stockFlows)] : []);
  const [draftSteps, setDraftSteps] = useState({});
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pickerId = 'product-batch-photo-picker';
  const existingDraftCount = drafts.length;
  const allDraftsReviewed = drafts.length > 0 && drafts.every((draft) => draftSteps[draft.key] === 4);

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
      setDrafts((current) => [...current, ...prepared.map((image) => blankDraft(image, defaultFlowIds))]);
      setActiveDraftIndex(existingDraftCount);
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
      setDrafts((current) => current.map((item) => item.key === key ? {
        ...item,
        variations: [...item.variations, ...prepared.map((image) => ({ ...image, variationType: '', variationValue: '', customVariationType: '', customVariationValue: '' }))],
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
      const photoSize = payload.reduce((sum, item) => sum + [...item.images, ...(item.mainImage ? [item.mainImage] : [])].reduce((size, image) => size + (image.data?.length || 0), 0), 0);
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

  function addBlankDraft() {
    setActiveDraftIndex(drafts.length);
    setDrafts((current) => {
      if (current.length >= Math.min(available, MAX_BATCH)) return current;
      return [...current, blankDraft(null, defaultFlowIds)];
    });
  }

  function removeCurrentDraft(key) {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
    setDraftSteps((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setActiveDraftIndex((current) => Math.max(0, Math.min(current, drafts.length - 2)));
  }

  return (
    <section className="pr-workspace" aria-labelledby="pr-workspace-title">
      <header className="pr-workspace-head">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>← Voltar aos produtos</button>
        <div>
          <h1 id="pr-workspace-title">{editing ? 'Editar item' : 'Cadastrar produto ou serviço'}</h1>
          <p className="muted">{editing ? 'Siga as etapas para atualizar as informações e conferir antes de salvar.' : 'Preencha uma etapa por vez. Fotos, variações, preços especiais e estoque podem ser adicionados depois.'}</p>
        </div>
        {!editing && <label className={`btn btn-primary pr-photo-picker ${uploading || existingDraftCount >= Math.min(available, MAX_BATCH) ? 'is-disabled' : ''}`} htmlFor={pickerId}>
          <Icon name="plus" size={18} /> {uploading ? 'Preparando fotos...' : 'Adicionar itens com fotos'}
          <input id={pickerId} className="pr-picker-input" type="file" accept={IMAGE_ACCEPT} multiple disabled={uploading || existingDraftCount >= Math.min(available, MAX_BATCH)} onChange={(event) => {
            const files = Array.from(event.currentTarget.files || []);
            event.currentTarget.value = '';
            void addProductsFromPhotos(files);
          }} />
        </label>}
      </header>

      {drafts.length === 0 && <div className="pr-upload-empty rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="pr-upload-empty-icon mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-brand-ink"><Icon name="box" size={30} /></div>
        <h2>Vamos cadastrar seu primeiro item</h2>
        <p>Você pode começar sem foto e preencher as informações por etapas. Se já tiver fotos, cada foto selecionada inicia um cadastro separado.</p>
        <div className="pr-upload-empty-actions">
          <label className={`btn btn-primary ${uploading || existingDraftCount >= Math.min(available, MAX_BATCH) ? 'is-disabled' : ''}`} htmlFor={pickerId}>
            <Icon name="plus" size={18} /> Começar com fotos
          </label>
          <button type="button" className="btn btn-ghost" onClick={() => setDrafts([blankDraft(null, defaultFlowIds)])} disabled={available < 1}>Começar sem foto</button>
        </div>
      </div>}

      {drafts.length > 1 && <nav className="pr-draft-navigation" aria-label="Itens deste cadastro">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveDraftIndex((current) => Math.max(0, current - 1))} disabled={activeDraftIndex === 0}>Anterior</button>
        <label className="field">
          <span>Item {activeDraftIndex + 1} de {drafts.length}</span>
          <select className="input" value={activeDraftIndex} onChange={(event) => setActiveDraftIndex(Number(event.target.value))}>
            {drafts.map((draft, index) => <option key={draft.key} value={index}>{index + 1}. {draft.name || `${draft.kind === 'servico' ? 'Serviço' : 'Produto'} sem nome`} · {draftSteps[draft.key] === 4 ? 'Revisado' : 'Em andamento'}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveDraftIndex((current) => Math.min(drafts.length - 1, current + 1))} disabled={activeDraftIndex >= drafts.length - 1}>Próximo</button>
      </nav>}

      <div className="pr-workspace-cards">
        {drafts[activeDraftIndex] && <ProductDraftCard
          key={drafts[activeDraftIndex].key}
          draft={drafts[activeDraftIndex]}
          index={activeDraftIndex}
          count={drafts.length}
          step={draftSteps[drafts[activeDraftIndex].key] || 0}
          onStepChange={(step, message = '') => {
            setError(message);
            if (!message) setDraftSteps((current) => ({ ...current, [drafts[activeDraftIndex].key]: step }));
          }}
          categories={categories}
          preferences={preferences}
          stockFlows={stockFlows}
          editing={editing}
          uploading={uploading}
          onPatch={(changes) => patchDraft(drafts[activeDraftIndex].key, changes)}
          onReplaceMain={(file) => replaceMainPhoto(drafts[activeDraftIndex].key, file)}
          onAddVariations={(files) => addVariations(drafts[activeDraftIndex].key, files)}
          onRemove={() => removeCurrentDraft(drafts[activeDraftIndex].key)}
          onRemoveVariation={(variationKey) => patchDraft(drafts[activeDraftIndex].key, { variations: drafts[activeDraftIndex].variations.filter((image) => image.key !== variationKey) })}
          onPatchVariation={(variationKey, changes) => patchDraft(drafts[activeDraftIndex].key, { variations: drafts[activeDraftIndex].variations.map((image) => image.key === variationKey ? { ...image, ...changes } : image) })}
        />}
      </div>

      {!editing && drafts.length > 0 && <button type="button" className="btn btn-ghost pr-add-blank" onClick={addBlankDraft} disabled={drafts.length >= Math.min(available, MAX_BATCH)}>
        <Icon name="plus" size={17} /> Adicionar outro produto ou serviço
      </button>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="pr-workspace-footer">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        {!allDraftsReviewed && <span className="muted small">Avance até “Revisar” em cada item para salvar.</span>}
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || uploading || !allDraftsReviewed}>
          {busy ? 'Salvando...' : editing ? 'Salvar alterações' : `Salvar ${plural(drafts.length, 'item', 'itens')}`}
        </button>
      </footer>
    </section>
  );
}

function ProductDraftCard({ draft, index, count, step, onStepChange, categories, preferences, stockFlows, editing, uploading, onPatch, onReplaceMain, onAddVariations, onRemove, onRemoveVariation, onPatchVariation }) {
  const steps = ['Informações', 'Fotos', 'Preço', 'Estoque', 'Revisar'];
  const mainPhotoPickerId = `main-photo-${draft.key}`;
  const variationPickerId = `variation-photo-${draft.key}`;
  const updateOption = (key, changes) => onPatch({ priceOptions: draft.priceOptions.map((option) => option.key === key ? { ...option, ...changes } : option) });
  const addPriceOption = () => onPatch({ priceOptions: [...draft.priceOptions, {
    key: newKey(), label: '', scope: 'same_product', minQuantity: String(draft.priceOptions.length ? Number(draft.priceOptions[draft.priceOptions.length - 1].minQuantity || 1) + 1 : 1), minCartValue: '', price: '', onRequest: false,
  }] });
  const continueStep = () => {
    if (step === 0 && draft.name.trim().length < 2) return onStepChange(step, 'Informe o nome do produto ou serviço.');
    if (step === 0 && !draft.category.trim()) return onStepChange(step, 'Informe uma categoria para organizar este item.');
    if (step === 1 && draft.variations.some((image) => {
      const type = image.variationType === 'Outro' ? image.customVariationType : image.variationType;
      return !image.color?.trim() && !image.size?.trim() && !(type?.trim() && image.variationValue?.trim()) && !(image.customVariationType?.trim() && image.customVariationValue?.trim());
    })) return onStepChange(step, 'Complete a característica de cada foto de variação ou remova a foto.');
    if (step === 2 && !draft.onRequest && !draft.price) return onStepChange(step, 'Informe um preço ou marque “Preço sob consulta”.');
    if (step === 2 && draft.priceOptions.some((option) => !option.label.trim())) return onStepChange(step, 'Dê um nome para cada preço especial ou remova a faixa vazia.');
    if (step === 2 && draft.priceOptions.some((option) => !option.onRequest && !option.price)) return onStepChange(step, 'Informe o preço de cada faixa especial ou marque “Sob consulta”.');
    if (step === 2 && draft.priceOptions.some((option) => option.scope === 'cart_value' ? moneyToCents(option.minCartValue) < 1 : !/^\d+$/.test(option.minQuantity) || Number(option.minQuantity) < 1 || Number(option.minQuantity) > 999)) return onStepChange(step, 'Confira a quantidade ou o valor mínimo de cada faixa especial.');
    if (step === 3 && (!/^\d+$/.test(draft.stockQuantity) || Number(draft.stockQuantity) > 1_000_000)) return onStepChange(step, 'Informe uma quantidade de estoque válida entre 0 e 1.000.000.');
    if (step === 3 && draft.variations.some((image) => !/^\d+$/.test(image.stockQuantity || '0') || Number(image.stockQuantity || 0) > 1_000_000)) return onStepChange(step, 'Confira as quantidades de estoque das variações.');
    onStepChange(step + 1);
  };

  return (
    <article className="pr-product-editor-card">
      <header className="pr-product-card-head">
        <div className="pr-product-number">{index + 1}</div>
        <div><h2>{draft.name || `${draft.kind === 'servico' ? 'Serviço' : 'Produto'} ${index + 1}`}</h2><p>{draft.category || 'Preencha as informações deste item'}</p></div>
        {!editing && count > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`Remover produto ${index + 1}`}>Remover produto</button>}
      </header>

      <nav className="pr-product-steps" aria-label={`Etapas do item ${index + 1}`}>
        {steps.map((label, stepIndex) => <span key={label} className={stepIndex === step ? 'is-current' : stepIndex < step ? 'is-done' : ''}>
          <i>{stepIndex < step ? '✓' : stepIndex + 1}</i><span>{label}</span>
        </span>)}
      </nav>
      <p className="pr-product-step-hint">Etapa {step + 1} de {steps.length}: {[
        'Conte o básico sobre o item.',
        'Adicione uma foto se quiser; variações também são opcionais.',
        'Defina o preço ou deixe para consultar com o cliente.',
        'Estoque e disponibilidade são opcionais.',
        'Confira os dados antes de salvar.',
      ][step]}</p>

      <div className={`pr-product-editor-layout ${step === 1 || step === 4 ? '' : 'is-single'}`}>
        {(step === 1 || step === 4) && <aside className="pr-product-preview">
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
        }

        <div className="pr-product-editor-content">
          {step === 0 && <section className="pr-editor-section">
            <div className="pr-section-title"><span>1</span><div><h3>O que você está cadastrando?</h3><p>Preencha o nome e a categoria para encontrar este item mais facilmente.</p></div></div>
            <div className="seg" role="radiogroup" aria-label="Tipo do item" style={{ '--n': 2 }}>
              <button type="button" role="radio" aria-checked={draft.kind === 'produto'} className={draft.kind === 'produto' ? 'is-on' : ''} onClick={() => onPatch({ kind: 'produto' })}>Produto</button>
              <button type="button" role="radio" aria-checked={draft.kind === 'servico'} className={draft.kind === 'servico' ? 'is-on' : ''} onClick={() => onPatch({ kind: 'servico' })}>Serviço</button>
            </div>
            <div className="pr-details-fields">
              <label className="field"><span>Nome *</span><input className="input" value={draft.name} maxLength="120" onChange={(event) => onPatch({ name: event.target.value })} placeholder={draft.kind === 'servico' ? 'Ex.: Manutenção' : 'Ex.: Camiseta básica'} /></label>
              <label className="field"><span>Categoria *</span><input className="input" list={`categories-${draft.key}`} value={draft.category} maxLength="60" onChange={(event) => onPatch({ category: event.target.value })} placeholder={draft.kind === 'servico' ? 'Ex.: Serviços' : 'Ex.: Roupas'} /><datalist id={`categories-${draft.key}`}>{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
              <label className="field"><span>Código de barras <small>(opcional)</small></span><span className="pr-barcode-row"><input className="input" value={draft.barcode || ''} maxLength={48} onChange={(event) => onPatch({ barcode: event.target.value })} placeholder="Digite ou use um leitor" /><button type="button" className="btn btn-ghost btn-sm" onClick={() => onPatch({ barcode: generateEan13() })}>Gerar</button></span><small>Usado em etiquetas e no PDV.</small></label>
              <label className="field pr-description"><span>Descrição <small>(opcional)</small></span><textarea className="input" rows="3" maxLength="2000" value={draft.description} onChange={(event) => onPatch({ description: event.target.value })} placeholder="Escreva detalhes que ajudem o cliente a conhecer o item" /></label>
            </div>
          </section>}

          {step === 1 && <section className="pr-editor-section">
            <div className="pr-section-title"><span>2</span><div><h3>Fotos e variações</h3><p>A foto principal apresenta o item. Se houver opções como cores ou tamanhos, adicione uma foto para cada uma. Se não houver, pode seguir sem preencher nada.</p></div></div>
            <div className="pr-variation-list">
              {draft.variations.map((image, variationIndex) => <div className="pr-variation-row" key={image.key}>
                <div className="pr-variation-thumb"><img src={image.url} alt={`Variação ${variationIndex + 1} de ${draft.name || `produto ${index + 1}`}`} /><span>Variação {variationIndex + 1}</span></div>
                <div className="pr-variation-fields">
                  <label className="field"><span>Cor <small>(opcional)</small></span><input className="input" value={image.color || ''} maxLength={20} onChange={(event) => onPatchVariation(image.key, { color: event.target.value })} placeholder="Ex.: Azul-marinho" /></label>
                  <label className="field"><span>Tamanho <small>(opcional)</small></span><input className="input" value={image.size || ''} maxLength={20} onChange={(event) => onPatchVariation(image.key, { size: event.target.value })} placeholder="Ex.: M, 42" /></label>
                  <label className="field"><span>Outra característica <small>(opcional)</small></span><select className="input" value={image.variationType || ''} onChange={(event) => onPatchVariation(image.key, { variationType: event.target.value, customVariationType: '' })}>
                    <option value="">Não se aplica</option>
                    {[...new Set([
                      ...(preferences?.variationTypes?.length ? preferences.variationTypes : DEFAULT_VARIATION_TYPES),
                      ...(image.variationType ? [image.variationType] : []),
                    ])].filter((type) => !['cor', 'tamanho'].includes(type.toLocaleLowerCase('pt-BR'))).map((type) => <option key={type} value={type}>{type}</option>)}
                    <option value="Outro">Outro</option>
                  </select></label>
                  <label className="field"><span>Código de barras <small>(opcional)</small></span><input className="input" value={image.barcode || ''} maxLength={48} onChange={(event) => onPatchVariation(image.key, { barcode: event.target.value })} placeholder="Vazio = usa o do produto" /></label>
                  {image.variationType === 'Outro' && <label className="field"><span>Qual característica?</span><input className="input" value={image.customVariationType || ''} maxLength={20} onChange={(event) => onPatchVariation(image.key, { customVariationType: event.target.value })} placeholder="Ex.: Material" /></label>}
                  <label className="field"><span>Valor da característica</span><input className="input" value={image.variationValue || ''} maxLength={20} onChange={(event) => onPatchVariation(image.key, { variationValue: event.target.value })} placeholder={image.variationType === 'Litros' ? 'Ex.: 2 litros' : 'Ex.: Unidade, 500 ml'} disabled={!image.variationType} /></label>
                </div>
                <button type="button" className="btn btn-ghost btn-sm pr-remove-variation" onClick={() => onRemoveVariation(image.key)} aria-label={`Remover só a variação ${variationIndex + 1}`}><Icon name="trash" size={15} /> Remover variação</button>
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
          </section>}

          {step === 2 && <section className="pr-editor-section">
            <div className="pr-section-title"><span>2</span><div><h3>Preço e descontos</h3><p>O preço base é unitário. As faixas definem o preço por peça conforme a quantidade.</p></div></div>
            <div className="pr-base-price">
              <div className="pr-current-product-image">{draft.mainImage && <img src={draft.mainImage.url} alt="" />}</div>
              <label className="field"><span>Preço por unidade</span><input className="input" inputMode="numeric" value={draft.price} disabled={draft.onRequest} onChange={(event) => onPatch({ price: maskMoney(event.target.value) })} placeholder="0,00" /><small>{draft.onRequest ? 'O cliente precisa consultar o valor.' : 'Preço normal de uma unidade.'}</small></label>
              <label className="check-line"><input type="checkbox" checked={draft.onRequest} onChange={(event) => onPatch({ onRequest: event.target.checked, price: event.target.checked ? '' : draft.price })} /><span>Preço sob consulta</span></label>
            </div>
            {draft.priceOptions.map((option, optionIndex) => <div className="pr-price-rule" key={option.key}>
              <div className="pr-current-product-image">{draft.mainImage && <img src={draft.mainImage.url} alt="" />}</div>
              <div className="pr-price-rule-fields">
                <label className="field"><span>Nome da faixa</span><input className="input" list={`price-labels-${draft.key}`} value={option.label} onChange={(event) => updateOption(option.key, { label: event.target.value })} placeholder="Ex.: Varejo, Atacarejo" /></label>
                <label className="field"><span>Aplicar quando</span><select className="input" value={option.scope} onChange={(event) => updateOption(option.key, { scope: event.target.value })}><option value="same_product">Comprar esta quantidade deste item</option><option value="cart_quantity">Comprar esta quantidade de itens no total</option><option value="cart_value">O carrinho atingir este valor</option></select></label>
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
          </section>}

          {step === 3 && <section className="pr-editor-section">
            <div className="pr-section-title"><span>3</span><div><h3>Estoque</h3><p>Controle o saldo total do produto ou informe quantidades por variação.</p></div></div>
            <label className="check-line pr-active-check"><input type="checkbox" checked={draft.active} onChange={(event) => onPatch({ active: event.target.checked })} /><span>Este item está ativo e pode aparecer nas vendas</span></label>
            <label className="check-line"><input type="checkbox" checked={draft.stockEnabled} onChange={(event) => onPatch({ stockEnabled: event.target.checked })} /><span>Controlar estoque deste produto</span></label>
            {stockFlows.length > 1 && <fieldset className="pr-stock-flow-options">
              <legend>Produto disponível nos fluxos</legend>
              <p className="muted small">A disponibilidade independe do saldo. Um fluxo desativado não exibe o produto no site nem no PDV desse fluxo.</p>
              {stockFlows.map((flow) => <label className="check-line" key={flow.id}>
                <input type="checkbox" checked={draft.activeFlowIds.includes(flow.id)} onChange={(event) => onPatch({
                  activeFlowIds: event.target.checked
                    ? [...new Set([...draft.activeFlowIds, flow.id])]
                    : draft.activeFlowIds.filter((id) => id !== flow.id),
                })} />
                <span>{flow.name}{flow.isDefault ? ' (site e fluxo principal)' : ''}</span>
              </label>)}
            </fieldset>}
            {draft.stockEnabled && <div className="pr-stock-list">
              {draft.variations.length > 0 ? draft.variations.map((image, imageIndex) => <label className="field pr-stock-row" key={image.key}>
                <span className="pr-stock-product"><img src={image.url} alt="" />{image.label || `Variação ${imageIndex + 1}`}</span>
                <input className="input" type="number" min="0" max="1000000" value={image.stockQuantity || '0'} onChange={(event) => {
                  const value = event.target.value;
                  onPatch({ variations: draft.variations.map((row) => row.key === image.key ? { ...row, stockQuantity: value } : row) });
                }} />
              </label>) : <div className="pr-stock-row">
                <div className="pr-stock-product">{draft.mainImage && <img src={draft.mainImage.url} alt="" />}<span>Estoque deste produto</span></div>
                <input className="input" type="number" min="0" max="1000000" value={draft.stockQuantity} onChange={(event) => onPatch({ stockQuantity: event.target.value })} />
              </div>}
            </div>}
          </section>}

          {step === 4 && <section className="pr-editor-section">
            <div className="pr-section-title"><span>4</span><div><h3>Detalhes e conferência</h3><p>Revise a imagem, as variações, os preços e complete as informações do produto.</p></div></div>
            <div className="pr-review-card">
              <div className="pr-review-photos">{draft.mainImage && <figure><img src={draft.mainImage.url} alt="Imagem principal" /><figcaption>Imagem principal</figcaption></figure>}{draft.variations.map((image, imageIndex) => <figure key={image.key}><img src={image.url} alt={`Foto da variação ${imageIndex + 1}`} /><figcaption>{image.label || `Variação ${imageIndex + 1}`}</figcaption></figure>)}{!draft.mainImage && !draft.variations.length && <span>Sem foto</span>}</div>
              <p><strong>{draft.name || 'Nome do item'}</strong> · {draft.category || 'Categoria'}</p>
              <p>{draft.kind === 'servico' ? 'Serviço' : 'Produto'} · {draft.variations.length ? `${draft.variations.length} ${plural(draft.variations.length, 'variação', 'variações')}` : 'Sem variações'} · {draft.onRequest ? 'Preço sob consulta' : draft.price ? `Preço: R$ ${draft.price}` : 'Preço não informado'}</p>
              <p>{draft.stockEnabled ? 'Controle de estoque ativo' : 'Sem controle de estoque'} · {draft.active ? 'Ativo' : 'Inativo'}</p>
              {draft.description && <p>{draft.description}</p>}
            </div>
          </section>}
        </div>
      </div>
      <footer className="pr-product-step-footer">
        <button type="button" className="btn btn-ghost" onClick={() => onStepChange(step - 1)} disabled={step === 0}>Voltar</button>
        {step < steps.length - 1 && <button type="button" className="btn btn-primary" onClick={continueStep}>Próxima etapa</button>}
        {step === steps.length - 1 && <span className="muted small">Item conferido. Use “Salvar” ao final da página.</span>}
      </footer>
    </article>
  );
}
