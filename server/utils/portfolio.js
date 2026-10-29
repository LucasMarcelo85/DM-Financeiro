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

function cleanPortfolioDocV1(raw) {
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


export function cleanPortfolioName(v) {
  const name = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 120) throw new AppError(400, 'Dê um nome à página (até 120 caracteres).');
  return name;
}

// ---------- Para compartilhar o link (pré-visualização no WhatsApp, redes sociais, Google) ----------
// Primeira imagem da página (banner, logo, imagem ou galeria), para virar a miniatura do link.
export function portfolioCover(doc) {
  if (doc?.v === 2) {
    for (const el of doc.elements || []) if (el.t === 'image' && el.src) return el.src;
    return '';
  }
  for (const b of doc?.blocks || []) {
    const src = b.t === 'banner' ? b.image : b.t === 'logo' || b.t === 'image' ? b.src : b.t === 'gallery' ? b.items?.[0]?.src : '';
    if (src) return src;
  }
  return '';
}

export function portfolioDescription(doc) {
  if (doc?.seo?.description) return doc.seo.description;
  if (doc?.v === 2) {
    for (const el of doc.elements || []) if (el.t === 'text' && el.text?.trim()) return el.text.replace(/\s+/g, ' ').trim().slice(0, 200);
    return '';
  }
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

// =====================================================================================================
// Formato 2 (editor livre): cada elemento tem posição e tamanho próprios para desktop, tablet e celular.
// { v: 2, kind: 'site' | 'catalog', theme, seo, pixel, heights, elements: [elemento], catalog? }
// Elementos: text, image, icon, button, shape, video, products. A ordem do vetor é a ordem das camadas (o último fica por cima).
// Manter em sincronia com client/src/lib/portfolio/model.js (listas de opções, padrões e limites).
// =====================================================================================================
export const MAX_ELEMENTS = 200;
export const DEVICES = ['desktop', 'tablet', 'mobile'];
export const KINDS = new Set(['site', 'catalog']);

const EL_TYPES = new Set(['text', 'image', 'icon', 'button', 'shape', 'video', 'products', 'catsearch', 'catgrid', 'carousel', 'menu', 'spacer']);
const ENTER = new Set(['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out', 'flip-x', 'flip-y', 'bounce', 'rotate', 'blur', 'drop']);
const LOOP = new Set(['none', 'float', 'pulse', 'shake', 'spin', 'wiggle', 'glow', 'swing', 'heartbeat', 'rubber', 'bounce', 'tada', 'flash', 'hue']);
const HOVER = new Set(['none', 'grow', 'shrink', 'lift', 'glow', 'rotate', 'tilt', 'shake', 'brighten', 'pulse']);
const FILL_TYPE = new Set(['solid', 'gradient']);
const FILL_ANIM = new Set(['none', 'flow', 'hue', 'shimmer']);
const BTN_STYLES = new Set(['solid', 'outline', 'soft', 'gradient', 'flow', 'glass', 'neon', 'threed', 'lift', 'underline', 'retro', 'shine', 'ghost', 'dashed']);
const SHAPES = new Set(['rect', 'circle', 'triangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star', 'heart', 'arrow', 'cross', 'blob', 'ring', 'line', 'parallelogram', 'trapezoid']);
const MASKS = new Set(['none', 'circle', 'rounded', 'hexagon', 'diamond', 'triangle', 'star', 'heart', 'blob']);
const SHADOWS = new Set(['none', 'soft', 'medium', 'strong', 'glow', 'hard']);
const TEXT_SHADOWS = new Set(['none', 'soft', 'hard', 'neon']);
const FIT = new Set(['cover', 'contain', 'fill']);
const ALIGN2 = new Set(['left', 'center', 'right', 'justify']);
const VALIGN = new Set(['top', 'middle', 'bottom']);
const WEIGHTS = new Set([300, 400, 500, 600, 700, 800, 900]);
const BORDER_STYLE = new Set(['solid', 'dashed', 'dotted']);
const ICON_BG = new Set(['none', 'circle', 'rounded', 'square']);
const CAT_DISPLAY = new Set(['category', 'mixed', 'only', 'selected']);
const CARD_STYLE = new Set(['soft', 'flat', 'outline']);
const ICON_NAME = /^[a-z0-9-]{1,30}$/;
const META_ID = /^\d{8,20}$/;
const GOOGLE_ID = /^(G|AW|GT|DC)-[A-Za-z0-9-]{4,30}$/;
const TIKTOK_ID = /^[A-Z0-9]{8,30}$/;

function cleanFill(raw, d) {
  const f = isObj(raw) ? raw : {};
  return {
    type: pick(f.type, FILL_TYPE, d.type), c1: color(f.c1, d.c1), c2: color(f.c2, d.c2),
    angle: num(f.angle, 0, 360, d.angle), animate: pick(f.animate, FILL_ANIM, d.animate),
  };
}
const FILL_DEFAULT = { type: 'solid', c1: '#f2a33a', c2: '#d6336c', angle: 135, animate: 'none' };

function cleanBox(raw, fallback, withFont) {
  const b = isObj(raw) ? raw : {};
  const f = fallback || { x: 40, y: 40, w: 200, h: 80, r: 0, hide: false, fs: 18 };
  const out = {
    x: num(b.x, -1000, 4000, f.x), y: num(b.y, -200, 30000, f.y), w: num(b.w, 4, 4000, f.w), h: num(b.h, 4, 8000, f.h),
    r: num(b.r, -360, 360, f.r ?? 0), hide: bool(b.hide, f.hide ?? false),
  };
  if (withFont) out.fs = num(b.fs, 6, 400, f.fs ?? 18);
  return out;
}

function cleanAnim(raw) {
  const a = isObj(raw) ? raw : {};
  return {
    enter: pick(a.enter, ENTER, 'none'), loop: pick(a.loop, LOOP, 'none'), hover: pick(a.hover, HOVER, 'none'),
    delay: num(a.delay, 0, 5000, 0), duration: num(a.duration, 100, 4000, 700),
  };
}

function cleanElement(raw) {
  if (!isObj(raw) || !EL_TYPES.has(raw.t)) return null;
  const withFont = raw.t === 'text' || raw.t === 'button';
  const el = { id: typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : newId(), t: raw.t, name: line(raw.name, 60), locked: bool(raw.locked, false) };
  const boxes = isObj(raw.box) ? raw.box : {};
  const desktop = cleanBox(boxes.desktop, null, withFont);
  el.box = { desktop, tablet: cleanBox(boxes.tablet, desktop, withFont), mobile: cleanBox(boxes.mobile, desktop, withFont) };
  el.anim = cleanAnim(raw.anim);

  switch (raw.t) {
    case 'text':
      Object.assign(el, {
        text: str(raw.text, 4000), font: FONT_KEYS.has(raw.font) ? raw.font : 'inter', weight: WEIGHTS.has(raw.weight) ? raw.weight : 400,
        italic: bool(raw.italic, false), underline: bool(raw.underline, false), upper: bool(raw.upper, false),
        align: pick(raw.align, ALIGN2, 'left'), valign: pick(raw.valign, VALIGN, 'top'), color: color(raw.color, '#14202e'),
        lineHeight: num(raw.lineHeight, 0.8, 3, 1.3), spacing: num(raw.spacing, -5, 30, 0),
        fill: cleanFill(raw.fill, FILL_DEFAULT), useFill: bool(raw.useFill, false),
        shadow: pick(raw.shadow, TEXT_SHADOWS, 'none'), shadowColor: color(raw.shadowColor, '#000000'), link: cleanLink(raw.link),
      });
      break;
    case 'image': {
      const f = isObj(raw.filters) ? raw.filters : {};
      Object.assign(el, {
        src: image(raw.src), alt: line(raw.alt, 160), fit: pick(raw.fit, FIT, 'cover'),
        zoom: num(raw.zoom, 1, 5, 1), px: num(raw.px, 0, 100, 50), py: num(raw.py, 0, 100, 50),
        flipX: bool(raw.flipX, false), flipY: bool(raw.flipY, false), radius: num(raw.radius, 0, 500, 0), mask: pick(raw.mask, MASKS, 'none'),
        borderW: num(raw.borderW, 0, 40, 0), borderColor: color(raw.borderColor, '#ffffff'), shadow: pick(raw.shadow, SHADOWS, 'none'),
        opacity: num(raw.opacity, 5, 100, 100),
        filters: {
          brightness: num(f.brightness, 0, 200, 100), contrast: num(f.contrast, 0, 200, 100), saturate: num(f.saturate, 0, 300, 100),
          grayscale: num(f.grayscale, 0, 100, 0), blur: num(f.blur, 0, 20, 0), hue: num(f.hue, 0, 360, 0), sepia: num(f.sepia, 0, 100, 0),
        },
        link: cleanLink(raw.link),
      });
      break;
    }
    case 'icon':
      Object.assign(el, {
        name: typeof raw.name === 'string' && ICON_NAME.test(raw.name) ? raw.name : 'star', color: color(raw.color, '#14202e'),
        bg: pick(raw.bg, ICON_BG, 'none'), bgColor: color(raw.bgColor, '#f2a33a'), borderW: num(raw.borderW, 0, 20, 0), borderColor: color(raw.borderColor, '#14202e'),
        shadow: pick(raw.shadow, SHADOWS, 'none'), fixed: bool(raw.fixed, false),
        fixedAnchor: pick(raw.fixedAnchor, new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']), 'bottom-right'),
        scrollAction: pick(raw.scrollAction, new Set(['none', 'top', 'bottom']), 'none'), link: cleanLink(raw.link),
      });
      break;
    case 'button':
      Object.assign(el, {
        label: line(raw.label, 120), style: pick(raw.style, BTN_STYLES, 'solid'), color: color(raw.color, '#f2a33a'), color2: color(raw.color2, '#d6336c'),
        textColor: color(raw.textColor, '#14202e'), font: FONT_KEYS.has(raw.font) ? raw.font : 'inter', weight: WEIGHTS.has(raw.weight) ? raw.weight : 700,
        radius: num(raw.radius, 0, 200, 12), icon: typeof raw.icon === 'string' && ICON_NAME.test(raw.icon) ? raw.icon : '', iconPos: raw.iconPos === 'right' ? 'right' : 'left',
        link: cleanLink(raw.link),
      });
      break;
    case 'shape':
      Object.assign(el, {
        shape: pick(raw.shape, SHAPES, 'rect'), fill: cleanFill(raw.fill, FILL_DEFAULT), borderW: num(raw.borderW, 0, 40, 0),
        borderColor: color(raw.borderColor, '#14202e'), borderStyle: pick(raw.borderStyle, BORDER_STYLE, 'solid'), shadow: pick(raw.shadow, SHADOWS, 'none'),
        radius: num(raw.radius, 0, 500, 0), opacity: num(raw.opacity, 5, 100, 100), full: bool(raw.full, false),
        fixed: bool(raw.fixed, false),
        fixedAnchor: pick(raw.fixedAnchor, new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']), 'bottom-right'),
        scrollAction: pick(raw.scrollAction, new Set(['none', 'top', 'bottom']), 'none'), link: cleanLink(raw.link),
      });
      break;
    case 'spacer':
      Object.assign(el, {
        fill: cleanFill(raw.fill, FILL_DEFAULT), full: bool(raw.full, true), opacity: num(raw.opacity, 0, 100, 100),
        borderW: num(raw.borderW, 0, 40, 0), borderColor: color(raw.borderColor, '#14202e'), shadow: pick(raw.shadow, SHADOWS, 'none'),
      });
      break;
    case 'video':
      Object.assign(el, { url: videoUrl(raw.url), radius: num(raw.radius, 0, 200, 12) });
      break;
    case 'carousel':
      Object.assign(el, {
        slides: (Array.isArray(raw.slides) ? raw.slides : []).slice(0, 12).map((s, i) => ({
          id: typeof s?.id === 'string' && /^[\w-]{1,40}$/.test(s.id) ? s.id : `s${i}`,
          src: image(s?.src), alt: line(s?.alt, 160), link: cleanLink(s?.link),
        })).filter((s) => s.src),
        autoplay: bool(raw.autoplay, true), interval: num(raw.interval, 2, 15, 5), arrows: bool(raw.arrows, true), dots: bool(raw.dots, true),
        fit: pick(raw.fit, ['cover', 'contain'], 'cover'), radius: num(raw.radius, 0, 200, 12),
      });
      break;
    case 'menu':
      Object.assign(el, {
        items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 12).map((s, i) => ({
          id: typeof s?.id === 'string' && /^[\w-]{1,40}$/.test(s.id) ? s.id : `m${i}`,
          label: line(s?.label, 40), link: cleanLink(s?.link),
        })).filter((s) => s.label),
        variant: pick(raw.variant, ['auto', 'hamburger', 'bar'], 'auto'), title: line(raw.title, 40),
        color: color(raw.color, '#14202e'), bg: color(raw.bg, '#ffffff'), radius: num(raw.radius, 0, 60, 12),
      });
      break;
    case 'products': {
      const c = isObj(raw.cols) ? raw.cols : {};
      Object.assign(el, {
        ids: [...new Set((Array.isArray(raw.ids) ? raw.ids : []).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 24),
        cols: { desktop: Math.round(num(c.desktop, 1, 6, 4)), tablet: Math.round(num(c.tablet, 1, 6, 3)), mobile: Math.round(num(c.mobile, 1, 4, 2)) },
        whatsapp: raw.whatsapp ? normalizePhone(raw.whatsapp) || '' : '', buttonLabel: line(raw.buttonLabel, 40) || 'Pedir no WhatsApp', showPrice: bool(raw.showPrice, true),
        cardStyle: pick(raw.cardStyle, CARD_STYLE, 'soft'),
      });
      break;
    }
    case 'catsearch':
      Object.assign(el, { showSearch: bool(raw.showSearch, true), showCategories: bool(raw.showCategories, true), placeholder: line(raw.placeholder, 60) || 'Buscar produtos' });
      break;
    case 'catgrid': {
      const c = isObj(raw.cols) ? raw.cols : {};
      el.cols = { desktop: Math.round(num(c.desktop, 1, 6, 4)), tablet: Math.round(num(c.tablet, 1, 6, 3)), mobile: Math.round(num(c.mobile, 1, 4, 2)) };
      break;
    }
    default:
      return null;
  }
  return el;
}

function cleanDocV2(raw, kindHint) {
  if (!Array.isArray(raw.elements)) throw new AppError(400, 'Documento da página inválido.');
  if (raw.elements.length > MAX_ELEMENTS) throw new AppError(400, `A página pode ter no máximo ${MAX_ELEMENTS} elementos.`);
  const t = isObj(raw.theme) ? raw.theme : {};
  const seo = isObj(raw.seo) ? raw.seo : {};
  const px = isObj(raw.pixel) ? raw.pixel : {};
  const h = isObj(raw.heights) ? raw.heights : {};
  const kind = KINDS.has(kindHint) ? kindHint : KINDS.has(raw.kind) ? raw.kind : 'site';
  const doc = {
    v: 2, kind,
    theme: {
      primary: color(t.primary, DEFAULT_THEME.primary), bg: color(t.bg, DEFAULT_THEME.bg), text: color(t.text, DEFAULT_THEME.text),
      headingFont: FONT_KEYS.has(t.headingFont) ? t.headingFont : DEFAULT_THEME.headingFont,
      bodyFont: FONT_KEYS.has(t.bodyFont) ? t.bodyFont : DEFAULT_THEME.bodyFont,
      radius: pick(t.radius, RADIUS, DEFAULT_THEME.radius),
      bgType: pick(t.bgType, FILL_TYPE, 'solid'), bgColor2: color(t.bgColor2, '#e9eef5'), bgAngle: num(t.bgAngle, 0, 360, 135), bgAnimate: pick(t.bgAnimate, FILL_ANIM, 'none'),
    },
    seo: { title: line(seo.title, 120), description: str(seo.description, 300).replace(/[\r\n]+/g, ' ') },
    // Pixel de acompanhamento para tráfego pago (só os identificadores; os scripts oficiais são carregados na página pública).
    pixel: {
      meta: typeof px.meta === 'string' && META_ID.test(px.meta.trim()) ? px.meta.trim() : '',
      google: typeof px.google === 'string' && GOOGLE_ID.test(px.google.trim()) ? px.google.trim() : '',
      tiktok: typeof px.tiktok === 'string' && TIKTOK_ID.test(px.tiktok.trim()) ? px.tiktok.trim() : '',
    },
    heights: { desktop: num(h.desktop, 200, 30000, 700), tablet: num(h.tablet, 200, 30000, 700), mobile: num(h.mobile, 200, 30000, 700) },
    // true = o usuário já ajustou à mão aquela tela; false = ela acompanha o desenho do computador.
    manual: isObj(raw.manual) ? { tablet: bool(raw.manual.tablet, true), mobile: bool(raw.manual.mobile, true) } : { tablet: true, mobile: true },
    elements: [],
  };
  if (kind === 'catalog') {
    const c = isObj(raw.catalog) ? raw.catalog : {};
    const cols = isObj(c.columns) ? c.columns : {};
    doc.catalog = {
      display: pick(c.display, CAT_DISPLAY, 'category'), onlyCategory: line(c.onlyCategory, 60),
      selectedProductIds: [...new Set((Array.isArray(c.selectedProductIds) ? c.selectedProductIds : []).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 1000),
      card: (() => {
        const k = isObj(c.card) ? c.card : {};
        const optColor = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '');
        return {
          layout: pick(k.layout, new Set(['vertical', 'horizontal']), 'vertical'),
          ratio: pick(k.ratio, new Set(['square', 'portrait', 'landscape', 'wide', 'tall', 'custom']), 'square'),
          imgHeight: Math.round(num(k.imgHeight, 60, 600, 180)),
          imgX: Math.round(num(k.imgX, 0, 100, 50)), imgY: Math.round(num(k.imgY, 0, 100, 50)),
          imgPad: Math.round(num(k.imgPad, 0, 40, 0)), imgBg: optColor(k.imgBg),
          font: FONT_KEYS.has(k.font) ? k.font : '',
          nameLines: Math.round(num(k.nameLines, 1, 3, 2)),
          gap: Math.round(num(k.gap, 6, 40, 14)),
          icon: typeof k.icon === 'string' && ICON_NAME.test(k.icon) ? k.icon : '',
          iconPos: pick(k.iconPos, new Set(['button', 'name', 'corner']), 'button'),
          iconColor: optColor(k.iconColor),
          fit: pick(k.fit, new Set(['cover', 'contain']), 'cover'),
          align: pick(k.align, new Set(['left', 'center']), 'left'),
          radius: Math.round(num(k.radius, 0, 32, 14)),
          bg: optColor(k.bg), text: optColor(k.text), accent: optColor(k.accent),
          showImage: bool(k.showImage, true), showCategory: bool(k.showCategory, true), showName: bool(k.showName, true),
          showDescription: bool(k.showDescription, false), showPrice: bool(k.showPrice, true), showTiers: bool(k.showTiers, false),
          showVariations: bool(k.showVariations, true), showButton: bool(k.showButton, true),
          shadow: pick(k.shadow, new Set(['none', 'soft', 'strong']), 'soft'),
          border: bool(k.border, false),
          padding: pick(k.padding, new Set(['compact', 'normal', 'roomy']), 'normal'),
          textSize: pick(k.textSize, new Set(['sm', 'md', 'lg']), 'md'),
          priceSize: pick(k.priceSize, new Set(['sm', 'md', 'lg']), 'md'),
          buttonStyle: pick(k.buttonStyle, new Set(['solid', 'outline', 'soft']), 'solid'),
          buttonFull: bool(k.buttonFull, true),
          priceFrom: bool(k.priceFrom, true),
        };
      })(),
      columns: { desktop: Math.round(num(cols.desktop, 1, 6, 4)), tablet: Math.round(num(cols.tablet, 1, 6, 3)), mobile: Math.round(num(cols.mobile, 1, 3, 2)) },
      showSearch: bool(c.showSearch, true), showCategories: bool(c.showCategories, true), cardStyle: pick(c.cardStyle, CARD_STYLE, 'soft'),
      orderMode: pick(c.orderMode, new Set(['cart', 'direct']), 'cart'),
      addLabel: line(c.addLabel, 30) || 'Adicionar', cartTitle: line(c.cartTitle, 60) || 'Seu carrinho', checkoutNote: str(c.checkoutNote, 300),
      cartLayout: pick(c.cartLayout, new Set(['standard', 'compact', 'split']), 'standard'),
      cartLink: /^[a-z0-9_-]{1,24}$/i.test(line(c.cartLink, 24)) ? line(c.cartLink, 24).toLowerCase() : 'carrinho',
      cartButtonLabel: line(c.cartButtonLabel, 40),
      elementized: bool(c.elementized, false),
      cartButtonUrl: (() => {
        const value = str(c.cartButtonUrl, 500).trim();
        return /^https?:\/\/[^\s]+$/i.test(value) ? value : '';
      })(),
    };
  }
  const seen = new Set();
  for (const rawEl of raw.elements) {
    const el = cleanElement(rawEl);
    if (!el) continue;
    while (seen.has(el.id)) el.id = newId();
    seen.add(el.id);
    doc.elements.push(el);
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_DOC_BYTES) {
    throw new AppError(413, 'A página ficou grande demais para salvar. Use imagens menores ou menos imagens.');
  }
  return doc;
}

// Aceita o formato novo (v2) e o antigo (blocos empilhados), para não quebrar páginas já salvas.
export function cleanPortfolioDoc(raw, kind) {
  if (isObj(raw) && raw.v === 2) return cleanDocV2(raw, kind);
  return cleanPortfolioDocV1(raw);
}

export const emptyPortfolioDoc = (kind = 'site') => cleanDocV2({ elements: [] }, kind);
