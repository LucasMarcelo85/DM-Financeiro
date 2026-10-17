import { formatStoredPhone } from './format.js';

// Texto sem acentos e em minúsculas, mantendo o MESMO tamanho (para achar a posição no texto original).
export function foldSameLength(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const f = s[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    out += f.length === 1 ? f : s[i];
  }
  return out;
}

// Divide o texto em pedaços, marcando os que contêm a palavra buscada (sem diferenciar acento/maiúscula).
export function highlightParts(text, q) {
  const needle = foldSameLength(String(q || '').trim());
  if (needle.length < 2 || !text) return [{ t: text, hit: false }];
  const hay = foldSameLength(text);
  const parts = [];
  let from = 0;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, from)) {
    if (at > from) parts.push({ t: text.slice(from, at), hit: false });
    parts.push({ t: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ t: text.slice(from), hit: false });
  return parts;
}

export const TYPE_LABEL = { image: 'Foto', video: 'Vídeo', audio: 'Áudio', document: 'Documento', sticker: 'Figurinha', location: 'Localização', contact: 'Contato' };

export const phoneLabel = (p) => (p ? (p.startsWith('55') && p.length >= 12 ? `+55 ${formatStoredPhone(p)}` : `+${p}`) : '');

export function chatTitle(c) {
  if (c.name) return c.name;
  if (c.isGroup) return `Grupo ${String(c.jid).slice(0, 4)}…${String(c.jid).split('@')[0].slice(-4)}`;
  return phoneLabel(c.phone) || String(c.jid).split('@')[0];
}

export const initials = (title) => {
  const w = String(title).replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export const clock = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// Hora na lista de conversas: hoje = 14:32, ontem = "Ontem", antes = 05/10.
export function listTime(ms) {
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(ms))) / 86400000);
  if (days <= 0) return clock(ms);
  if (days === 1) return 'Ontem';
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function dayLabel(ms) {
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(ms))) / 86400000);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}
export const sameDay = (a, b) => startOfDay(new Date(a)) === startOfDay(new Date(b));

export const LABEL_COLORS = ['#1f55a6', '#1fa971', '#e5484d', '#f2a33a', '#8e4ec6', '#0d9aa8', '#d6409f', '#6f7c8c'];
