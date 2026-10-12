// Regras de calendário no navegador (espelham o servidor, que é quem decide o envio de fato).
import { addDaysISO, fmtRun, isoDay, isoToBR } from './format.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m0, d) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const daysIn = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export const KIND = {
  cobranca: {
    singular: 'cobrança', plural: 'cobranças', title: 'Cobranças', newLabel: 'Nova cobrança', route: '/cobrancas',
    template: 'Olá {nome}! Tudo bem? Passando para lembrar do pagamento de {valor} com vencimento em {vencimento}. Qualquer dúvida, é só responder esta mensagem.',
  },
  lembrete: {
    singular: 'lembrete', plural: 'lembretes', title: 'Lembretes', newLabel: 'Novo lembrete', route: '/lembretes',
    template: 'Olá {nome}! Lembrete: seu pagamento vence em {vencimento}. Se já pagou, pode desconsiderar esta mensagem.',
  },
};

// Vencimento de um agendamento dentro de um mês (ou null).
export function dueInMonthISO(s, y, m0) {
  const [ay, am, ad] = s.dueDate.split('-').map(Number);
  if (s.recurrence === 'avulsa') return ay === y && am - 1 === m0 ? s.dueDate : null;
  const k = (y - ay) * 12 + (m0 - (am - 1));
  return k < 0 ? null : iso(y, m0, Math.min(ad, daysIn(y, m0)));
}

// Primeira data de envio, no relógio do navegador (apenas para mostrar o resumo no formulário).
export function previewFirstRun({ recurrence, dueDate, daysBefore, sendTime }, now = new Date()) {
  const [ay, am, ad] = dueDate.split('-').map(Number);
  const [hh, mm] = sendTime.split(':').map(Number);
  const at = (k) => {
    const total = am - 1 + k;
    const y = ay + Math.floor(total / 12);
    const m0 = ((total % 12) + 12) % 12;
    const due = iso(y, m0, Math.min(ad, daysIn(y, m0)));
    const runDay = addDaysISO(due, -daysBefore);
    const [ry, rm, rd] = runDay.split('-').map(Number);
    return { due, runDay, time: sendTime, run: new Date(ry, rm - 1, rd, hh, mm), k };
  };
  if (recurrence === 'avulsa') {
    const r = at(0);
    return r.run > now ? r : null;
  }
  for (let k = 0; k < 600; k++) {
    const r = at(k);
    if (r.run > now) return r;
  }
  return null;
}

// Troca {nome}, {valor} e {vencimento} para mostrar a prévia (igual ao que o servidor faz no envio).
export function renderPreview(text, { name, amountCents, dueISO }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'Cliente';
  const money = ((amountCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return text.replace(/\{\s*(nome|valor|vencimento)\s*\}/gi, (_, k) => {
    const key = k.toLowerCase();
    return key === 'nome' ? first : key === 'valor' ? money : isoToBR(dueISO);
  });
}

export const dueText = (s) => (s.recurrence === 'mensal' ? `Vence todo dia ${isoDay(s.dueDate)}` : `Vence em ${isoToBR(s.dueDate)}`);
export const beforeText = (days) => (days === 0 ? 'no dia do vencimento' : days === 1 ? '1 dia antes' : `${days} dias antes`);

export function statusInfo(s) {
  if (s.status === 'pausada') return { label: 'Pausada', cls: 'pill-partial' };
  if (s.status === 'concluida') {
    return s.lastStatus === 'failed' ? { label: 'Não enviada', cls: 'pill-failed' } : { label: 'Enviada', cls: 'pill-done' };
  }
  return { label: 'Ativa', cls: 'pill-sent' };
}

export function nextText(s) {
  if (s.status === 'ativa' && s.nextRunAt) return `Próximo envio: ${fmtRun(s.nextRunAt)}`;
  if (s.status === 'pausada') return 'Envio pausado';
  if (s.lastRunAt) return s.lastStatus === 'failed' ? 'Não foi possível enviar' : `Enviada em ${fmtRun(s.lastRunAt)}`;
  return '';
}
