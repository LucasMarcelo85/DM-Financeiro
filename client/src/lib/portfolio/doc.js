// Documento do editor livre (código puro, sem React).
//
// { v: 2, kind: 'site' | 'catalog', theme, seo, pixel, heights, elements: [elemento], catalog? }
// Elemento: { id, t, name, locked, box: { desktop, tablet, mobile }, anim, ...campos do tipo }
//   box = { x, y, w, h, r (graus), hide, fs? }: cada dispositivo tem a sua própria posição e tamanho (desenho individual).
// A ordem do vetor é a ordem das camadas: o último elemento fica por cima.
// O servidor valida o mesmo formato em server/utils/portfolio.js (manter listas de opções e limites em sincronia).

import { DEFAULT_THEME, emptyLink, readableOn, uid } from './model.js';
import { bottomOf, clamp } from './geometry.js';

export const DEVICES = [
  { id: 'desktop', label: 'Computador', short: 'PC', w: 1200 },
  { id: 'tablet', label: 'Tablet', short: 'Tablet', w: 768 },
  { id: 'mobile', label: 'Celular', short: 'Celular', w: 375 },
];
export const DESIGN_W = { desktop: 1200, tablet: 768, mobile: 375 };
export const MAX_ELEMENTS = 200;
export const MAX_PAGE_H = 30000;

export const ELEMENT_LABELS = { text: 'Texto', image: 'Imagem', icon: 'Ícone', button: 'Botão', shape: 'Forma', spacer: 'Espaçador', video: 'Vídeo', carousel: 'Carrossel', menu: 'Menu', products: 'Produtos', catsearch: 'Busca e categorias', catgrid: 'Produtos do catálogo' };
// Elementos que podem ocupar a largura inteira da tela (barra de topo, rodapé, faixas de fundo).
export const canBeFull = (el) => el.t === 'spacer' || el.t === 'shape';
export const CATALOG_ELEMENTS = new Set(['catsearch', 'catgrid']);
// Elementos cuja altura é calculada (não dá para esticar à mão).
export const autoHeight = (el) => el.t === 'products' || el.t === 'catgrid';

// ---------------------------------------------------------------- opções (rótulo em português)
export const ENTER_OPTIONS = [['none', 'Nenhuma'], ['fade', 'Aparecer'], ['slide-up', 'Subir'], ['slide-down', 'Descer'], ['slide-left', 'Entrar pela direita'], ['slide-right', 'Entrar pela esquerda'], ['zoom-in', 'Zoom (crescer)'], ['zoom-out', 'Zoom (encolher)'], ['flip-x', 'Virar na horizontal'], ['flip-y', 'Virar na vertical'], ['bounce', 'Pular'], ['rotate', 'Girar entrando'], ['blur', 'Desfocar'], ['drop', 'Cair']];
export const LOOP_OPTIONS = [['none', 'Nenhuma'], ['float', 'Flutuar'], ['pulse', 'Pulsar'], ['shake', 'Tremer'], ['spin', 'Girar sem parar'], ['wiggle', 'Balançar'], ['glow', 'Brilhar'], ['swing', 'Pêndulo'], ['heartbeat', 'Batimento'], ['rubber', 'Elástico'], ['bounce', 'Quicar'], ['tada', 'Tada'], ['flash', 'Piscar'], ['hue', 'Ciclo de cores']];
export const HOVER_OPTIONS = [['none', 'Nenhum'], ['grow', 'Crescer'], ['shrink', 'Encolher'], ['lift', 'Levantar'], ['glow', 'Brilhar'], ['rotate', 'Girar'], ['tilt', 'Inclinar'], ['shake', 'Tremer'], ['brighten', 'Clarear'], ['pulse', 'Pulsar']];
export const BTN_STYLES = [['solid', 'Sólido'], ['outline', 'Contorno'], ['soft', 'Suave'], ['gradient', 'Degradê'], ['flow', 'Degradê animado'], ['glass', 'Vidro'], ['neon', 'Neon'], ['threed', '3D'], ['lift', 'Sombra flutuante'], ['underline', 'Sublinhado'], ['retro', 'Retrô'], ['shine', 'Brilho passando'], ['ghost', 'Fantasma'], ['dashed', 'Tracejado']];
export const FILL_ANIM_OPTIONS = [['none', 'Parada'], ['flow', 'Degradê em movimento'], ['hue', 'Ciclo de cores'], ['shimmer', 'Brilho passando']];
export const SHADOW_OPTIONS = [['none', 'Sem sombra'], ['soft', 'Suave'], ['medium', 'Média'], ['strong', 'Forte'], ['glow', 'Brilho'], ['hard', 'Recortada']];
export const TEXT_SHADOW_OPTIONS = [['none', 'Sem sombra'], ['soft', 'Suave'], ['hard', 'Recortada'], ['neon', 'Neon']];
export const WEIGHT_OPTIONS = [[400, 'Normal'], [700, 'Negrito']]; // as fontes carregadas têm os pesos 400 e 700
export const CARD_STYLES = [['soft', 'Suave'], ['flat', 'Reto'], ['outline', 'Contorno']];
export const CATALOG_DISPLAY = [['category', 'Em ordem de categorias'], ['mixed', 'Misturados'], ['only', 'Somente uma categoria'], ['selected', 'Produtos escolhidos']];

export const THEME_DEFAULTS = { ...DEFAULT_THEME, bgType: 'solid', bgColor2: '#e9eef5', bgAngle: 135, bgAnimate: 'none' };
export const CARD_DEFAULTS = () => ({
  layout: 'vertical', ratio: 'square', fit: 'cover', align: 'left', radius: 14, bg: '', text: '', accent: '',
  imgHeight: 180, imgX: 50, imgY: 50, imgPad: 0, imgBg: '', font: '', nameLines: 2, gap: 14, icon: '', iconPos: 'button', iconColor: '',
  showImage: true, showCategory: true, showName: true, showDescription: false, showPrice: true, showTiers: false, showVariations: true, showButton: true,
  shadow: 'soft', border: false, padding: 'normal', textSize: 'md', priceSize: 'md', buttonStyle: 'solid', buttonFull: true, priceFrom: true,
});
export const CATALOG_DEFAULTS = () => ({
  card: CARD_DEFAULTS(),
  display: 'category', onlyCategory: '', selectedProductIds: [], columns: { desktop: 4, tablet: 3, mobile: 2 }, showSearch: true, showCategories: true, cardStyle: 'soft',
  orderMode: 'cart', addLabel: 'Adicionar', cartTitle: 'Seu carrinho', checkoutNote: '', cartLayout: 'standard', cartLink: 'carrinho',
  cartButtonLabel: '', cartButtonUrl: '', elementized: false,
});

// ---------------------------------------------------------------- padrões de cada tipo
const ANIM0 = () => ({ enter: 'none', loop: 'none', hover: 'none', delay: 0, duration: 700 });
export const FILL0 = (o = {}) => ({ type: 'solid', c1: '#f2a33a', c2: '#d6336c', angle: 135, animate: 'none', ...o });
const FILTERS0 = () => ({ brightness: 100, contrast: 100, saturate: 100, grayscale: 0, blur: 0, hue: 0, sepia: 0 });

const TYPE_DEFAULTS = {
  text: (th) => ({ text: 'Clique duas vezes para editar este texto', font: th.bodyFont, weight: 400, italic: false, underline: false, upper: false, align: 'left', valign: 'top', color: th.text, lineHeight: 1.3, spacing: 0, fill: FILL0(), useFill: false, shadow: 'none', shadowColor: '#000000', link: emptyLink() }),
  image: () => ({ src: '', alt: '', fit: 'cover', zoom: 1, px: 50, py: 50, flipX: false, flipY: false, radius: 0, mask: 'none', borderW: 0, borderColor: '#ffffff', shadow: 'none', opacity: 100, filters: FILTERS0(), link: emptyLink() }),
  icon: (th) => ({ name: 'star', color: th.text, bg: 'none', bgColor: th.primary, borderW: 0, borderColor: th.text, shadow: 'none', fixed: false, fixedAnchor: 'bottom-right', scrollAction: 'none', link: emptyLink() }),
  button: (th) => ({ label: 'Fale conosco', style: 'solid', color: th.primary, color2: '#d6336c', textColor: readableOn(th.primary), font: th.bodyFont, weight: 700, radius: 12, icon: '', iconPos: 'left', link: { ...emptyLink(), kind: 'whatsapp' } }),
  shape: (th) => ({ shape: 'rect', fill: FILL0({ c1: th.primary }), borderW: 0, borderColor: '#14202e', borderStyle: 'solid', shadow: 'none', radius: 0, opacity: 100, full: false, fixed: false, fixedAnchor: 'bottom-right', scrollAction: 'none', link: emptyLink() }),
  spacer: (th) => ({ fill: FILL0({ c1: th.primary }), full: true, opacity: 0, borderW: 0, borderColor: '#14202e', shadow: 'none' }),
  video: () => ({ url: '', radius: 12 }),
  carousel: () => ({ slides: [], autoplay: true, interval: 5, arrows: true, dots: true, fit: 'cover', radius: 12 }),
  menu: (th) => ({ items: [{ id: 'm1', label: 'Início', link: emptyLink() }, { id: 'm2', label: 'Contato', link: emptyLink() }], variant: 'auto', title: '', color: th.text, bg: '#ffffff', radius: 12 }),
  products: () => ({ ids: [], cols: { desktop: 4, tablet: 3, mobile: 2 }, whatsapp: '', buttonLabel: 'Pedir no WhatsApp', showPrice: true, cardStyle: 'soft' }),
  catsearch: () => ({ showSearch: true, showCategories: true, placeholder: 'Buscar produtos' }),
  catgrid: () => ({ cols: { desktop: 4, tablet: 3, mobile: 2 } }),
};
const SIZES = { text: [360, 80], image: [320, 240], icon: [56, 56], button: [230, 56], shape: [220, 220], spacer: [1200, 120], video: [480, 270], carousel: [640, 360], menu: [360, 56], products: [720, 300], catsearch: [1080, 104], catgrid: [1080, 400] };
const FONT_SIZES = { text: [24, 20, 17], button: [18, 17, 16] };

export const emptyBox = (t) => ({ x: t === 'spacer' ? 0 : 60, y: 60, w: SIZES[t][0], h: SIZES[t][1], r: 0, hide: false, ...(FONT_SIZES[t] ? { fs: FONT_SIZES[t][0] } : {}) });
const hasFont = (t) => t === 'text' || t === 'button';

// Escala uma caixa de um dispositivo para outro (proporcional). Fonte diminui menos que a largura, para continuar legível.
export function scaleBox(box, from, to, t) {
  const k = DESIGN_W[to] / DESIGN_W[from];
  const out = { ...box, x: Math.round(box.x * k), y: Math.round(box.y * k), w: Math.max(8, Math.round(box.w * k)), h: Math.max(8, Math.round(box.h * k)) };
  if (hasFont(t) && box.fs) out.fs = Math.max(11, Math.round(box.fs * (0.5 + 0.5 * k)));
  return out;
}

export function newElement(t, theme = THEME_DEFAULTS, over = {}) {
  if (!TYPE_DEFAULTS[t]) throw new Error(`Tipo de elemento desconhecido: ${t}`);
  const { box: boxOver, ...props } = over;
  const desktop = { ...emptyBox(t), ...(boxOver?.desktop || boxOver || {}) };
  const el = {
    id: uid(), t, name: '', locked: false, ...TYPE_DEFAULTS[t]({ ...THEME_DEFAULTS, ...theme }), ...props, anim: { ...ANIM0(), ...(props.anim || {}) },
    box: { desktop, tablet: scaleBox(desktop, 'desktop', 'tablet', t), mobile: scaleBox(desktop, 'desktop', 'mobile', t) },
  };
  if (boxOver?.tablet) el.box.tablet = { ...el.box.tablet, ...boxOver.tablet };
  if (boxOver?.mobile) el.box.mobile = { ...el.box.mobile, ...boxOver.mobile };
  if (hasFont(t) && FONT_SIZES[t]) { el.box.tablet.fs = el.box.tablet.fs ?? FONT_SIZES[t][1]; el.box.mobile.fs = el.box.mobile.fs ?? FONT_SIZES[t][2]; }
  if (CATALOG_ELEMENTS.has(t)) fullWidthBoxes(el, boxOver);
  return el;
}

// Busca e produtos do catálogo ocupam a largura da tela em cada dispositivo (margens de 24px no tablet e 16px no celular).
function fullWidthBoxes(el, boxOver) {
  for (const d of ['tablet', 'mobile']) {
    if (boxOver?.[d]) continue;
    const m = d === 'mobile' ? 16 : 24;
    el.box[d] = { ...el.box[d], x: m, w: DESIGN_W[d] - m * 2, h: el.t === 'catsearch' ? (d === 'mobile' ? 96 : 100) : el.box[d].h };
  }
}

export const blankDoc = (kind = 'site') => ({
  v: 2, kind, theme: { ...THEME_DEFAULTS }, seo: { title: '', description: '' }, pixel: { meta: '', google: '', tiktok: '' },
  heights: { desktop: 700, tablet: 700, mobile: 700 }, manual: { tablet: false, mobile: false }, elements: [], ...(kind === 'catalog' ? { catalog: CATALOG_DEFAULTS() } : {}),
});

// ---------------------------------------------------------------- completar o que veio do banco
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function fixElement(raw, theme) {
  if (!isObj(raw) || !TYPE_DEFAULTS[raw.t]) return null;
  const d = TYPE_DEFAULTS[raw.t](theme);
  const el = { ...d, ...raw, id: typeof raw.id === 'string' && raw.id ? raw.id : uid(), name: raw.name || '', locked: Boolean(raw.locked) };
  for (const k of ['fill', 'filters', 'cols', 'link']) if (d[k]) el[k] = { ...d[k], ...(isObj(raw[k]) ? raw[k] : {}) };
  el.anim = { ...ANIM0(), ...(isObj(raw.anim) ? raw.anim : {}) };
  const base = { ...emptyBox(raw.t), ...(isObj(raw.box?.desktop) ? raw.box.desktop : {}) };
  el.box = { desktop: base, tablet: { ...scaleBox(base, 'desktop', 'tablet', raw.t), ...(isObj(raw.box?.tablet) ? raw.box.tablet : {}) }, mobile: { ...scaleBox(base, 'desktop', 'mobile', raw.t), ...(isObj(raw.box?.mobile) ? raw.box.mobile : {}) } };
  return el;
}

export function normalizeDoc(raw, kindHint = 'site') {
  return syncDevices(withCatalogElements(normalizeBase(raw, kindHint)));
}

// Telas que o usuário ainda não ajustou à mão (tablet e celular) acompanham o computador, na mesma proporção.
export function syncDevices(doc) {
  if (doc.kind === 'catalog') return doc;
  let out = doc;
  for (const dv of ['tablet', 'mobile']) if (!out.manual?.[dv]) out = adaptDevice(out, 'desktop', dv);
  return out;
}

export const markManual = (doc, device) => (device === 'desktop' || doc.manual?.[device] ? doc : { ...doc, manual: { ...doc.manual, [device]: true } });

// Páginas de catálogo antigas mostravam busca e produtos automaticamente no fim da página.
// Agora são elementos: na primeira abertura eles são colocados no fim (o usuário pode mover ou apagar) e a página é marcada como convertida.
function withCatalogElements(doc) {
  if (doc.kind !== 'catalog' || doc.catalog.elementized) return doc;
  const search = newElement('catsearch', doc.theme);
  const grid = newElement('catgrid', doc.theme);
  for (const d of Object.keys(DESIGN_W)) {
    const y = bottomOf(doc.elements.map((e) => boxOf(e, d))) + 24;
    search.box[d].y = y;
    grid.box[d].y = y + search.box[d].h + 8;
  }
  return { ...doc, catalog: { ...doc.catalog, elementized: true }, elements: [...doc.elements, search, grid].slice(0, MAX_ELEMENTS) };
}

function normalizeBase(raw, kindHint = 'site') {
  const src = isObj(raw) ? raw : {};
  if (src.v !== 2) return Array.isArray(src.blocks) ? convertV1(src, kindHint) : blankDoc(kindHint);
  const kind = src.kind === 'catalog' || kindHint === 'catalog' ? 'catalog' : 'site';
  const theme = { ...THEME_DEFAULTS, ...(isObj(src.theme) ? src.theme : {}) };
  return {
    v: 2, kind, theme,
    seo: { title: '', description: '', ...(isObj(src.seo) ? src.seo : {}) },
    pixel: { meta: '', google: '', tiktok: '', ...(isObj(src.pixel) ? src.pixel : {}) },
    heights: { desktop: 700, tablet: 700, mobile: 700, ...(isObj(src.heights) ? src.heights : {}) },
    // Páginas salvas antes deste recurso não trazem o campo: mantêm o que já foi desenhado.
    manual: isObj(src.manual) ? { tablet: Boolean(src.manual.tablet), mobile: Boolean(src.manual.mobile) } : { tablet: true, mobile: true },
    elements: (Array.isArray(src.elements) ? src.elements : []).slice(0, MAX_ELEMENTS).map((e) => fixElement(e, theme)).filter(Boolean),
    ...(kind === 'catalog' ? { catalog: { ...CATALOG_DEFAULTS(), ...(isObj(src.catalog) ? src.catalog : {}), selectedProductIds: [...new Set((Array.isArray(src.catalog?.selectedProductIds) ? src.catalog.selectedProductIds : []).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 1000), card: { ...CARD_DEFAULTS(), ...(isObj(src.catalog?.card) ? src.catalog.card : {}) }, columns: { ...CATALOG_DEFAULTS().columns, ...(isObj(src.catalog?.columns) ? src.catalog.columns : {}) } } } : {}),
  };
}

// ---------------------------------------------------------------- medidas
const PRODUCT_GAP = 16;
// Altura dos cartões de produtos (grade): vale para qualquer largura, então o editor e a página pública concordam.
export function productsHeight(el, device, count = el.ids.length) {
  const cols = clamp(el.cols[device] || 3, 1, 6);
  const w = el.box[device].w;
  const cardW = (w - PRODUCT_GAP * (cols - 1)) / cols;
  const cardH = cardW + 118;
  const rows = Math.max(1, Math.ceil(Math.max(1, count) / cols));
  return Math.round(rows * cardH + (rows - 1) * PRODUCT_GAP);
}
// Produtos e configuração do catálogo da página que está sendo mostrada: a altura da grade depende deles.
// O editor e a página pública chamam setCatalogContext a cada renderização, antes de medir os elementos.
let CAT = { products: [], catalog: null };
export const setCatalogContext = (products, catalog) => { CAT = { products: products || [], catalog: catalog || null }; };

const CARD_RATIO = { square: 1, portrait: 4 / 3, landscape: 3 / 4, wide: 9 / 16, tall: 3 / 2 };
const CARD_PAD = { compact: 14, normal: 22, roomy: 34 };
const CARD_TEXT = { sm: 14, md: 16, lg: 20 };
const CARD_PRICE = { sm: 16, md: 20, lg: 26 };

// Medidas da grade de produtos do catálogo: as linhas têm altura fixa, então a página não "pula" ao filtrar.
export function catgridMetrics(el, device, products = CAT.products, cfg = CAT.catalog) {
  const k = { ...CARD_DEFAULTS(), ...(cfg?.card || {}) };
  const gap = clamp(k.gap || 14, 6, 40); const titleH = 44; const groupGap = 28;
  const cols = clamp(el.cols?.[device] || 2, 1, 6);
  const w = el.box[device].w;
  const cardW = (w - gap * (cols - 1)) / cols;
  const hasVars = products.some((p) => (p.images || []).length > 1);
  const tierLines = clamp(Math.max(0, ...products.map((p) => (p.priceOptions || []).filter((o) => o.priceCents !== null).length)), 1, 4);
  const parts = [
    k.showCategory && 16, k.showName && Math.ceil(CARD_TEXT[k.textSize] * 1.25 * (k.nameLines || 2)), k.showDescription && 42,
    k.showPrice && Math.ceil((CARD_PRICE[k.priceSize] || 20) * 1.3), k.showTiers && tierLines * 15, k.showVariations && hasVars && 22, k.showButton && 44,
  ].filter(Boolean);
  const body = (CARD_PAD[k.padding] || 22) + parts.reduce((s, n) => s + n, 0) + Math.max(0, parts.length - 1) * 4;
  const ratio = CARD_RATIO[k.ratio] || 1;
  const imgH = k.ratio === 'custom' ? k.imgHeight || 180 : cardW * ratio;
  const cardH = Math.ceil(k.layout === 'horizontal'
    ? Math.max(k.showImage ? (k.ratio === 'custom' ? imgH : Math.max(112, cardW * 0.42 * ratio)) : 0, body)
    : (k.showImage ? imgH : 0) + body);
  const only = cfg?.display === 'only' && cfg.onlyCategory ? cfg.onlyCategory : '';
  const selected = cfg?.display === 'selected' ? new Set(cfg.selectedProductIds || []) : null;
  const list = products.filter((p) => (!only || p.category === only) && (!selected || selected.has(p.id)));
  const counts = cfg?.display === 'category'
    ? Object.values(list.reduce((m, p) => ({ ...m, [p.category]: (m[p.category] || 0) + 1 }), {}))
    : [list.length];
  const groups = counts.length ? counts : [0];
  const height = list.length
    ? groups.reduce((sum, n) => { const rows = Math.ceil(n / cols); return sum + (cfg?.display === 'category' ? titleH : 0) + rows * cardH + (rows - 1) * gap; }, 0) + (groups.length - 1) * groupGap
    : 160;
  return { cols, gap, titleH, groupGap, cardH, height: Math.max(80, Math.round(height)) };
}

export const boxOf = (el, device, products = CAT.products, catalog = CAT.catalog) => (el.t === 'products'
  ? { ...el.box[device], h: productsHeight(el, device) }
  : el.t === 'catgrid'
    ? { ...el.box[device], h: Math.max(el.box[device].h, catgridMetrics(el, device, products, catalog).height) }
    : el.box[device]);

export function layoutBoxes(doc, device, products = CAT.products, catalog = doc.catalog || CAT.catalog) {
  const base = new Map(doc.elements.map((el) => [el.id, boxOf(el, device, products, catalog)]));
  const expansions = [];
  const grids = doc.elements
    .filter((el) => el.t === 'catgrid' && !el.box[device].hide)
    .sort((a, b) => a.box[device].y - b.box[device].y);

  for (const el of grids) {
    const original = el.box[device];
    const shift = expansions.reduce((sum, item) => sum + (original.y >= item.bottom ? item.delta : 0), 0);
    const naturalHeight = Math.max(original.h, catgridMetrics(el, device, products, catalog).height);
    const delta = naturalHeight - original.h;
    base.set(el.id, { ...base.get(el.id), y: original.y + shift, h: naturalHeight });
    if (delta > 0) expansions.push({ bottom: original.y + original.h, delta });
  }

  for (const el of doc.elements) {
    if (el.t === 'catgrid' || el.box[device].hide) continue;
    const original = el.box[device];
    const shift = expansions.reduce((sum, item) => sum + (original.y >= item.bottom ? item.delta : 0), 0);
    if (shift) base.set(el.id, { ...base.get(el.id), y: original.y + shift });
  }
  return base;
}

export const pageHeight = (doc, device, products = CAT.products, catalog = doc.catalog || CAT.catalog) => Math.max(doc.heights[device] || 700, bottomOf([...layoutBoxes(doc, device, products, catalog).values()]) + 24);

// Estimativa da altura de um texto (usada ao empilhar para o celular).
export function estimateTextHeight(text, fs, width, lineHeight = 1.3) {
  const perLine = Math.max(1, Math.floor(width / (fs * 0.52)));
  const lines = String(text || ' ').split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
  return Math.ceil(lines * fs * lineHeight + 6);
}

// ---------------------------------------------------------------- operações (imutáveis)
export const findElement = (doc, id) => doc.elements.find((e) => e.id === id) || null;
export const patchElement = (doc, id, patch) => ({ ...doc, elements: doc.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
export const patchBox = (doc, id, device, patch) => ({ ...doc, elements: doc.elements.map((e) => (e.id === id ? { ...e, box: { ...e.box, [device]: { ...e.box[device], ...patch } } } : e)) });
export const patchTheme = (doc, patch) => ({ ...doc, theme: { ...doc.theme, ...patch } });
export const patchSeo = (doc, patch) => ({ ...doc, seo: { ...doc.seo, ...patch } });
export const patchPixel = (doc, patch) => ({ ...doc, pixel: { ...doc.pixel, ...patch } });
export const patchCatalog = (doc, patch) => ({ ...doc, catalog: { ...doc.catalog, ...patch } });
export const addElement = (doc, el) => ({ ...doc, elements: [...doc.elements, el] });
export const removeElement = (doc, id) => ({ ...doc, elements: doc.elements.filter((e) => e.id !== id) });

export function duplicateElement(doc, id) {
  const i = doc.elements.findIndex((e) => e.id === id);
  if (i < 0) return { doc, element: null };
  const copy = JSON.parse(JSON.stringify(doc.elements[i]));
  copy.id = uid();
  copy.name = copy.name ? `${copy.name} (cópia)` : '';
  copy.locked = false;
  for (const d of Object.keys(copy.box)) { copy.box[d].x += 24; copy.box[d].y += 24; }
  const elements = [...doc.elements];
  elements.splice(i + 1, 0, copy);
  return { doc: { ...doc, elements }, element: copy };
}

// Camadas: 'front' (por cima de tudo), 'back' (por baixo), 'up' / 'down' (um passo).
export function moveLayer(doc, id, where) {
  const i = doc.elements.findIndex((e) => e.id === id);
  if (i < 0) return doc;
  const to = where === 'front' ? doc.elements.length - 1 : where === 'back' ? 0 : where === 'up' ? i + 1 : i - 1;
  if (to < 0 || to >= doc.elements.length || to === i) return doc;
  const elements = [...doc.elements];
  const [e] = elements.splice(i, 1);
  elements.splice(to, 0, e);
  return { ...doc, elements };
}

// Alinha o elemento à página, no dispositivo atual.
export function alignElement(doc, id, device, how) {
  const el = findElement(doc, id);
  if (!el) return doc;
  const b = boxOf(el, device);
  const W = DESIGN_W[device];
  const H = pageHeight(doc, device);
  const patch = {
    left: { x: 0 }, hcenter: { x: Math.round((W - b.w) / 2) }, right: { x: W - b.w },
    top: { y: 0 }, vcenter: { y: Math.round((H - b.h) / 2) }, bottom: { y: Math.max(0, H - b.h) },
  }[how];
  return patch ? patchBox(doc, id, device, patch) : doc;
}

// Copia o desenho de outro dispositivo, ajustando proporcionalmente (ponto de partida para tablet e celular).
export function adaptDevice(doc, from, to) {
  return {
    ...doc,
    heights: { ...doc.heights, [to]: Math.round(pageHeight(doc, from) * (DESIGN_W[to] / DESIGN_W[from])) },
    elements: doc.elements.map((e) => ({ ...e, box: { ...e.box, [to]: scaleBox(boxOf(e, from), from, to, e.t) } })),
  };
}

// "Organizar em coluna": empilha os elementos de cima para baixo na largura do dispositivo (bom para o celular).
export function stackDevice(doc, device, from = 'desktop') {
  const W = DESIGN_W[device];
  const m = Math.round(W * 0.055);
  const full = W - m * 2;
  const order = [...doc.elements].filter((e) => !e.box[from].hide).sort((a, b) => a.box[from].y - b.box[from].y || a.box[from].x - b.box[from].x);
  const k = W / DESIGN_W[from];
  let y = m;
  const boxes = new Map();
  for (const e of order) {
    const b = boxOf(e, from);
    let w = full;
    let h;
    const small = e.t === 'icon' || (b.w <= 140 && b.h <= 140);
    if (small) { w = Math.min(full, Math.max(32, Math.round(b.w * Math.max(k, 0.6)))); h = Math.round(w * (b.h / b.w)); }
    else if (e.t === 'image' || e.t === 'video') h = Math.round(w * (b.h / b.w));
    else if (e.t === 'text') {
      const fs = clamp(Math.round(b.fs * (0.55 + 0.45 * k)), 13, b.fs);
      h = estimateTextHeight(e.text, fs, w, e.lineHeight);
      boxes.set(e.id, { ...b, x: m, y, w, h, fs, r: 0, hide: false });
      y += h + 14;
      continue;
    } else if (e.t === 'button') { h = clamp(Math.round(b.h * (0.8 + 0.2 * k)), 44, 64); boxes.set(e.id, { ...b, x: m, y, w, h, fs: clamp(Math.round(b.fs * (0.6 + 0.4 * k)), 14, b.fs), r: 0, hide: false }); y += h + 14; continue; }
    else if (e.t === 'catgrid') h = catgridMetrics({ ...e, box: { ...e.box, [device]: { ...e.box[device], w } } }, device).height;
    else h = Math.max(40, Math.round(b.h * k * 1.2));
    boxes.set(e.id, { ...b, x: small ? Math.round((W - w) / 2) : m, y, w, h: autoHeight(e) ? b.h : h, r: small ? b.r : 0, hide: false });
    y += h + 14;
  }
  return {
    ...doc,
    heights: { ...doc.heights, [device]: y + m },
    elements: doc.elements.map((e) => (boxes.has(e.id) ? { ...e, box: { ...e.box, [device]: boxes.get(e.id) } } : e)),
  };
}

// ---------------------------------------------------------------- conversão do formato antigo (blocos empilhados)
const V1_SIZE = { sm: 22, md: 28, lg: 38, xl: 50 };
const V1_TEXT = { sm: 15, md: 17, lg: 20 };
const V1_BANNER_H = { sm: 240, md: 340, lg: 460 };
const V1_WIDTH = { narrow: 640, normal: 860, wide: 1080 };

export function convertV1(raw, kind = 'site') {
  const theme = { ...THEME_DEFAULTS, ...(isObj(raw.theme) ? raw.theme : {}) };
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).filter((b) => isObj(b) && b.t).slice(0, 80);
  const doc = { ...blankDoc(kind), theme, seo: { title: '', description: '', ...(isObj(raw.seo) ? raw.seo : {}) } };
  const link = (l) => ({ ...emptyLink(), ...(isObj(l) ? l : {}) });

  for (const device of ['desktop', 'tablet', 'mobile']) {
    const W = DESIGN_W[device];
    const cw = Math.min(V1_WIDTH[theme.width] || 860, W - (device === 'mobile' ? 40 : 80));
    const x0 = Math.round((W - cw) / 2);
    const k = device === 'desktop' ? 1 : device === 'tablet' ? 0.85 : 0.7;
    let y = device === 'mobile' ? 20 : 40;
    const put = (el, box) => {
      let target = doc.elements.find((e) => e.id === el.id);
      if (!target) { target = el; doc.elements.push(el); }
      target.box[device] = { ...target.box[device], hide: false, r: 0, ...box };
    };
    const mk = (id, t, props) => doc.elements.find((e) => e.id === id) || newElement(t, theme, { ...props, id });
    blocks.forEach((b, bi) => {
      const id = (n) => `v1${bi}${n}`;
      const align = ['left', 'center', 'right'].includes(b.align) ? b.align : 'left';
      if (b.t === 'banner') {
        const h = Math.round((V1_BANNER_H[b.height] || 340) * (device === 'mobile' ? 0.8 : 1));
        const bg = mk(id('bg'), b.image ? 'image' : 'shape', b.image ? { src: b.image, fit: 'cover' } : { fill: FILL0({ c1: b.bgColor || theme.primary }) });
        put(bg, { x: 0, y, w: W, h });
        if (b.image && b.overlay > 0) {
          const ov = mk(id('ov'), 'shape', { fill: FILL0({ c1: b.overlayColor || '#000000' }), opacity: Math.round(clamp(b.overlay, 0, 1) * 100) });
          put(ov, { x: 0, y, w: W, h });
        }
        const tw = W - 80 * (device === 'mobile' ? 0.3 : 1) * 2;
        const title = mk(id('ti'), 'text', { text: b.title || '', font: theme.headingFont, weight: 700, color: b.textColor || '#ffffff', align, valign: 'bottom' });
        put(title, { x: Math.round((W - tw) / 2), y: y + Math.round(h * 0.18), w: tw, h: Math.round(h * 0.3), fs: Math.round(46 * k) });
        const sub = mk(id('su'), 'text', { text: b.subtitle || '', color: b.textColor || '#ffffff', align });
        put(sub, { x: Math.round((W - tw) / 2), y: y + Math.round(h * 0.5), w: tw, h: Math.round(h * 0.2), fs: Math.round(20 * k) });
        if (b.showButton !== false) {
          const bw = Math.round(240 * Math.max(k, 0.85));
          const btn = mk(id('bt'), 'button', { label: b.buttonLabel || 'Fale conosco', link: link(b.link) });
          put(btn, { x: Math.round(align === 'center' ? (W - bw) / 2 : align === 'right' ? (W + tw) / 2 - bw : (W - tw) / 2), y: y + Math.round(h * 0.74), w: bw, h: 52, fs: 17 });
        }
        y += h + 24;
      } else if (b.t === 'logo') {
        const s = Math.round(clamp(b.size || 72, 24, 400) * (device === 'mobile' ? 0.8 : 1));
        put(mk(id('lg'), 'image', { src: b.src || '', fit: 'contain' }), { x: align === 'center' ? Math.round((W - s) / 2) : align === 'right' ? x0 + cw - s : x0, y, w: s, h: s });
        y += s + 20;
      } else if (b.t === 'heading' || b.t === 'text') {
        const isH = b.t === 'heading';
        const fs = Math.round((isH ? V1_SIZE[b.size] || 32 : V1_TEXT[b.size] || 17) * k);
        const h = estimateTextHeight(b.text, fs, cw, isH ? 1.2 : 1.45);
        put(mk(id('tx'), 'text', { text: b.text || '', font: isH ? theme.headingFont : theme.bodyFont, weight: isH ? 700 : 400, color: b.color || theme.text, align, lineHeight: isH ? 1.2 : 1.45 }), { x: x0, y, w: cw, h, fs });
        y += h + (isH ? 14 : 18);
      } else if (b.t === 'image') {
        const w = Math.min(cw, { sm: 320, md: 520, lg: 760, full: cw }[b.width] || 520);
        const h = Math.round(w * 0.66);
        put(mk(id('im'), 'image', { src: b.src || '', alt: b.alt || '', radius: b.radius === 'square' ? 0 : b.radius === 'pill' ? 40 : 12 }), { x: align === 'center' ? Math.round((W - w) / 2) : align === 'right' ? x0 + cw - w : x0, y, w, h });
        y += h + 18;
      } else if (b.t === 'gallery') {
        const cols = device === 'mobile' ? Math.min(2, b.cols || 3) : clamp(b.cols || 3, 1, 6);
        const gap = 12;
        const w = Math.floor((cw - gap * (cols - 1)) / cols);
        (Array.isArray(b.items) ? b.items : []).forEach((it, n) => {
          put(mk(id(`g${n}`), 'image', { src: it.src || '', alt: it.alt || '', radius: b.radius === 'square' ? 0 : 12 }), { x: x0 + (n % cols) * (w + gap), y: y + Math.floor(n / cols) * (w + gap), w, h: w });
        });
        y += Math.ceil(((b.items || []).length || 1) / cols) * (w + gap) + 6;
      } else if (b.t === 'video') {
        const w = Math.min(cw, { md: 520, lg: 760 }[b.width] || 760);
        put(mk(id('vd'), 'video', { url: b.url || '' }), { x: Math.round((W - w) / 2), y, w, h: Math.round(w * 0.5625) });
        y += Math.round(w * 0.5625) + 18;
      } else if (b.t === 'button') {
        const h = { sm: 44, md: 52, lg: 60 }[b.size] || 52;
        const w = b.full ? cw : Math.round(Math.min(cw, 260 * Math.max(k, 0.85)));
        put(mk(id('bn'), 'button', { label: b.label || '', link: link(b.link), style: ['solid', 'outline', 'soft'].includes(b.style) ? b.style : 'solid', color: b.color || theme.primary, textColor: readableOn(b.color || theme.primary) }), { x: align === 'center' ? Math.round((W - w) / 2) : align === 'right' ? x0 + cw - w : x0, y, w, h, fs: 17 });
        y += h + 14;
      } else if (b.t === 'divider') {
        put(mk(id('dv'), 'shape', { fill: FILL0({ c1: b.color || '#cfd8e3' }) }), { x: x0, y: y + 8, w: cw, h: 2 });
        y += 28;
      } else if (b.t === 'spacer') {
        y += clamp(b.height || 32, 4, 400);
      }
    });
  }
  doc.manual = { tablet: true, mobile: true };
  return doc;
}
