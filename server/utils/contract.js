import crypto from 'node:crypto';
import { AppError } from './helpers.js';

// Valida e "limpa" o documento do editor de contratos antes de salvar.
// O documento é reconstruído só com campos conhecidos (lista branca) e valores dentro de limites,
// então nada inesperado chega ao banco, mesmo se alguém chamar a API direto.
//
// Formato:
//   { v: 1, orientation: 'portrait' | 'landscape', pages: [{ id, bg, els: [elemento] }] }
// Fontes: manter em sincronia com client/src/lib/contract/model.js (FONTS).

export const FONT_KEYS = new Set([
  'inter', 'montserrat', 'poppins', 'roboto', 'opensans', 'lato', 'oswald',
  'playfair', 'merriweather', 'lora', 'garamond', 'dancing', 'greatvibes',
  'arial', 'times', 'georgia', 'verdana', 'courier',
]);
const TYPES = new Set(['title', 'subtitle', 'text', 'date', 'capsule', 'image', 'line', 'shape']);
const ALIGN = new Set(['left', 'center', 'right', 'justify']);
const FIT = new Set(['contain', 'cover', 'fill']);
const DATE_MODE = new Set(['today', 'fixed']);
const DATE_FMT = new Set(['long', 'short', 'numeric']);
const LINE_STYLE = new Set(['solid', 'dashed', 'dotted']);

export const MAX_PAGES = 40;
export const MAX_ELEMENTS = 300;
export const MAX_DOC_BYTES = 9 * 1024 * 1024;
const MAX_IMAGE_CHARS = 3 * 1024 * 1024;
const MAX_TEXT = 30000;

const HEX = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const IMG_PREFIX = /^data:image\/(png|jpeg|webp|gif);base64,/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const newId = () => crypto.randomBytes(6).toString('hex');

function num(v, min, max) {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : undefined;
}

function color(v) {
  if (typeof v !== 'string') return undefined;
  if (HEX.test(v)) return v.toLowerCase();
  if (HEX3.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  return undefined;
}

// Cor opcional: '' (ou 'transparent') significa "sem cor".
function optColor(v) {
  if (v === '' || v === 'transparent') return '';
  return color(v);
}

function image(v) {
  if (typeof v !== 'string' || v.length > MAX_IMAGE_CHARS) return undefined;
  const m = IMG_PREFIX.exec(v);
  if (!m) return undefined;
  return B64.test(v.slice(m[0].length)) ? v : undefined;
}

function cleanElement(raw) {
  if (!isObj(raw) || !TYPES.has(raw.t)) return null;
  const el = { id: typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : newId(), t: raw.t };

  const set = (key, value) => { if (value !== undefined) el[key] = value; };
  set('x', num(raw.x, -2000, 4000));
  set('y', num(raw.y, -2000, 4000));
  set('w', num(raw.w, 2, 3000));
  set('h', num(raw.h, 1, 3000));
  if (el.x === undefined) el.x = 0;
  if (el.y === undefined) el.y = 0;
  if (el.w === undefined) el.w = 200;

  if (typeof raw.text === 'string') el.text = raw.text.slice(0, MAX_TEXT);
  if (FONT_KEYS.has(raw.fontFamily)) el.fontFamily = raw.fontFamily;
  set('fontSize', num(raw.fontSize, 6, 300));
  set('lineHeight', num(raw.lineHeight, 0.6, 4));
  set('letterSpacing', num(raw.letterSpacing, -5, 40));
  for (const k of ['bold', 'italic', 'underline', 'locked']) if (typeof raw[k] === 'boolean') el[k] = raw[k];
  if (ALIGN.has(raw.align)) el.align = raw.align;
  set('color', color(raw.color));
  set('fill', optColor(raw.fill));
  set('borderColor', optColor(raw.borderColor));
  set('borderWidth', num(raw.borderWidth, 0, 40));
  set('radius', num(raw.radius, 0, 1000));
  set('opacity', num(raw.opacity, 0.05, 1));
  set('padding', num(raw.padding, 0, 120));

  if (raw.t === 'image') {
    set('src', image(raw.src));
    if (FIT.has(raw.fit)) el.fit = raw.fit;
    if (!el.src) return null; // imagem inválida ou grande demais é descartada
    if (el.h === undefined) el.h = el.w;
  }
  if (raw.t === 'date') {
    if (DATE_MODE.has(raw.dateMode)) el.dateMode = raw.dateMode;
    if (typeof raw.dateValue === 'string' && ISO.test(raw.dateValue)) el.dateValue = raw.dateValue;
    if (DATE_FMT.has(raw.dateFormat)) el.dateFormat = raw.dateFormat;
    if (typeof raw.prefix === 'string') el.prefix = raw.prefix.slice(0, 120);
  }
  if (raw.t === 'line') {
    if (LINE_STYLE.has(raw.lineStyle)) el.lineStyle = raw.lineStyle;
  }
  if (raw.t === 'line' || raw.t === 'shape') {
    if (el.h === undefined) el.h = raw.t === 'line' ? 2 : 100;
  }
  return el;
}

export function cleanDoc(raw) {
  if (!isObj(raw) || !Array.isArray(raw.pages)) throw new AppError(400, 'Documento do contrato inválido.');
  if (raw.pages.length < 1) throw new AppError(400, 'O contrato precisa ter pelo menos uma página.');
  if (raw.pages.length > MAX_PAGES) throw new AppError(400, `O contrato pode ter no máximo ${MAX_PAGES} páginas.`);

  const doc = { v: 1, orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait', pages: [] };
  const seen = new Set();
  const unique = (id) => {
    let out = typeof id === 'string' && ID.test(id) && !seen.has(id) ? id : newId();
    while (seen.has(out)) out = newId();
    seen.add(out);
    return out;
  };

  for (const p of raw.pages) {
    if (!isObj(p)) throw new AppError(400, 'Documento do contrato inválido.');
    const els = Array.isArray(p.els) ? p.els : [];
    if (els.length > MAX_ELEMENTS) throw new AppError(400, `Cada página pode ter no máximo ${MAX_ELEMENTS} elementos.`);
    const page = { id: unique(p.id), bg: color(p.bg) || '#ffffff', els: [] };
    for (const e of els) {
      const el = cleanElement(e);
      if (el) { el.id = unique(el.id); page.els.push(el); }
    }
    doc.pages.push(page);
  }

  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_DOC_BYTES) {
    throw new AppError(413, 'O contrato ficou grande demais para salvar. Use imagens menores ou menos imagens.');
  }
  return doc;
}

export function cleanName(v) {
  const name = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 120) throw new AppError(400, 'Dê um nome ao contrato (até 120 caracteres).');
  return name;
}
