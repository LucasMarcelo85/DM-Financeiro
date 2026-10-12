import { toISODate } from './schedule.js';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatBRL = (cents) => brl.format((cents ?? 0) / 100);
export const formatDateBR = (d) => toISODate(d).split('-').reverse().join('/');

// Troca {nome}, {valor} e {vencimento} pelos dados reais da cobrança.
export function renderTemplate(text, { name, amountCents, dueDate }) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return text.replace(/\{\s*(nome|valor|vencimento)\s*\}/gi, (_, key) => {
    switch (key.toLowerCase()) {
      case 'nome': return first;
      case 'valor': return amountCents == null ? '' : formatBRL(amountCents);
      default: return dueDate ? formatDateBR(dueDate) : '';
    }
  });
}
