const CONFIG_KEY = 'dm:label:config';
const LOGO_KEY = 'dm:label:logo';

export const PRESETS = {
  1: { cols: 1, width: 50, height: 30, gap: 0 },
  2: { cols: 2, width: 40, height: 25, gap: 2 },
  3: { cols: 3, width: 33, height: 22, gap: 2 },
};

export const ELEMENT_LABELS = {
  logo: 'Logo', name: 'Nome do produto', barcode: 'Código de barras', code: 'Número do código', price: 'Preço',
};

// Posições base pensadas para 50x30 mm, escaladas para o tamanho escolhido.
export function layoutFor(width, height, previous = {}) {
  const sx = width / 50;
  const sy = height / 30;
  const fs = Math.min(sx, sy);
  const r = (n) => Math.round(n * 10) / 10;
  const visible = (key, fallback) => previous[key]?.visible ?? fallback;
  return {
    logo: { visible: visible('logo', false), x: r(38 * sx), y: r(1 * sy), w: r(11 * sx), h: r(6 * sy) },
    name: { visible: visible('name', true), x: r(1 * sx), y: r(1 * sy), w: r(36 * sx), size: r(7 * fs) },
    barcode: { visible: visible('barcode', true), x: r(3 * sx), y: r(8.5 * sy), w: r(44 * sx), h: r(12 * sy) },
    code: { visible: visible('code', true), x: r(3 * sx), y: r(21 * sy), w: r(44 * sx), size: r(6 * fs) },
    price: { visible: visible('price', true), x: r(1 * sx), y: r(25 * sy), w: r(48 * sx), size: r(9 * fs) },
  };
}

export function defaultConfig() {
  const preset = PRESETS[1];
  return { ...preset, paper: 'roll', marginX: 5, marginY: 5, offsetX: 0, offsetY: 0, elements: layoutFor(preset.width, preset.height) };
}

export function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (saved && saved.elements) {
      const base = defaultConfig();
      return { ...base, ...saved, elements: Object.fromEntries(Object.keys(base.elements).map((key) => [key, { ...base.elements[key], ...saved.elements[key] }])) };
    }
  } catch { /* usa o padrão */ }
  return defaultConfig();
}

export const saveConfig = (config) => { try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* ignora */ } };
export const loadLogo = () => { try { return localStorage.getItem(LOGO_KEY) || ''; } catch { return ''; } };
export const saveLogo = (dataUrl) => {
  try { if (dataUrl) localStorage.setItem(LOGO_KEY, dataUrl); else localStorage.removeItem(LOGO_KEY); } catch { /* ignora */ }
};

export const variantName = (image) => [image.color, image.size, image.variationValue].filter(Boolean).join(' / ') || image.label || '';

// Uma entrada por código: o do produto e os de variações com código próprio.
export function buildEntries(products, generated = {}) {
  const entries = [];
  const missing = [];
  for (const product of products) {
    const code = product.barcode || generated[product.id] || '';
    const price = product.priceCents || 0;
    const variants = (product.images || []).filter((image) => image.barcode);
    if (code) entries.push({ key: `p${product.id}`, productId: product.id, name: product.name, code, priceCents: price });
    for (const image of variants) {
      entries.push({
        key: `i${image.id}`, productId: product.id, name: `${product.name} ${variantName(image)}`.trim(), code: image.barcode,
        priceCents: image.priceCents ?? price,
      });
    }
    if (!code && !variants.length && product.kind !== 'servico') missing.push(product);
  }
  return { entries, missing };
}
