// Modelo do documento do editor de portfólio (código puro, sem React).
//
// Peças compartilhadas do portfólio: tema, cores, links e vídeo (código puro, sem React).
// O documento do editor livre (elementos com posição por dispositivo) fica em doc.js.
// O servidor valida o mesmo formato em server/utils/portfolio.js (manter padrões, opções e vídeo em sincronia).

import { fontCss } from '../contract/model.js';

export { FONTS, FONT_GROUPS, fontCss } from '../contract/model.js';
export const DEFAULT_THEME = {
  primary: '#f2a33a', bg: '#ffffff', text: '#14202e', headingFont: 'playfair', bodyFont: 'inter', radius: 'soft', width: 'normal',
};

// Combinações prontas de cor (o usuário ainda pode ajustar cada cor depois).
export const THEME_PRESETS = [
  { key: 'ambar', label: 'Âmbar', primary: '#f2a33a', bg: '#ffffff', text: '#14202e' },
  { key: 'oceano', label: 'Oceano', primary: '#1f55a6', bg: '#ffffff', text: '#14202e' },
  { key: 'floresta', label: 'Floresta', primary: '#137a52', bg: '#f6faf7', text: '#10251b' },
  { key: 'rosa', label: 'Rosa', primary: '#d6336c', bg: '#fff8fa', text: '#2a1520' },
  { key: 'roxo', label: 'Roxo', primary: '#6d4aff', bg: '#ffffff', text: '#1b1630' },
  { key: 'grafite', label: 'Grafite', primary: '#27496d', bg: '#f3f5f8', text: '#14202e' },
  { key: 'noite', label: 'Noite', primary: '#f2a33a', bg: '#0f2238', text: '#f3f5f8' },
];

export const RADIUS_OPTIONS = [['square', 'Reto'], ['soft', 'Suave'], ['pill', 'Redondo']];
export const WIDTH_OPTIONS = [['narrow', 'Estreita'], ['normal', 'Média'], ['wide', 'Ampla']];
export const ALIGN_OPTIONS = [['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']];

export const emptyLink = () => ({ kind: 'link', url: '', phone: '', message: '', email: '' });

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function uid() {
  let s = '';
  const buf = new Uint8Array(8);
  (globalThis.crypto || { getRandomValues: (b) => b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256))) }).getRandomValues(buf);
  for (const n of buf) s += ALPHABET[n % ALPHABET.length];
  return s;
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// ---------- Links dos botões ----------
// Telefone digitado como (85) 99999-9999 vira 5585999999999 (só números, com o 55 do Brasil).
export function phoneDigits(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}
export const phoneOk = (v) => { const d = phoneDigits(v); return (d.length === 12 || d.length === 13) && d.startsWith('55'); };
export const emailOk = (v) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(v || '').trim());

// Endereço que o botão abre. Vazio = o link ainda não está preenchido (o botão não aparece na página pública).
export function linkHref(l) {
  if (!l) return '';
  if (l.kind === 'whatsapp') return phoneOk(l.phone) ? `https://wa.me/${phoneDigits(l.phone)}${l.message ? `?text=${encodeURIComponent(l.message)}` : ''}` : '';
  if (l.kind === 'tel') return phoneOk(l.phone) ? `tel:+${phoneDigits(l.phone)}` : '';
  if (l.kind === 'email') return emailOk(l.email) ? `mailto:${String(l.email).trim()}` : '';
  let u = String(l.url || '').trim();
  if (!u || /\s/.test(u)) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = `https://${u}`;
  return /^https?:\/\//i.test(u) ? u : ''; // nunca javascript:, data: etc.
}

// ---------- Vídeo (só por link) ----------
// Mesma regra do servidor. Devolve { kind: 'youtube' | 'vimeo' | 'file', src } ou null.
export function parseVideo(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  const YT = /^[A-Za-z0-9_-]{11}$/;
  let id = '';
  if (host === 'youtu.be' && YT.test(seg[0] || '')) id = seg[0];
  else if (['youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    const v = u.searchParams.get('v') || (['embed', 'shorts', 'live', 'v'].includes(seg[0]) ? seg[1] : '');
    if (YT.test(v || '')) id = v;
  }
  if (id) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}` };
  if (host === 'vimeo.com' && /^\d{5,12}$/.test(seg[0] || '')) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${seg[0]}` };
  if (host === 'player.vimeo.com' && seg[0] === 'video' && /^\d{5,12}$/.test(seg[1] || '')) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${seg[1]}` };
  if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) return { kind: 'file', src: u.href };
  return null;
}

// ---------- Tema ----------
// Cor do texto que fica legível em cima de uma cor de fundo (botões, banner).
export function readableOn(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.6 ? '#14202e' : '#ffffff';
}

const RADIUS_PX = { square: '0px', soft: '10px', pill: '999px' };
const WIDTH_PX = { narrow: '640px', normal: '860px', wide: '1080px' };
export function themeVars(t) {
  const th = { ...DEFAULT_THEME, ...t };
  return {
    '--p': th.primary, '--on-p': readableOn(th.primary), '--bg': th.bg, '--tx': th.text,
    '--hf': fontCss(th.headingFont), '--bf': fontCss(th.bodyFont), '--br': RADIUS_PX[th.radius] || RADIUS_PX.soft, '--w': WIDTH_PX[th.width] || WIDTH_PX.normal,
  };
}

// Endereço público da página (o domínio vem de onde o usuário está acessando).
export const pageUrl = (path, customUrl) => customUrl || `${window.location.origin}${path}`;
