// Modelo do documento do editor de contratos (código puro, sem React).
//
// Documento: { v: 1, orientation: 'portrait' | 'landscape', pages: [{ id, bg, els: [elemento] }] }
// Elemento: { id, t, x, y, w, h?, ...estilo }  (a altura de textos é automática: não se guarda `h`)
// Tipos: title, subtitle, text, date, capsule (cápsula), image, line, shape (retângulo)
//
// Medidas em pixels CSS (96 dpi). A4 = 794 x 1123.
// O servidor valida o mesmo formato em server/utils/contract.js (manter as fontes em sincronia).

export const PAGE_SIZES = { portrait: { w: 794, h: 1123 }, landscape: { w: 1123, h: 794 } };
export const pageSize = (orientation) => PAGE_SIZES[orientation] || PAGE_SIZES.portrait;
export const MARGIN = 64;
export const MAX_PAGES = 40;
export const MAX_ELEMENTS = 300;

export const FONTS = [
  { key: 'inter', label: 'Inter', group: 'Sem serifa', css: "'Inter', system-ui, sans-serif" },
  { key: 'montserrat', label: 'Montserrat', group: 'Sem serifa', css: "'Montserrat', system-ui, sans-serif" },
  { key: 'poppins', label: 'Poppins', group: 'Sem serifa', css: "'Poppins', system-ui, sans-serif" },
  { key: 'roboto', label: 'Roboto', group: 'Sem serifa', css: "'Roboto', system-ui, sans-serif" },
  { key: 'opensans', label: 'Open Sans', group: 'Sem serifa', css: "'Open Sans', system-ui, sans-serif" },
  { key: 'lato', label: 'Lato', group: 'Sem serifa', css: "'Lato', system-ui, sans-serif" },
  { key: 'oswald', label: 'Oswald (estreita)', group: 'Sem serifa', css: "'Oswald', 'Arial Narrow', sans-serif" },
  { key: 'playfair', label: 'Playfair Display', group: 'Com serifa', css: "'Playfair Display', Georgia, serif" },
  { key: 'merriweather', label: 'Merriweather', group: 'Com serifa', css: "'Merriweather', Georgia, serif" },
  { key: 'lora', label: 'Lora', group: 'Com serifa', css: "'Lora', Georgia, serif" },
  { key: 'garamond', label: 'EB Garamond', group: 'Com serifa', css: "'EB Garamond', Garamond, Georgia, serif" },
  { key: 'dancing', label: 'Dancing Script', group: 'Manuscrita', css: "'Dancing Script', cursive" },
  { key: 'greatvibes', label: 'Great Vibes', group: 'Manuscrita', css: "'Great Vibes', cursive" },
  { key: 'arial', label: 'Arial', group: 'Do sistema', css: 'Arial, Helvetica, sans-serif' },
  { key: 'times', label: 'Times New Roman', group: 'Do sistema', css: "'Times New Roman', Times, serif" },
  { key: 'georgia', label: 'Georgia', group: 'Do sistema', css: 'Georgia, serif' },
  { key: 'verdana', label: 'Verdana', group: 'Do sistema', css: 'Verdana, Geneva, sans-serif' },
  { key: 'courier', label: 'Courier New', group: 'Do sistema', css: "'Courier New', Courier, monospace" },
];
export const FONT_GROUPS = [...new Set(FONTS.map((f) => f.group))];
const FONT_BY_KEY = Object.fromEntries(FONTS.map((f) => [f.key, f]));
export const fontCss = (key) => (FONT_BY_KEY[key] || FONT_BY_KEY.inter).css;

// Mesma lista do <link> em client/index.html (só pesos 400/700: itálico é gerado pelo navegador).
export const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Montserrat:wght@400;700&family=Poppins:wght@400;700&family=Roboto:wght@400;700&family=Open+Sans:wght@400;700&family=Lato:wght@400;700&family=Oswald:wght@400;700&family=Playfair+Display:wght@400;700&family=Merriweather:wght@400;700&family=Lora:wght@400;700&family=EB+Garamond:wght@400;700&family=Dancing+Script:wght@400;700&family=Great+Vibes&display=swap';

export const TEXT_TYPES = ['title', 'subtitle', 'text', 'date', 'capsule'];
export const isTextual = (t) => TEXT_TYPES.includes(t);
export const isInlineEditable = (t) => t === 'title' || t === 'subtitle' || t === 'text' || t === 'capsule';
// Altura própria (guardada) em vez de automática pelo conteúdo.
export const hasFixedHeight = (t) => t === 'image' || t === 'line' || t === 'shape';

export const TYPE_LABELS = { title: 'Título', subtitle: 'Subtítulo', text: 'Texto', date: 'Data', capsule: 'Cápsula', image: 'Imagem', line: 'Linha', shape: 'Retângulo' };

const BASE = {
  fontFamily: 'inter', fontSize: 14, bold: false, italic: false, underline: false, align: 'left', color: '#14202e',
  lineHeight: 1.5, letterSpacing: 0, fill: '', borderColor: '#dce2ea', borderWidth: 0, radius: 0, opacity: 1, padding: 0, locked: false,
};

// Padrão de cada tipo (o que aparece ao inserir). `text`, `w` e `h` só valem na criação.
const TYPE_DEFAULTS = {
  title: { w: 600, text: 'Título do contrato', fontFamily: 'playfair', fontSize: 30, bold: true, align: 'center', color: '#0f2238', lineHeight: 1.2 },
  subtitle: { w: 600, text: 'Subtítulo', fontSize: 18, align: 'center', color: '#566779', lineHeight: 1.3 },
  text: { w: 660, text: 'Digite aqui o texto da cláusula.', fontSize: 14, align: 'justify', lineHeight: 1.55 },
  date: { w: 320, text: '', dateMode: 'today', dateValue: '', dateFormat: 'long', prefix: '', fontSize: 14, align: 'right' },
  capsule: { w: 220, text: 'CONTRATANTE', fontSize: 13, bold: true, align: 'center', color: '#0f2238', fill: '#f2a33a', radius: 999, padding: 8, letterSpacing: 1, lineHeight: 1.3 },
  image: { w: 160, h: 100, fit: 'contain', src: '' },
  line: { w: 660, h: 2, color: '#0f2238', lineStyle: 'solid' },
  shape: { w: 660, h: 120, fill: '#eef2f7', radius: 8 },
};
const NON_STYLE = new Set(['w', 'h', 'text', 'src']);
const styleDefaults = (t) => Object.fromEntries(Object.entries(TYPE_DEFAULTS[t] || {}).filter(([k]) => !NON_STYLE.has(k)));

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function uid() {
  let s = '';
  const buf = new Uint8Array(8);
  (globalThis.crypto || { getRandomValues: (b) => b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256))) }).getRandomValues(buf);
  for (const n of buf) s += ALPHABET[n % ALPHABET.length];
  return s;
}

export function newElement(t, over = {}) {
  const d = TYPE_DEFAULTS[t];
  if (!d) throw new Error(`Tipo de elemento desconhecido: ${t}`);
  return { id: uid(), t, x: 0, y: 0, ...BASE, ...d, ...over };
}

// Completa um elemento vindo do banco/importação com os padrões (para nunca quebrar a tela).
function resolveElement(raw) {
  if (!raw || typeof raw !== 'object' || !TYPE_DEFAULTS[raw.t]) return null;
  const d = TYPE_DEFAULTS[raw.t];
  const el = { ...BASE, ...styleDefaults(raw.t), ...raw };
  el.id = typeof el.id === 'string' && el.id ? el.id : uid();
  for (const k of ['x', 'y']) if (!Number.isFinite(el[k])) el[k] = 0;
  if (!Number.isFinite(el.w) || el.w <= 0) el.w = d.w;
  if (hasFixedHeight(el.t) && (!Number.isFinite(el.h) || el.h <= 0)) el.h = d.h;
  if (el.t === 'image' && typeof el.src !== 'string') return null;
  if (typeof el.text !== 'string') el.text = '';
  return el;
}

export const blankPage = (bg = '#ffffff') => ({ id: uid(), bg, els: [] });
export const blankDoc = () => ({ v: 1, orientation: 'portrait', pages: [blankPage()] });

export function normalizeDoc(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const pages = (Array.isArray(src.pages) ? src.pages : []).slice(0, MAX_PAGES).map((p) => ({
    id: typeof p?.id === 'string' && p.id ? p.id : uid(),
    bg: typeof p?.bg === 'string' && /^#[0-9a-f]{6}$/i.test(p.bg) ? p.bg : '#ffffff',
    els: (Array.isArray(p?.els) ? p.els : []).slice(0, MAX_ELEMENTS).map(resolveElement).filter(Boolean),
  }));
  return { v: 1, orientation: src.orientation === 'landscape' ? 'landscape' : 'portrait', pages: pages.length ? pages : [blankPage()] };
}

// ---------- Datas ----------
const pad2 = (n) => String(n).padStart(2, '0');
export const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const DATE_OPTS = {
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  short: { day: '2-digit', month: 'short', year: 'numeric' },
  numeric: { day: '2-digit', month: '2-digit', year: 'numeric' },
};
export function formatDateISO(iso, format = 'long') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('pt-BR', { ...(DATE_OPTS[format] || DATE_OPTS.long), timeZone: 'UTC' });
}
export function elementText(el, today = isoToday()) {
  if (el.t !== 'date') return el.text || '';
  const iso = el.dateMode === 'fixed' && el.dateValue ? el.dateValue : today;
  return `${el.prefix || ''}${formatDateISO(iso, el.dateFormat)}`;
}

// ---------- Estilos (os mesmos no editor, na medição e na impressão) ----------
export function boxStyle(el) {
  return {
    position: 'absolute', left: el.x, top: el.y, width: el.w,
    height: hasFixedHeight(el.t) ? el.h : 'auto',
    opacity: el.opacity, boxSizing: 'border-box',
  };
}

export function textStyle(el) {
  const border = el.borderWidth > 0 ? `${el.borderWidth}px solid ${el.borderColor}` : '0';
  return {
    boxSizing: 'border-box', width: '100%', margin: 0, display: 'block',
    padding: el.padding, border, borderRadius: el.radius, background: el.fill || 'transparent',
    fontFamily: fontCss(el.fontFamily), fontSize: el.fontSize, fontWeight: el.bold ? 700 : 400,
    fontStyle: el.italic ? 'italic' : 'normal', textDecoration: el.underline ? 'underline' : 'none',
    textAlign: el.align, color: el.color, lineHeight: el.lineHeight, letterSpacing: `${el.letterSpacing}px`,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere',
  };
}

export function imageStyle(el) {
  return {
    display: 'block', width: '100%', height: '100%', objectFit: el.fit === 'fill' ? 'fill' : el.fit || 'contain',
    boxSizing: 'border-box', borderRadius: el.radius,
    border: el.borderWidth > 0 ? `${el.borderWidth}px solid ${el.borderColor}` : '0',
  };
}

export function shapeStyle(el) {
  return {
    width: '100%', height: '100%', boxSizing: 'border-box', borderRadius: el.radius, background: el.fill || 'transparent',
    border: el.borderWidth > 0 ? `${el.borderWidth}px solid ${el.borderColor}` : '0',
  };
}

export const lineStyle = (el) => ({ width: '100%', height: 0, borderTop: `${el.h}px ${el.lineStyle || 'solid'} ${el.color}` });

// ---------- Operações imutáveis no documento ----------
export const mapPage = (doc, pageId, fn) => ({ ...doc, pages: doc.pages.map((p) => (p.id === pageId ? fn(p) : p)) });
export const patchElement = (doc, pageId, id, patch) => mapPage(doc, pageId, (p) => ({ ...p, els: p.els.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
export const addElement = (doc, pageId, el) => mapPage(doc, pageId, (p) => ({ ...p, els: [...p.els, el] }));
export const removeElement = (doc, pageId, id) => mapPage(doc, pageId, (p) => ({ ...p, els: p.els.filter((e) => e.id !== id) }));

export function findElement(doc, id) {
  for (const page of doc.pages) {
    const el = page.els.find((e) => e.id === id);
    if (el) return { page, el };
  }
  return null;
}

// Ordem de empilhamento = ordem no array (o último fica na frente).
export function reorderElement(doc, pageId, id, how) {
  return mapPage(doc, pageId, (p) => {
    const i = p.els.findIndex((e) => e.id === id);
    if (i < 0) return p;
    const els = [...p.els];
    const [el] = els.splice(i, 1);
    const to = how === 'front' ? els.length : how === 'back' ? 0 : how === 'forward' ? Math.min(i + 1, els.length) : Math.max(i - 1, 0);
    els.splice(to, 0, el);
    return { ...p, els };
  });
}

export const cloneElement = (el, dx = 16, dy = 16) => ({ ...el, id: uid(), x: el.x + dx, y: el.y + dy, locked: false });

export function addPage(doc, afterIndex = doc.pages.length - 1) {
  const pages = [...doc.pages];
  pages.splice(afterIndex + 1, 0, blankPage());
  return { ...doc, pages };
}
export function duplicatePage(doc, index) {
  const src = doc.pages[index];
  const copy = { ...src, id: uid(), els: src.els.map((e) => ({ ...e, id: uid() })) };
  const pages = [...doc.pages];
  pages.splice(index + 1, 0, copy);
  return { ...doc, pages };
}
export function movePage(doc, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= doc.pages.length) return doc;
  const pages = [...doc.pages];
  const [p] = pages.splice(index, 1);
  pages.splice(to, 0, p);
  return { ...doc, pages };
}
export function removePage(doc, index) {
  if (doc.pages.length <= 1) return doc;
  return { ...doc, pages: doc.pages.filter((_, i) => i !== index) };
}

export const round1 = (n) => Math.round(n * 10) / 10;
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Arquivo de modelo para baixar e importar depois (em outra conta, por exemplo).
export const exportPayload = (name, doc) => ({ app: 'dm-financeiro', type: 'contract', version: 1, name, doc });
