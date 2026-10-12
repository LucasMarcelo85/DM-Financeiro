export const digits = (v) => String(v ?? '').replace(/\D/g, '');

export function maskCPF(v) {
  const d = digits(v).slice(0, 11);
  if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;
  return d;
}

export function maskCNPJ(v) {
  const d = digits(v).slice(0, 14);
  if (d.length > 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length > 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  if (d.length > 5) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length > 2) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return d;
}

export const maskDoc = (v, kind) => (kind === 'PJ' ? maskCNPJ(v) : maskCPF(v));

// Documento salvo (só números) -> texto formatado. 'admin' passa direto.
export function formatDoc(v) {
  const d = digits(v);
  if (d.length === 11) return maskCPF(d);
  if (d.length === 14) return maskCNPJ(d);
  return String(v ?? '');
}

export function maskPhone(v) {
  const d = digits(v).slice(0, 11);
  if (d.length > 10) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length > 6) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length > 0) return `(${d}`;
  return '';
}

// Número salvo com 55 na frente -> (85) 99999-9999
export function formatStoredPhone(v) {
  const d = digits(v);
  return maskPhone(d.startsWith('55') && d.length > 11 ? d.slice(2) : d);
}

export const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dateBR = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR') : '-');
export const dateTimeBR = (ms) =>
  new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
export const planLabel = (p) => (p === 'admin' ? 'Admin' : p ? p.charAt(0).toUpperCase() + p.slice(1) : '');
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Dinheiro ----------
// Máscara "1.234,56" a partir dos dígitos digitados (preenche pelos centavos).
export function maskMoney(v) {
  const d = digits(v).slice(0, 10);
  if (!d) return '';
  return (Number(d) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
export const moneyToCents = (masked) => Number(digits(masked)) || 0;
export const centsToMasked = (cents) => maskMoney(String(cents ?? 0));

// ---------- Datas e horários ----------
let TZ; // fuso do sistema (vem do servidor); sem valor, usa o do navegador
export const setTimezone = (tz) => { TZ = tz; };
const pad = (n) => String(n).padStart(2, '0');

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const isoToBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
export const isoDay = (iso) => Number(iso.split('-')[2]);

export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// 08/11 às 09:00 (no fuso do sistema)
export function fmtRun(ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  );
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}
export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
