// Modelo do documento do editor de portfólio (código puro, sem React).
//
// Documento: { v: 1, theme, seo: { title, description }, blocks: [bloco] }
// Bloco: { id, t, ...campos }  ·  Tipos: banner, logo, heading, text, image, gallery, video, button, divider, spacer
// Blocos empilhados na vertical (a página se adapta ao celular), ao contrário do contrato, que é uma folha A4.
//
// O servidor valida o mesmo formato em server/utils/portfolio.js (manter padrões, opções e vídeo em sincronia).

import { fontCss } from '../contract/model.js';

export { FONTS, FONT_GROUPS } from '../contract/model.js';
export const MAX_BLOCKS = 80;
export const MAX_GALLERY = 12;

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

export const BLOCK_LABELS = {
  banner: 'Banner', logo: 'Logo', heading: 'Título', text: 'Texto', image: 'Imagem', gallery: 'Galeria',
  video: 'Vídeo', button: 'Botão', divider: 'Divisor', spacer: 'Espaço',
};

export const emptyLink = () => ({ kind: 'link', url: '', phone: '', message: '', email: '' });

const DEFAULTS = {
  banner: () => ({
    image: '', bgColor: '', overlay: 0.35, overlayColor: '#000000', title: 'Seu título aqui', subtitle: 'Uma frase curta sobre o que você faz.',
    align: 'center', height: 'md', textColor: '#ffffff', showButton: true, buttonLabel: 'Fale conosco', link: { ...emptyLink(), kind: 'whatsapp' },
  }),
  logo: () => ({ src: '', size: 72, align: 'center' }),
  heading: () => ({ text: 'Título da seção', size: 'lg', align: 'left', color: '' }),
  text: () => ({ text: 'Escreva aqui o seu texto. Conte quem você é, o que oferece e por que as pessoas devem confiar em você.', size: 'md', align: 'left', color: '' }),
  image: () => ({ src: '', alt: '', caption: '', width: 'md', radius: 'soft', align: 'center' }),
  gallery: () => ({ items: [], cols: 3, radius: 'soft' }),
  video: () => ({ url: '', caption: '', width: 'lg' }),
  button: () => ({ label: 'Falar no WhatsApp', link: { ...emptyLink(), kind: 'whatsapp' }, style: 'solid', size: 'md', align: 'center', full: false, color: '' }),
  divider: () => ({ style: 'solid', color: '' }),
  spacer: () => ({ height: 32 }),
};
export const BLOCK_TYPES = Object.keys(DEFAULTS);

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function uid() {
  let s = '';
  const buf = new Uint8Array(8);
  (globalThis.crypto || { getRandomValues: (b) => b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256))) }).getRandomValues(buf);
  for (const n of buf) s += ALPHABET[n % ALPHABET.length];
  return s;
}

export function newBlock(t, over = {}) {
  if (!DEFAULTS[t]) throw new Error(`Tipo de bloco desconhecido: ${t}`);
  return { id: uid(), t, ...DEFAULTS[t](), ...over };
}

export const blankDoc = () => ({ v: 1, theme: { ...DEFAULT_THEME }, seo: { title: '', description: '' }, blocks: [] });

// Completa o que veio do banco com os padrões (a tela nunca quebra por um campo que falta).
export function normalizeDoc(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const blocks = (Array.isArray(src.blocks) ? src.blocks : []).slice(0, MAX_BLOCKS).flatMap((b) => {
    if (!b || typeof b !== 'object' || !DEFAULTS[b.t]) return [];
    const d = DEFAULTS[b.t]();
    const out = { ...d, ...b, id: typeof b.id === 'string' && b.id ? b.id : uid() };
    if (d.link) out.link = { ...emptyLink(), ...(b.link && typeof b.link === 'object' ? b.link : {}) };
    if (b.t === 'gallery') out.items = (Array.isArray(b.items) ? b.items : []).filter((it) => it && typeof it.src === 'string').map((it) => ({ id: it.id || uid(), src: it.src, alt: it.alt || '' }));
    return [out];
  });
  return {
    v: 1,
    theme: { ...DEFAULT_THEME, ...(src.theme && typeof src.theme === 'object' ? src.theme : {}) },
    seo: { title: '', description: '', ...(src.seo && typeof src.seo === 'object' ? src.seo : {}) },
    blocks,
  };
}

// ---------- Operações imutáveis ----------
export const patchBlock = (doc, id, patch) => ({ ...doc, blocks: doc.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
export const patchTheme = (doc, patch) => ({ ...doc, theme: { ...doc.theme, ...patch } });
export const patchSeo = (doc, patch) => ({ ...doc, seo: { ...doc.seo, ...patch } });
export const findBlock = (doc, id) => doc.blocks.find((b) => b.id === id) || null;
export const removeBlock = (doc, id) => ({ ...doc, blocks: doc.blocks.filter((b) => b.id !== id) });

export function insertBlock(doc, block, afterId = null) {
  const i = afterId ? doc.blocks.findIndex((b) => b.id === afterId) : -1;
  const blocks = [...doc.blocks];
  blocks.splice(i < 0 ? blocks.length : i + 1, 0, block);
  return { ...doc, blocks };
}

export function moveBlock(doc, from, to) {
  if (from === to || from < 0 || to < 0 || from >= doc.blocks.length || to >= doc.blocks.length) return doc;
  const blocks = [...doc.blocks];
  const [b] = blocks.splice(from, 1);
  blocks.splice(to, 0, b);
  return { ...doc, blocks };
}

export function cloneBlock(b) {
  const copy = JSON.parse(JSON.stringify(b));
  copy.id = uid();
  if (copy.items) copy.items = copy.items.map((it) => ({ ...it, id: uid() }));
  return copy;
}
export function duplicateBlock(doc, id) {
  const i = doc.blocks.findIndex((b) => b.id === id);
  if (i < 0) return { doc, block: null };
  const block = cloneBlock(doc.blocks[i]);
  const blocks = [...doc.blocks];
  blocks.splice(i + 1, 0, block);
  return { doc: { ...doc, blocks }, block };
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
export const pageUrl = (path) => `${window.location.origin}${path}`;
