import { toISODate } from './schedule.js';

const ms = (d) => (d ? d.getTime() : null);

export const contactDTO = (c) => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  notes: c.notes,
  createdAt: ms(c.createdAt),
  ...(c._count ? { scheduleCount: c._count.schedules } : {}),
});

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
});
