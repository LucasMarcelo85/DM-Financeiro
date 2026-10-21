import crypto from 'node:crypto';
import { AppError, normalizePhone } from './helpers.js';
import { FONT_KEYS } from './contract.js';

// Valida e "limpa" o documento do editor de portfólio antes de salvar (e antes de qualquer pessoa ver a página pública).
// O documento é reconstruído só com campos conhecidos (lista branca) e valores dentro de limites: nada inesperado
// chega ao banco nem à página pública, mesmo que alguém chame a API direto.
//
// Formato: { v: 1, theme: {...}, seo: { title, description }, blocks: [bloco] }
// Blocos: banner, logo, heading, text, image, gallery, video, button, divider, spacer.
// Manter em sincronia com client/src/lib/portfolio/model.js (padrões, opções e vídeo).

export const MAX_BLOCKS = 80;
export const MAX_GALLERY = 12;
export const MAX_DOC_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_CHARS = 2_500_000;

const TYPES = new Set(['banner', 'logo', 'heading', 'text', 'image', 'gallery', 'video', 'button', 'divider', 'spacer']);
const ALIGN = new Set(['left', 'center', 'right']);
const RADIUS = new Set(['square', 'soft', 'pill']);
const WIDTH = new Set(['narrow', 'normal', 'wide']);
const BANNER_H = new Set(['sm', 'md', 'lg']);
const HEADING_SIZE = new Set(['sm', 'md', 'lg', 'xl']);
const TEXT_SIZE = new Set(['sm', 'md', 'lg']);
const IMG_W = new Set(['sm', 'md', 'lg', 'full']);
const IMG_RADIUS = new Set(['none', 'soft', 'round']);
const BTN_STYLE = new Set(['solid', 'outline', 'soft']);
const BTN_SIZE = new Set(['md', 'lg']);
const LINE_STYLE = new Set(['solid', 'dashed', 'dotted']);
const LINK_KINDS = new Set(['link', 'whatsapp', 'email', 'tel']);

const HEX = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const IMG_PREFIX = /^data:image\/(png|jpeg|webp|gif);base64,/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export const DEFAULT_THEME = {
  primary: '#f2a33a', bg: '#ffffff', text: '#14202e', headingFont: 'playfair', bodyFont: 'inter', radius: 'soft', width: 'normal',
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const newId = () => crypto.randomBytes(6).toString('hex');
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const line = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, max) : '');
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const pick = (v, set, d) => (set.has(v) ? v : d);

function num(v, min, max, d) {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : d;
}

function color(v, d) {
  if (typeof v === 'string') {
    if (HEX.test(v)) return v.toLowerCase();
    if (HEX3.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return d;
}
// Cor opcional: '' = "usar a cor do tema".
const optColor = (v) => (v === '' || v == null ? '' : color(v, ''));

// Imagem: só data URL de PNG/JPEG/WebP/GIF (SVG fica de fora de propósito). Vazio = sem imagem.
function image(v) {
  if (v === '' || v == null) return '';
  const m = typeof v === 'string' && v.length <= MAX_IMAGE_CHARS ? IMG_PREFIX.exec(v) : null;
  if (!m || !B64.test(v.slice(m[0].length))) {
    throw new AppError(400, 'Uma das imagens não é válida. Use PNG, JPG, WebP ou GIF de até ~2,5 MB.');
  }
  return v;
}

// ---------- Links dos botões ----------
function cleanUrl(v) {
  let s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 2000 || /\s/.test(s)) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`; // "meusite.com.br" -> https://meusite.com.br
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : ''; // nada de javascript:, data: etc.
  } catch {
    return '';
  }
}

function cleanLink(raw) {
  const l = isObj(raw) ? raw : {};
  const kind = pick(l.kind, LINK_KINDS, 'link');
  const out = { kind, url: '', phone: '', message: '', email: '' };
  if (kind === 'link') out.url = cleanUrl(l.url);
  else if (kind === 'whatsapp') { out.phone = normalizePhone(l.phone) || ''; out.message = str(l.message, 500); }
  else if (kind === 'tel') out.phone = normalizePhone(l.phone) || '';
  else out.email = typeof l.email === 'string' && l.email.length <= 254 && EMAIL.test(l.email.trim()) ? l.email.trim() : '';
  return out;
}

// ---------- Vídeo (só por link: YouTube, Vimeo ou arquivo direto) ----------
// Devolve { kind: 'youtube' | 'vimeo' | 'file', id?, url? } ou null.
export function parseVideo(raw) {
  let u;
  try { u = new URL(typeof raw === 'string' ? raw.trim() : ''); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  const YT = /^[A-Za-z0-9_-]{11}$/;
  if (host === 'youtu.be' && YT.test(seg[0] || '')) return { kind: 'youtube', id: seg[0] };
  if (['youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    const id = u.searchParams.get('v') || (['embed', 'shorts', 'live', 'v'].includes(seg[0]) ? seg[1] : '');
    if (YT.test(id || '')) return { kind: 'youtube', id };
  }
  if (host === 'vimeo.com' && /^\d{5,12}$/.test(seg[0] || '')) return { kind: 'vimeo', id: seg[0] };
  if (host === 'player.vimeo.com' && seg[0] === 'video' && /^\d{5,12}$/.test(seg[1] || '')) return { kind: 'vimeo', id: seg[1] };
  if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) return { kind: 'file', url: u.href };
  return null;
}
const videoUrl = (v) => (typeof v === 'string' && v.length <= 600 && parseVideo(v) ? v.trim() : '');

// ---------- Blocos ----------
function cleanBlock(raw) {
  if (!isObj(raw) || !TYPES.has(raw.t)) return null;
  const b = { id: typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : newId(), t: raw.t };

  switch (raw.t) {
    case 'banner':
      Object.assign(b, {
        image: image(raw.image), bgColor: optColor(raw.bgColor),
        overlay: num(raw.overlay, 0, 0.9, 0.35), overlayColor: color(raw.overlayColor, '#000000'),
        title: line(raw.title, 200), subtitle: str(raw.subtitle, 600),
        align: pick(raw.align, ALIGN, 'center'), height: pick(raw.height, BANNER_H, 'md'), textColor: color(raw.textColor, '#ffffff'),
        showButton: bool(raw.showButton, false), buttonLabel: line(raw.buttonLabel, 80), link: cleanLink(raw.link),
      });
      break;
    case 'logo':
      Object.assign(b, { src: image(raw.src), size: num(raw.size, 24, 240, 72), align: pick(raw.align, ALIGN, 'center') });
      break;
    case 'heading':
      Object.assign(b, { text: line(raw.text, 300), size: pick(raw.size, HEADING_SIZE, 'lg'), align: pick(raw.align, ALIGN, 'left'), color: optColor(raw.color) });
      break;
    case 'text':
      Object.assign(b, { text: str(raw.text, 8000), size: pick(raw.size, TEXT_SIZE, 'md'), align: pick(raw.align, ALIGN, 'left'), color: optColor(raw.color) });
      break;
    case 'image':
      Object.assign(b, {
        src: image(raw.src), alt: line(raw.alt, 160), caption: line(raw.caption, 300),
        width: pick(raw.width, IMG_W, 'md'), radius: pick(raw.radius, IMG_RADIUS, 'soft'), align: pick(raw.align, ALIGN, 'center'),
      });
      break;
    case 'gallery': {
      const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, MAX_GALLERY).filter(isObj)
        .map((it) => ({ id: typeof it.id === 'string' && ID.test(it.id) ? it.id : newId(), src: image(it.src), alt: line(it.alt, 160) }))
        .filter((it) => it.src);
      Object.assign(b, { items, cols: raw.cols === 2 ? 2 : raw.cols === 4 ? 4 : 3, radius: pick(raw.radius, IMG_RADIUS, 'soft') });
      break;
    }
    case 'video':
      Object.assign(b, { url: videoUrl(raw.url), caption: line(raw.caption, 300), width: pick(raw.width, IMG_W, 'lg') });
      break;
    case 'button':
      Object.assign(b, {
        label: line(raw.label, 80), link: cleanLink(raw.link), style: pick(raw.style, BTN_STYLE, 'solid'),
        size: pick(raw.size, BTN_SIZE, 'md'), align: pick(raw.align, ALIGN, 'center'), full: bool(raw.full, false), color: optColor(raw.color),
      });
      break;
    case 'divider':
      Object.assign(b, { style: pick(raw.style, LINE_STYLE, 'solid'), color: optColor(raw.color) });
      break;
    case 'spacer':
      Object.assign(b, { height: num(raw.height, 4, 240, 32) });
      break;
    default:
      return null;
  }
  return b;
}

export function cleanPortfolioDoc(raw) {
  if (!isObj(raw) || !Array.isArray(raw.blocks)) throw new AppError(400, 'Documento da página inválido.');
  if (raw.blocks.length > MAX_BLOCKS) throw new AppError(400, `A página pode ter no máximo ${MAX_BLOCKS} blocos.`);

  const t = isObj(raw.theme) ? raw.theme : {};
  const seo = isObj(raw.seo) ? raw.seo : {};
  const doc = {
    v: 1,
    theme: {
      primary: color(t.primary, DEFAULT_THEME.primary), bg: color(t.bg, DEFAULT_THEME.bg), text: color(t.text, DEFAULT_THEME.text),
      headingFont: FONT_KEYS.has(t.headingFont) ? t.headingFont : DEFAULT_THEME.headingFont,
      bodyFont: FONT_KEYS.has(t.bodyFont) ? t.bodyFont : DEFAULT_THEME.bodyFont,
      radius: pick(t.radius, RADIUS, DEFAULT_THEME.radius), width: pick(t.width, WIDTH, DEFAULT_THEME.width),
    },
    seo: { title: line(seo.title, 120), description: str(seo.description, 300).replace(/[\r\n]+/g, ' ') },
    blocks: [],
  };

  const seen = new Set();
  for (const rawBlock of raw.blocks) {
    const b = cleanBlock(rawBlock);
    if (!b) continue;
    while (seen.has(b.id)) b.id = newId();
    seen.add(b.id);
    if (b.t === 'gallery') {
      const ids = new Set();
      for (const it of b.items) { while (ids.has(it.id)) it.id = newId(); ids.add(it.id); }
    }
    doc.blocks.push(b);
  }

  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_DOC_BYTES) {
    throw new AppError(413, 'A página ficou grande demais para salvar. Use imagens menores ou menos imagens.');
  }
  return doc;
}

export const emptyPortfolioDoc = () => cleanPortfolioDoc({ blocks: [] });

export function cleanPortfolioName(v) {
  const name = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 120) throw new AppError(400, 'Dê um nome à página (até 120 caracteres).');
  return name;
}

// ---------- Para compartilhar o link (pré-visualização no WhatsApp, redes sociais, Google) ----------
// Primeira imagem da página (banner, logo, imagem ou galeria), para virar a miniatura do link.
export function portfolioCover(doc) {
  for (const b of doc?.blocks || []) {
    const src = b.t === 'banner' ? b.image : b.t === 'logo' || b.t === 'image' ? b.src : b.t === 'gallery' ? b.items?.[0]?.src : '';
    if (src) return src;
  }
  return '';
}

export function portfolioDescription(doc) {
  if (doc?.seo?.description) return doc.seo.description;
  for (const b of doc?.blocks || []) {
    const t = b.t === 'banner' ? b.subtitle : b.t === 'text' ? b.text : '';
    if (t && t.trim()) return t.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  return '';
}

export function decodeImage(src) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(src || '');
  return m ? { mime: m[1], buffer: Buffer.from(m[2], 'base64') } : null;
}
