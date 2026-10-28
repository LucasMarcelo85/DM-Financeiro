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

// "preço orçamento" -> ['preco', 'orcamento']; texto entre aspas é uma frase só. Igual à busca do servidor.
export function searchTerms(q) {
  const out = [];
  for (const m of foldSameLength(String(q || '')).matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = (m[1] ?? m[2]).trim();
    if (t) out.push(t.slice(0, 80));
  }
  return out.slice(0, 6);
}

// Divide o texto em pedaços, marcando os que contêm alguma das palavras buscadas (sem diferenciar acento/maiúscula).
export function highlightParts(text, q) {
  const needles = searchTerms(q).filter((t) => t.length >= 2);
  if (!needles.length || !text) return [{ t: text, hit: false }];
  const hay = foldSameLength(text);
  const mark = new Array(text.length).fill(false);
  for (const n of needles) for (let at = hay.indexOf(n); at !== -1; at = hay.indexOf(n, at + 1)) mark.fill(true, at, at + n.length);
  const parts = [];
  let from = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || mark[i] !== mark[from]) { parts.push({ t: text.slice(from, i), hit: mark[from] }); from = i; }
  }
  return parts;
}

// Coloca uma mensagem na posição certa (por horário e depois pelo número), mesmo que ela tenha chegado atrasada.
export function insertSorted(list, msg) {
  if (list.some((m) => m.id === msg.id)) return list;
  const after = (a, b) => a.ts > b.ts || (a.ts === b.ts && a.id > b.id);
  if (!list.length || after(msg, list[list.length - 1])) return [...list, msg];
  let i = list.length;
  while (i > 0 && after(list[i - 1], msg)) i -= 1;
  return [...list.slice(0, i), msg, ...list.slice(i)];
}

// "há 5 min", "há 3 h", "há 2 dias"
export function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return 'agora mesmo';
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

export const mediaUrl = (id, query = '') => {
  const scope = sessionStorage.getItem('dm:audit-scope');
  if (scope !== 'app') return `/api/audit/messages/${id}/media${query}`;
  const separator = query ? '&' : '?';
  return `/api/audit/messages/${id}/media${query}${separator}scope=app`;
};

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
