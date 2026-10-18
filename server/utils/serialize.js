import { defaultPayableDue, payableDues, toISODate } from './schedule.js';
import { lateDays } from './rating.js';

const ms = (d) => (d ? d.getTime() : null);

export const contactDTO = (c) => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  notes: c.notes,
  document: c.document,
  zip: c.zip,
  street: c.street,
  number: c.number,
  complement: c.complement,
  district: c.district,
  city: c.city,
  state: c.state,
  createdAt: ms(c.createdAt),
  ...(c._count ? { scheduleCount: c._count.schedules } : {}),
});

export const billingPaymentDTO = (p) => ({
  id: p.id,
  scheduleId: p.scheduleId,
  contactId: p.contactId,
  contactName: p.contactName,
  amountCents: p.amountCents,
  dueDate: toISODate(p.dueDate),
  paidAt: toISODate(p.paidAt),
  lateDays: lateDays(p.dueDate, p.paidAt),
});

// O que a tela precisa saber sobre os pagamentos de uma cobrança:
// os já marcados como pagos, quais vencimentos ainda dá para marcar e qual sugerir.
function paidInfo(s) {
  const rows = s.billingPayments ?? [];
  const paid = new Set(rows.map((p) => toISODate(p.dueDate)));
  const open = payableDues(s).filter((d) => !paid.has(toISODate(d)));
  const suggested = defaultPayableDue(open);
  return {
    payments: rows.map((p) => ({ id: p.id, dueDate: toISODate(p.dueDate), paidAt: toISODate(p.paidAt), lateDays: lateDays(p.dueDate, p.paidAt) })),
    payable: open.map(toISODate),
    payDefault: suggested ? toISODate(suggested) : null,
  };
}

export const scheduleDTO = (s) => ({
  id: s.id,
  kind: s.kind,
  recurrence: s.recurrence,
  status: s.status,
  amountCents: s.amountCents,
  text: s.text,
  extra: s.extra,
  dueDate: toISODate(s.dueDate),
  nextDueDate: s.nextDueDate ? toISODate(s.nextDueDate) : null,
  daysBefore: s.daysBefore,
  sendTime: s.sendTime,
  nextRunAt: ms(s.nextRunAt),
  lastRunAt: ms(s.lastRunAt),
  lastStatus: s.lastStatus,
  lastError: s.lastError,
  sentCount: s.sentCount,
  instanceId: s.instanceId,
  createdAt: ms(s.createdAt),
  contact: s.contact ? { id: s.contact.id, name: s.contact.name, phone: s.contact.phone } : null,
  ...(s.kind === 'cobranca' ? paidInfo(s) : {}),
});
