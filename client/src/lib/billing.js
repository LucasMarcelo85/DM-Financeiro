// Apoio da tela de faturamento e da avaliação de clientes (as notas em si são calculadas no servidor).
import { addDaysISO, isoToBR } from './format.js';

const pad = (n) => String(n).padStart(2, '0');
const daysWord = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

// Diferença em dias entre duas datas AAAA-MM-DD.
export function diffDays(fromISO, toISO) {
  const [ay, am, ad] = fromISO.split('-').map(Number);
  const [by, bm, bd] = toISO.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export const STAR_LEGEND = [
  { stars: 5, text: 'Paga em dia' },
  { stars: 4, text: 'Atrasa 1 dia' },
  { stars: 3, text: 'Atrasa 2 dias' },
  { stars: 2, text: 'Atrasa 3 dias' },
  { stars: 1, text: 'Atrasa 4 dias ou mais' },
];
export const starsText = (stars) => STAR_LEGEND.find((l) => l.stars === stars)?.text ?? '';

export const lateLabel = (days) => (days <= 0 ? 'Pago em dia' : `Pago com ${daysWord(days)} de atraso`);
export const lateShort = (days) => (days <= 0 ? 'Em dia' : `${daysWord(days)} de atraso`);
export const lateClass = (days) => (days <= 0 ? 'pill-sent' : days < 3 ? 'pill-partial' : 'pill-failed');

// "costuma pagar por volta do dia 12 · atrasa em média 1,5 dia"
export function clientHabit(c) {
  const avg = c.avgLateDays;
  const late = avg < 0.5 ? 'costuma pagar em dia' : `atrasa em média ${Number.isInteger(avg) ? avg : avg.toLocaleString('pt-BR')} ${avg === 1 ? 'dia' : 'dias'}`;
  return `costuma pagar por volta do dia ${c.usualDay} · ${late}`;
}

// Agrupa os pagamentos por dia (até 31 dias), por semana (até 100 dias) ou por mês, para o gráfico de barras.
export function bucketSeries(series, from, to) {
  const span = diffDays(from, to) + 1;
  const byDate = new Map(series.map((s) => [s.date, s.cents]));
  const dm = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}`;
  const buckets = [];

  if (span <= 31) {
    for (let i = 0; i < span; i++) {
      const d = addDaysISO(from, i);
      buckets.push({ key: d, label: dm(d), title: isoToBR(d), cents: byDate.get(d) || 0 });
    }
  } else if (span <= 100) {
    for (let i = 0; i < span; i += 7) {
      const last = Math.min(i + 6, span - 1);
      let cents = 0;
      for (let j = i; j <= last; j++) cents += byDate.get(addDaysISO(from, j)) || 0;
      const start = addDaysISO(from, i);
      buckets.push({ key: start, label: dm(start), title: `${isoToBR(start)} a ${isoToBR(addDaysISO(from, last))}`, cents });
    }
  } else {
    const sums = new Map();
    for (const s of series) sums.set(s.date.slice(0, 7), (sums.get(s.date.slice(0, 7)) || 0) + s.cents);
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      const key = `${y}-${pad(m)}`;
      buckets.push({ key, label: `${pad(m)}/${String(y).slice(2)}`, title: `${pad(m)}/${y}`, cents: sums.get(key) || 0 });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  return buckets;
}
