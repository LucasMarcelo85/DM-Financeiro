import { useMemo, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { IMAGE_ACCEPT } from '../lib/contract/image.js';
import { centsToMasked, maskMoney, moneyToCents, plural } from '../lib/format.js';
import { generateEan13 } from '../lib/barcode.js';
import { prepareProductImage } from '../lib/portfolio/imageTools.js';
import { colorHexForName, colorNameForHex, normalizeProductColorName, PRODUCT_COLOR_SUGGESTIONS, PRODUCT_COLOR_VARIATION_SUGGESTIONS } from '../lib/productColors.js';
import { buildVariationCombinations } from '../lib/product-variations.js';
import { MAX_PRODUCT_IMAGES, MAX_PRODUCT_VARIATIONS } from '../../../shared/product-limits.js';

const MAX_BATCH = 30;
const newKey = () => `draft-${Date.now()}-${Math.random()}`;
const hasPhoto = (image) => Boolean(image?.data || image?.url || image?.externalUrl);
const photoCount = (draft) => Number(hasPhoto(draft.mainImage)) + draft.variations.filter(hasPhoto).length;

function normalizeSuggestion(value) {
  return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function uniqueSuggestions(values) {
  const distinct = new Map();
  for (const value of values) {
    const label = typeof value === 'string' ? value.trim() : '';
    const key = normalizeSuggestion(label);
    if (label && !distinct.has(key)) distinct.set(key, label);
  }
  return [...distinct.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function uniqueColorSuggestions(values, sort = true) {
  const distinct = new Map();
  for (const value of values) {
    const label = typeof value === 'string' ? value.trim() : '';
    const key = normalizeProductColorName(label);
    if (label && !distinct.has(key)) distinct.set(key, label);
  }
  const result = [...distinct.values()];
  return sort ? result.sort((a, b) => a.localeCompare(b, 'pt-BR')) : result;
}

function collectVariationSuggestions(products, drafts) {
  const colors = [];
  const sizes = [];
  const types = [];
  const colorHexByName = new Map();
  const valuesByType = new Map();
  const addColor = (name, hex) => {
    const label = String(name || '').trim();
    if (!label) return;
    colors.push(label);
    const colorHex = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex.toLowerCase() : colorHexForName(label);
    if (colorHex) colorHexByName.set(normalizeProductColorName(label), colorHex);
  };
  const addAttribute = (type, value, hex = '') => {
    const label = String(type || '').trim();
    const sample = String(value || '').trim();
    if (!label) return;
    const normalized = normalizeSuggestion(label);
    if (normalized === 'cor') {
      addColor(sample, hex);
      return;
    }
    if (normalized === 'tamanho') {
      if (sample) sizes.push(sample);
      return;
    }
    types.push(label);
    if (sample) valuesByType.set(normalized, [...(valuesByType.get(normalized) || []), sample]);
  };

  for (const product of [...(products || []), ...(drafts || [])]) {
    for (const image of [...(product.images || []), ...(product.variations || [])]) {
      if (image.color) addColor(image.color, image.colorHex);
      if (image.size) sizes.push(image.size);
      const type = image.variationType === 'Outro' ? image.customVariationType : image.variationType;
      addAttribute(type, image.variationValue, image.colorHex);
      addAttribute(image.customVariationType, image.customVariationValue, image.colorHex);
      for (const part of String(image.label || '').split(' · ')) {
        const separator = part.indexOf(':');
        if (separator > 0) addAttribute(part.slice(0, separator), part.slice(separator + 1), image.colorHex);
      }
    }
  }

  const featuredColors = PRODUCT_COLOR_SUGGESTIONS.slice(0, 6);
  return {
    colorOptions: uniqueColorSuggestions([
      ...featuredColors,
      ...PRODUCT_COLOR_VARIATION_SUGGESTIONS,
      ...PRODUCT_COLOR_SUGGESTIONS.slice(featuredColors.length),
      ...colors,
    ], false),
    sizes: uniqueSuggestions(sizes),
    types: uniqueSuggestions(types),
    colorHexByName: Object.fromEntries(colorHexByName),
    valuesByType: Object.fromEntries([...valuesByType].map(([type, values]) => [normalizeSuggestion(type), uniqueSuggestions(values)])),
  };
}

function SuggestionButtons({ label, options = [], onSelect, swatchFor, caption = 'Usados antes:', limit = 8 }) {
  if (!options.length) return null;
  return (
    <div className="pr-suggestions" role="group" aria-label={label}>
      <small>{caption}</small>
      {options.slice(0, limit).map((option) => {
        const value = typeof option === 'string' ? option : option.label;
        const swatch = swatchFor?.(value);
        return (
          <button type="button" className="pr-suggestion-chip" key={value} onClick={() => onSelect(value)} title={`Usar ${value}`}>
            {swatch && <i className="pr-suggestion-swatch" style={{ '--pr-swatch': swatch }} aria-hidden="true" />}
            {value}
          </button>
        );
      })}
    </div>
  );
}

function explainProductError(message) {
  const value = String(message || '');
  if (/nome de cada faixa|nome de cada forma/i.test(value)) return { message: 'Dê um nome para identificar cada faixa especial.', field: 'price-option-name', step: 2 };
  if (/pre[cç]o de cada faixa|valor por unidade/i.test(value)) return { message: 'Informe o preço por unidade da faixa especial ou marque “Sob consulta”.', field: 'price-option-price', step: 2 };
  if (/valor m[ií]nimo|quantidade m[ií]nima/i.test(value)) return { message: 'Informe o valor mínimo necessário para aplicar esta faixa especial.', field: 'price-option-min', step: 2 };
  const rules = [
    [/categor/i, { message: 'Informe uma categoria para organizar este produto.', field: 'category', step: 1 }],
    [/c[oó]digo de barras|barcode/i, { message: 'O código de barras está inválido ou já está sendo usado. Confira este campo.', field: 'barcode', step: 1 }],
    [/pre[cç]o base|pre[cç]o por unidade/i, { message: 'Informe o preço do produto ou marque “Preço sob consulta”.', field: 'price', step: 2 }],
    [/faixa|forma de pre[cç]o|carrinho/i, { message: 'Confira o nome, o valor mínimo e o preço da faixa especial.', field: 'price-option', step: 2 }],
    [/nome/i, { message: 'O nome do produto precisa ter pelo menos 2 caracteres. Confira o campo Nome.', field: 'name', step: 1 }],
    [/caracter[ií]stica|varia[cç][aã]o|cor informada/i, { message: 'Complete as características da foto de variação ou remova essa foto.', field: 'variation', step: 0 }],
    [/estoque|quantidade v[aá]lida/i, { message: 'Informe uma quantidade de estoque entre 0 e 1.000.000.', field: 'stock', step: 0 }],
    [/imagem|foto|url https/i, { message: 'A imagem não pôde ser salva. Confira o arquivo ou a URL e tente novamente.', field: 'main-image', step: 0 }],
    [/fluxo/i, { message: 'A disponibilidade nos fluxos mudou. Confira os fluxos selecionados na seção Variações e estoque.', field: 'stock-flow', step: 0 }],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1]
    || { message: /internal server error|prisma|constraint|payload too large/i.test(value)
      ? 'Não foi possível salvar o produto. Confira os dados e as imagens; se o erro continuar, tente novamente mais tarde.'
      : value || 'Não foi possível salvar o produto. Confira os campos e tente novamente.' };
}

function focusProductField(field) {
  if (!field) return;
  requestAnimationFrame(() => {
    const selectors = {
      name: '.pr-details-fields label:nth-child(1) input',
      category: '.pr-details-fields label:nth-child(2) input',
      barcode: '.pr-details-fields label:nth-child(5) input',
      price: '.pr-details-fields label:nth-child(3) input',
      'price-option': '.pr-inline-prices input',
      'price-option-name': '.pr-inline-prices input',
      'price-option-min': '.pr-inline-prices input',
      'price-option-price': '.pr-inline-prices input',
      variation: '.pr-variation-fields input, .pr-variation-fields select',
      stock: '.pr-stock-input input',
      'main-image': '.pr-main-photo',
      'stock-flow': '.pr-stock-flow-options input',
    };
    const target = document.querySelector(`.pr-product-editor-card ${selectors[field] || ''}`);
    if (field === 'main-image') target?.setAttribute('tabindex', '-1');
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.focus();
  });
}

async function imageFromFile(file) {
  const { src } = await prepareProductImage(file);
  return { key: newKey(), data: src, url: src, label: '', stockQuantity: '0' };
}

function priceRuleHint(option) {
  if (option.scope === 'cart_value') return `Carrinho a partir de R$ ${option.minCartValue || '0,00'}`;
  if (option.scope === 'cart_quantity') return `A partir de ${option.minQuantity || 1} un. no carrinho`;
  return `A partir de ${option.minQuantity || 1} un. deste produto`;
}

function blankDraft(image = null, activeFlowIds = [], priceRules = []) {
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
    legacyOptions: [],
    priceOptions: priceRules.map((rule) => ({
      key: newKey(),
      label: rule.label,
      scope: rule.scope,
      minQuantity: String(rule.minQuantity || 1),
      minCartValue: centsToMasked(rule.minCartCents || 0),
      price: '',
      onRequest: false,
    })),
    mainImage: image,
    variations: [],
  };
}

function ProductImageUrl({ onAdd, disabled = false, label = 'Imagem principal por URL' }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    let parsed;
    try { parsed = new URL(url.trim()); } catch { setError('Informe uma URL válida de imagem.'); return; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.href.length > 2048) {
      setError('Use uma URL pública HTTPS válida, sem usuário ou senha.');
      return;
    }
    setBusy(true);
    try {
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = () => reject(new Error('Não foi possível carregar a imagem. Verifique a URL e tente novamente.'));
        image.src = parsed.href;
      });
      onAdd(parsed.href);
      setUrl('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pr-image-url" onSubmit={submit}>
      <label className="field">
        <span>{label}</span>
        <input className="input" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://exemplo.com/imagem.jpg" disabled={disabled || busy} />
      </label>
      <button type="submit" className="btn btn-ghost btn-sm" disabled={disabled || busy || !url.trim()}>{busy ? 'Verificando...' : 'Usar URL'}</button>
      {error && <small className="form-error" role="alert">{error}</small>}
    </form>
  );
}

function variationFields(image) {
  const parsed = (image.label || '').split(' · ').map((part) => {
    const separator = part.indexOf(':');
    return separator > 0 ? [part.slice(0, separator).trim(), part.slice(separator + 1).trim()] : ['', ''];
  }).filter(([type]) => type);
  const extra = parsed.find(([type]) => !['cor', 'tamanho'].includes(type.toLocaleLowerCase('pt-BR')));
  const plainLabel = !image.color && !image.size && image.label && !image.label.includes(':');
  return {
    variationType: extra?.[0] || (plainLabel ? 'Outro' : ''),
    variationValue: extra?.[1] || (plainLabel ? image.label : ''),
    customVariationType: extra ? '' : (plainLabel ? 'Variação' : ''),
    customVariationValue: '',
  };
}

function draftFromProduct(product, stockFlows, priceRules = []) {
  const rows = product.images || [];
  const variation = (image) => ({
    key: `image-${image.id}`,
    id: image.id,
    url: image.url || null,
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
      : Object.hasOwn(product, 'mainImage') ? null : rows[0] || null;
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
    priceOptions: priceRules.map((rule) => {
      const match = (product.priceOptions || []).find((option) => normalizeSuggestion(option.label) === normalizeSuggestion(rule.label));
      return {
        key: match ? `option-${match.id}` : newKey(),
        ...(match ? { id: match.id } : {}),
        label: rule.label,
        scope: rule.scope || 'same_product',
        minQuantity: String(rule.minQuantity || 1),
        minCartValue: centsToMasked(rule.minCartCents || 0),
        price: match && match.priceCents !== null ? centsToMasked(match.priceCents) : '',
        onRequest: false,
      };
    }),
    legacyOptions: (product.priceOptions || [])
      .filter((option) => !priceRules.some((rule) => normalizeSuggestion(rule.label) === normalizeSuggestion(option.label)))
      .map((option) => ({ id: option.id, label: option.label, priceCents: option.priceCents, minQuantity: option.minQuantity || 1, scope: option.scope || 'same_product', minCartCents: option.minCartCents || 0 })),
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

  const priceOptions = [
    ...draft.priceOptions.filter((option) => moneyToCents(option.price) > 0).map((option) => ({
      ...(option.id ? { id: option.id } : {}),
      label: option.label.trim(),
      priceCents: moneyToCents(option.price),
      minQuantity: Number(option.minQuantity) || 1,
      scope: option.scope,
      minCartCents: moneyToCents(option.minCartValue),
    })),
    ...(draft.legacyOptions || []),
  ];

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
      ...(image.id ? { id: image.id } : {}),
      ...(image.data ? { data: image.data } : image.externalUrl ? { url: image.externalUrl } : image.imageRemoved ? { removeImage: true } : {}),
      label: details.join(' · ').slice(0, 100),
      color: image.color?.trim() || '',
      colorHex: image.colorHex || colorHexForName(image.color) || '',
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
      ...(draft.mainImage.id ? { id: draft.mainImage.id } : draft.mainImage.externalUrl ? { url: draft.mainImage.externalUrl } : { data: draft.mainImage.data }),
    } : null,
    images: images.map(variationPayload),
  };
}

export default function ProductWorkspace({ product, products = [], categories, preferences, stockFlows = [], available, onClose, onSaved }) {
  const editing = Boolean(product);
  const toast = useToast();
  const defaultFlowIds = stockFlows.filter((flow) => flow.isDefault).map((flow) => flow.id);
  const [drafts, setDrafts] = useState(() => product
    ? [draftFromProduct(product, stockFlows, preferences?.priceRules || [])]
    : [blankDraft(null, defaultFlowIds, preferences?.priceRules || [])]);
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);
  const categorySuggestions = useMemo(() => uniqueSuggestions([...(categories || []), ...drafts.map((draft) => draft.category)]), [categories, drafts]);
  const variationSuggestions = useMemo(() => collectVariationSuggestions(products, drafts), [products, drafts]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pickerId = 'product-batch-photo-picker';
  const isUntouchedDraft = (draft) => !draft.name.trim() && !draft.category.trim() && !draft.description.trim()
    && !draft.barcode.trim() && !draft.price && !draft.onRequest && !draft.mainImage
    && !draft.variations.length && !draft.stockEnabled && draft.active;
  const replaceUntouchedDraft = !editing && drafts.length === 1 && isUntouchedDraft(drafts[0]);
  const existingDraftCount = drafts.length - Number(replaceUntouchedDraft);

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
      setDrafts((current) => [
        ...(replaceUntouchedDraft ? [] : current),
        ...prepared.map((image) => blankDraft(image, defaultFlowIds, preferences?.priceRules || [])),
      ]);
      setActiveDraftIndex(existingDraftCount);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function replaceMainPhoto(key, file) {
    if (!file) return;
    const draft = drafts.find((item) => item.key === key);
    if (!draft) return;
    if (!hasPhoto(draft.mainImage) && photoCount(draft) >= MAX_PRODUCT_IMAGES) {
      setError(`Este produto pode ter no máximo ${MAX_PRODUCT_IMAGES} fotos.`);
      return;
    }
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

  function replaceMainPhotoWithUrl(key, url) {
    const draft = drafts.find((item) => item.key === key);
    if (!draft) return;
    if (!hasPhoto(draft.mainImage) && photoCount(draft) >= MAX_PRODUCT_IMAGES) {
      setError(`Este produto pode ter no máximo ${MAX_PRODUCT_IMAGES} fotos.`);
      return;
    }
    setDrafts((current) => current.map((draft) => draft.key === key ? {
      ...draft,
      mainImage: { key: newKey(), url, externalUrl: url, stockQuantity: draft.mainImage?.stockQuantity || '0' },
    } : draft));
  }

  function addBlankVariation(key) {
    const draft = drafts.find((item) => item.key === key);
    if (!draft || draft.variations.length >= MAX_PRODUCT_VARIATIONS) return;
    setDrafts((current) => current.map((item) => item.key === key ? {
      ...item,
      variations: [...item.variations, { key: newKey(), url: null, label: '', stockQuantity: '0', variationType: '', variationValue: '', customVariationType: '', customVariationValue: '' }],
    } : item));
  }

  async function replaceVariation(key, variationKey, file) {
    if (!file) return;
    const draft = drafts.find((item) => item.key === key);
    const variation = draft?.variations.find((image) => image.key === variationKey);
    if (!draft || !variation) return;
    if (!hasPhoto(variation) && photoCount(draft) >= MAX_PRODUCT_IMAGES) {
      setError(`Este produto pode ter no máximo ${MAX_PRODUCT_IMAGES} fotos.`);
      return;
    }
    setUploading(true);
    setError('');
    try {
      const photo = await imageFromFile(file);
      setDrafts((current) => current.map((draft) => draft.key === key ? {
        ...draft,
        variations: draft.variations.map((image) => image.key === variationKey ? {
          ...image, ...photo, key: image.key, id: image.id, stockQuantity: image.stockQuantity,
        } : image),
      } : draft));
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setError('');
    const payload = [];
    for (let index = 0; index < drafts.length; index += 1) {
      try {
        payload.push(productBody(drafts[index]));
      } catch (e) {
        const issue = explainProductError(e.message);
        setActiveDraftIndex(index);
        setError(issue.message);
        focusProductField(issue.field);
        return;
      }
    }
    try {
      const photoSize = payload.reduce((sum, item) => sum + [...item.images, ...(item.mainImage ? [item.mainImage] : [])].reduce((size, image) => size + (image.data?.length || 0), 0), 0);
      if (photoSize > 32 * 1024 * 1024) throw new Error('O lote de fotos ficou muito grande. Cadastre menos produtos ou reduza o número de imagens.');
    } catch (e) {
      const issue = explainProductError(e.message);
      setError(issue.message);
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
      const issue = explainProductError(e.message);
      setError(issue.message);
      if (issue.step !== undefined && drafts[activeDraftIndex]) {
        focusProductField(issue.field);
      }
      setBusy(false);
    }
  }

  function addBlankDraft() {
    setActiveDraftIndex(drafts.length);
    setDrafts((current) => {
      if (current.length >= Math.min(available, MAX_BATCH)) return current;
      return [...current, blankDraft(null, defaultFlowIds, preferences?.priceRules || [])];
    });
  }

  function removeCurrentDraft(key) {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
    setActiveDraftIndex((current) => Math.max(0, Math.min(current, drafts.length - 2)));
  }

  return (
    <Modal title={editing ? 'Editar produto' : 'Cadastrar produto'} onClose={busy ? () => {} : onClose} wide>
      <section className="pr-workspace" aria-label={editing ? 'Editar produto' : 'Cadastrar produto'}>
        {!editing && <div className="pr-workspace-head">
          <p className="muted">Preencha as informações, adicione variações e configure o estoque em uma única tela.</p>
          <label className={`btn btn-ghost pr-photo-picker ${uploading || existingDraftCount >= Math.min(available, MAX_BATCH) ? 'is-disabled' : ''}`} htmlFor={pickerId}>
            <Icon name="plus" size={18} /> {uploading ? 'Preparando fotos...' : 'Adicionar itens com fotos'}
            <input id={pickerId} className="pr-picker-input" type="file" accept={IMAGE_ACCEPT} multiple disabled={uploading || existingDraftCount >= Math.min(available, MAX_BATCH)} onChange={(event) => {
              const files = Array.from(event.currentTarget.files || []);
              event.currentTarget.value = '';
              void addProductsFromPhotos(files);
            }} />
          </label>
        </div>}

      {drafts.length > 1 && <nav className="pr-draft-navigation" aria-label="Itens deste cadastro">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveDraftIndex((current) => Math.max(0, current - 1))} disabled={activeDraftIndex === 0}>Anterior</button>
        {drafts[activeDraftIndex]?.mainImage?.url
          ? <img className="pr-draft-thumb" src={drafts[activeDraftIndex].mainImage.url} alt={`Imagem do item ${activeDraftIndex + 1}`} />
          : <span className="pr-draft-thumb is-empty" aria-hidden="true"><Icon name="box" size={20} /></span>}
        <label className="field">
          <span className="pr-draft-count" aria-live="polite">Item {activeDraftIndex + 1} de {drafts.length}</span>
          <select className="input" value={activeDraftIndex} onChange={(event) => setActiveDraftIndex(Number(event.target.value))}>
            {drafts.map((draft, index) => <option key={draft.key} value={index}>{index + 1}. {draft.name || `${draft.kind === 'servico' ? 'Serviço' : 'Produto'} sem nome`}</option>)}
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
          categories={categorySuggestions}
          variationSuggestions={variationSuggestions}
          preferences={preferences}
          stockFlows={stockFlows}
          editing={editing}
          uploading={uploading}
          onPatch={(changes) => patchDraft(drafts[activeDraftIndex].key, changes)}
          onReplaceMain={(file) => replaceMainPhoto(drafts[activeDraftIndex].key, file)}
          onReplaceMainUrl={(url) => replaceMainPhotoWithUrl(drafts[activeDraftIndex].key, url)}
          onAddBlankVariation={() => addBlankVariation(drafts[activeDraftIndex].key)}
          onReplaceVariation={(variationKey, file) => replaceVariation(drafts[activeDraftIndex].key, variationKey, file)}
          onRemove={() => removeCurrentDraft(drafts[activeDraftIndex].key)}
          onRemoveVariation={(variationKey) => patchDraft(drafts[activeDraftIndex].key, { variations: drafts[activeDraftIndex].variations.filter((image) => image.key !== variationKey) })}
          onPatchVariation={(variationKey, changes) => patchDraft(drafts[activeDraftIndex].key, { variations: drafts[activeDraftIndex].variations.map((image) => image.key === variationKey ? { ...image, ...changes } : image) })}
          onSortVariations={() => setDrafts((current) => current.map((draft) => {
            if (draft.key !== drafts[activeDraftIndex].key) return draft;
            const variations = [...draft.variations].sort((a, b) => {
              const label = (image) => [image.color, image.size, image.label].filter(Boolean).join(' ');
              return label(a).localeCompare(label(b), 'pt-BR', { sensitivity: 'base', numeric: true });
            });
            return { ...draft, variations };
          }))}
        />}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="pr-workspace-footer">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || uploading || !drafts.length}>
          {busy ? 'Salvando...' : editing ? 'Salvar alterações' : `Salvar ${plural(drafts.length, 'item', 'itens')}`}
        </button>
      </footer>
      </section>
    </Modal>
  );
}

function ProductDraftCard({ draft, index, count, categories, variationSuggestions, preferences, stockFlows, editing, uploading, onPatch, onReplaceMain, onReplaceMainUrl, onAddBlankVariation, onReplaceVariation, onRemove, onRemoveVariation, onPatchVariation, onSortVariations }) {
  const mainPhotoPickerId = `main-photo-${draft.key}`;
  const colorListId = `variation-colors-${draft.key}`;
  const sizeListId = `variation-sizes-${draft.key}`;
  const [combinationColors, setCombinationColors] = useState('');
  const [combinationSizes, setCombinationSizes] = useState('');
  const [combinationMessage, setCombinationMessage] = useState(null);
  const currentPhotoCount = photoCount(draft);
  const updateOption = (key, changes) => onPatch({ priceOptions: draft.priceOptions.map((option) => option.key === key ? { ...option, ...changes } : option) });
  const setColorName = (image, name) => {
    const mappedHex = variationSuggestions?.colorHexByName?.[normalizeProductColorName(name)] || colorHexForName(name);
    const sameName = normalizeProductColorName(image.color) === normalizeProductColorName(name);
    onPatchVariation(image.key, {
      color: name,
      colorHex: mappedHex || (!image.color?.trim() || sameName ? image.colorHex || '' : ''),
    });
  };
  const setColorSample = (image, hex) => {
    const colorName = colorNameForHex(hex);
    onPatchVariation(image.key, { colorHex: hex, ...(colorName ? { color: colorName } : {}) });
  };
  function generateCombinations() {
    try {
      const { combinations, skipped } = buildVariationCombinations(
        combinationColors,
        combinationSizes,
        draft.variations,
        MAX_PRODUCT_VARIATIONS,
      );
      onPatch({
        variations: [
          ...draft.variations,
          ...combinations.map(({ color, size }) => ({
            key: newKey(),
            url: null,
            label: '',
            color,
            colorHex: colorHexForName(color) || '',
            size,
            stockQuantity: '0',
            variationType: '',
            variationValue: '',
            customVariationType: '',
            customVariationValue: '',
          })),
        ],
      });
      setCombinationMessage({
        kind: 'success',
        text: `${plural(combinations.length, 'variação adicionada', 'variações adicionadas')}${skipped ? `; ${skipped} combinação(ões) já existente(s) ignorada(s).` : '.'}`,
      });
    } catch (error) {
      setCombinationMessage({ kind: 'error', text: error.message });
    }
  }
  return (
    <article className="pr-product-editor-card">
      <header className="pr-product-card-head">
        <div className="pr-product-number">{index + 1}</div>
        <div><h2>{draft.name || `${draft.kind === 'servico' ? 'Serviço' : 'Produto'} ${index + 1}`}</h2><p>{draft.category || 'Preencha as informações deste item'}</p></div>
        {!editing && count > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`Remover produto ${index + 1}`}>Remover produto</button>}
      </header>

      <div className="pr-product-editor-layout">
        <aside className="pr-product-preview">
          <label className="pr-main-photo" htmlFor={mainPhotoPickerId} aria-label={draft.mainImage ? 'Trocar foto principal' : 'Adicionar foto principal'}>
            <input id={mainPhotoPickerId} className="pr-picker-input" type="file" accept={IMAGE_ACCEPT} disabled={uploading || (!hasPhoto(draft.mainImage) && currentPhotoCount >= MAX_PRODUCT_IMAGES)} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void onReplaceMain(file);
            }} />
            {draft.mainImage ? <img src={draft.mainImage.url} alt={`Foto principal de ${draft.name || `produto ${index + 1}`}`} /> : <><Icon name="box" size={32} /><span>Adicionar foto principal</span></>}
            {draft.mainImage && <span className="pr-photo-change">Trocar foto</span>}
          </label>
          <strong>Foto principal</strong>
          <small className="muted">Esta é a imagem de referência para os dados abaixo.</small>
            <ProductImageUrl onAdd={onReplaceMainUrl} disabled={uploading || (!hasPhoto(draft.mainImage) && currentPhotoCount >= MAX_PRODUCT_IMAGES)} />
            {draft.variations.some((image) => image.url) && <div className="pr-mini-gallery">{draft.variations.filter((image) => image.url).map((image) => <img key={image.key} src={image.url} alt={image.label || 'Foto de variação'} />)}</div>}
        </aside>

        <div className="pr-product-editor-content">
          <section className="pr-editor-section">
            <div className="pr-section-title"><span>1</span><div><h3>Informações do produto</h3><p>Preencha o nome, a categoria e os preços.</p></div></div>
            <div className="pr-details-fields">
              <label className="field"><span>Nome *</span><input className="input" value={draft.name} maxLength="120" onChange={(event) => onPatch({ name: event.target.value })} placeholder={draft.kind === 'servico' ? 'Ex.: Manutenção' : 'Ex.: Camiseta básica'} /></label>
              <label className="field"><span>Categoria *</span><input className="input" list={`categories-${draft.key}`} value={draft.category} maxLength="60" onChange={(event) => onPatch({ category: event.target.value })} placeholder={draft.kind === 'servico' ? 'Ex.: Serviços' : 'Ex.: Roupas'} /><datalist id={`categories-${draft.key}`}>{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
              <div className="pr-inline-prices">
                <label className="field"><span>Preço base (R$)</span><input className="input" inputMode="numeric" value={draft.price} disabled={draft.onRequest} onChange={(event) => onPatch({ price: maskMoney(event.target.value) })} placeholder="0,00" /></label>
                {draft.priceOptions.map((option) => <label className="field" key={option.key}>
                  <span>{option.label} (R$)</span>
                  <input className="input" inputMode="numeric" value={option.price} onChange={(event) => updateOption(option.key, { price: maskMoney(event.target.value), onRequest: false })} placeholder="0,00" />
                  <small>{priceRuleHint(option)}</small>
                </label>)}
              </div>
              <label className="check-line"><input type="checkbox" checked={draft.onRequest} onChange={(event) => onPatch({ onRequest: event.target.checked, price: event.target.checked ? '' : draft.price })} /><span>Preço sob consulta</span></label>
              <label className="field"><span>Código de barras <small>(opcional)</small></span><span className="pr-barcode-row"><input className="input" value={draft.barcode || ''} maxLength={48} onChange={(event) => onPatch({ barcode: event.target.value })} placeholder="Digite ou use um leitor" /><button type="button" className="btn btn-ghost btn-sm" onClick={() => onPatch({ barcode: generateEan13() })}>Gerar</button></span><small>Usado em etiquetas e no PDV.</small></label>
            </div>
          </section>

          <section className="pr-editor-section">
            <div className="pr-section-title"><span>2</span><div><h3>Variações e estoque</h3><p>Adicione cor, tamanho ou ambos e, se controlar estoque, informe a quantidade de cada variação.</p></div></div>
            <div className="pr-stock-mode" role="radiogroup" aria-label="Controle de estoque">
              <button type="button" role="radio" aria-checked={draft.stockEnabled} className={draft.stockEnabled ? 'is-on' : ''} onClick={() => onPatch({ stockEnabled: true })}>Controlar estoque</button>
              <button type="button" role="radio" aria-checked={!draft.stockEnabled} className={!draft.stockEnabled ? 'is-on' : ''} onClick={() => onPatch({ stockEnabled: false })}>Não controlar estoque</button>
            </div>
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
            {draft.stockEnabled && draft.variations.length === 0 && <label className="field pr-stock-input"><span>Estoque do produto (un.)</span><input className="input" type="number" inputMode="numeric" min="0" max="1000000" value={draft.stockQuantity} onChange={(event) => onPatch({ stockQuantity: event.target.value })} /><small>Sem variações, o saldo é do produto inteiro. Para estoque por tamanho ou cor, adicione variações abaixo.</small></label>}
            <button type="button" className="btn btn-ghost btn-sm pr-sort-variations" onClick={onSortVariations} disabled={draft.variations.length < 2}>A–Z <span>Organizar variações</span></button>
            <details className="pr-variation-builder">
              <summary>Gerar combinações de cores e tamanhos</summary>
              <p className="muted small">Separe os valores por vírgula. Serão criadas todas as combinações; as que já existem serão ignoradas.</p>
              <div className="pr-variation-builder-fields">
                <label className="field"><span>Cores</span><textarea className="input" rows={2} maxLength={500} value={combinationColors} onChange={(event) => setCombinationColors(event.target.value)} placeholder="Azul-marinho, Preto, Café" /></label>
                <label className="field"><span>Tamanhos</span><textarea className="input" rows={2} maxLength={500} value={combinationSizes} onChange={(event) => setCombinationSizes(event.target.value)} placeholder="P, M, G" /></label>
              </div>
              <div className="pr-variation-builder-actions">
                <small className="muted">{draft.variations.length}/{MAX_PRODUCT_VARIATIONS} variações · {currentPhotoCount}/{MAX_PRODUCT_IMAGES} fotos</small>
                <button type="button" className="btn btn-ghost btn-sm" onClick={generateCombinations} disabled={uploading || draft.variations.length >= MAX_PRODUCT_VARIATIONS}>Gerar variações</button>
              </div>
              {combinationMessage && <p className={combinationMessage.kind === 'error' ? 'form-error' : 'muted small'} role={combinationMessage.kind === 'error' ? 'alert' : 'status'}>{combinationMessage.text}</p>}
            </details>
            <div className="pr-variation-list">
              {draft.variations.map((image, variationIndex) => {
                return (
                  <div className="pr-variation-row" key={image.key}>
                    <div className="pr-variation-fields">
                      <div className="field pr-variation-photo">
                        <span>Imagem da variação <small>(opcional)</small></span>
                        <div className="pr-variation-photo-control">
                          {image.url && <img src={image.url} alt={`Imagem da variação ${variationIndex + 1}`} />}
                          <label className={`btn btn-ghost btn-sm ${uploading || (!hasPhoto(image) && currentPhotoCount >= MAX_PRODUCT_IMAGES) ? 'is-disabled' : ''}`} htmlFor={`variation-image-${image.key}`}>
                            <Icon name={image.url ? 'edit' : 'plus'} size={15} /> {image.url ? 'Trocar imagem' : 'Adicionar imagem'}
                          </label>
                          <input id={`variation-image-${image.key}`} className="pr-picker-input" type="file" accept={IMAGE_ACCEPT} disabled={uploading || (!hasPhoto(image) && currentPhotoCount >= MAX_PRODUCT_IMAGES)} onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = '';
                            void onReplaceVariation(image.key, file);
                          }} />
                          {image.url && <button type="button" className="link-btn" disabled={uploading} onClick={() => onPatchVariation(image.key, { url: null, data: null, externalUrl: null, imageRemoved: Boolean(image.id) })}>Remover imagem</button>}
                        </div>
                      </div>
                      <div className="field pr-suggestion-field">
                        <label htmlFor={`variation-color-name-${image.key}`}>Cor <small>(opcional)</small></label>
                        <div className="pr-variation-color">
                          <input type="color" value={image.colorHex || variationSuggestions?.colorHexByName?.[normalizeProductColorName(image.color)] || colorHexForName(image.color) || '#cccccc'} onChange={(event) => setColorSample(image, event.target.value)} aria-label={`Escolher a cor da variação ${variationIndex + 1}`} />
                          <input id={`variation-color-name-${image.key}`} className="input" list={colorListId} value={image.color || ''} maxLength={20} onChange={(event) => setColorName(image, event.target.value)} placeholder="Ex.: Azul-marinho" />
                        </div>
                        <small>A amostra visual é opcional; você pode informar apenas o nome da cor.</small>
                        <SuggestionButtons
                          label={`Cores cadastradas para a variação ${variationIndex + 1}`}
                          options={variationSuggestions?.colorOptions || []}
                          onSelect={(color) => setColorName(image, color)}
                          swatchFor={(color) => variationSuggestions?.colorHexByName?.[normalizeProductColorName(color)] || colorHexForName(color) || '#cbd5e1'}
                          caption="Cores e variações comuns:"
                          limit={12}
                        />
                      </div>
                      <div className="field pr-suggestion-field">
                        <label htmlFor={`variation-size-${image.key}`}>Tamanho <small>(opcional)</small></label>
                        <input id={`variation-size-${image.key}`} className="input" list={sizeListId} value={image.size || ''} maxLength={20} onChange={(event) => onPatchVariation(image.key, { size: event.target.value })} placeholder="Ex.: M, 42" />
                        <SuggestionButtons label={`Tamanhos cadastrados para a variação ${variationIndex + 1}`} options={variationSuggestions?.sizes || []} onSelect={(size) => onPatchVariation(image.key, { size })} />
                      </div>
                      {draft.stockEnabled && <label className="field pr-stock-input"><span>Estoque (un.)</span><input className="input" type="number" inputMode="numeric" min="0" max="1000000" value={image.stockQuantity || '0'} onChange={(event) => onPatchVariation(image.key, { stockQuantity: event.target.value })} /></label>}
                      <label className="field"><span>Código de barras <small>(opcional)</small></span><input className="input" value={image.barcode || ''} maxLength={48} onChange={(event) => onPatchVariation(image.key, { barcode: event.target.value })} placeholder="Vazio = usa o do produto" /></label>
                    </div>
                    <div className="pr-variation-order">
                      <button type="button" className="btn btn-ghost btn-sm pr-remove-variation" onClick={() => onRemoveVariation(image.key)} aria-label={`Remover só a variação ${variationIndex + 1}`}><Icon name="trash" size={15} /> Remover variação</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <datalist id={colorListId}>{(variationSuggestions?.colorOptions || []).map((color) => <option key={color} value={color} />)}</datalist>
            <datalist id={sizeListId}>{(variationSuggestions?.sizes || []).map((size) => <option key={size} value={size} />)}</datalist>
            {draft.variations.length < MAX_PRODUCT_VARIATIONS && <button type="button" className="btn btn-ghost btn-sm" onClick={onAddBlankVariation}><Icon name="plus" size={16} /> Adicionar variação</button>}
          </section>

          <section className="pr-editor-section">
            <div className="pr-section-title"><span>3</span><div><h3>Descrição</h3><p>Inclua detalhes que ajudem o cliente a conhecer o item.</p></div></div>
            <label className="field pr-description"><span>Descrição <small>(opcional)</small></span><textarea className="input" rows="4" maxLength="2000" value={draft.description} onChange={(event) => onPatch({ description: event.target.value })} placeholder="Escreva detalhes do produto ou serviço" /></label>
          </section>
        </div>
      </div>
    </article>
  );
}