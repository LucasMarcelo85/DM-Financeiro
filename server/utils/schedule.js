import { config } from '../config.js';

// Datas "só dia" (vencimentos) são guardadas como Date em 00:00 UTC e lidas com getUTC*.
const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 24 * 60 * 60 * 1000;

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const toISODate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);

export function parseISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 2020 || y > 2100) return null;
  return dt;
}

const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export function monthIndexDiff(a, b) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

// Vencimento do mês k (0 = mês do primeiro vencimento). Dia 31 vira o último dia em meses curtos.
export function dueForMonthOffset(anchor, k) {
  const total = anchor.getUTCMonth() + k;
  const y = anchor.getUTCFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return new Date(Date.UTC(y, m, Math.min(anchor.getUTCDate(), daysInMonth(y, m))));
}

// ---- Fuso horário ----
function tzOffsetMs(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

// Data local (00:00 UTC representando o dia) + "HH:mm" no fuso do sistema -> instante real (UTC).
export function zonedToUtc(dateOnly, hhmm, tz = config.timezone) {
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(dateOnly.getUTCFullYear(), dateOnly.getUTCMonth(), dateOnly.getUTCDate(), h, mi);
  let utc = guess - tzOffsetMs(new Date(guess), tz);
  const off2 = tzOffsetMs(new Date(utc), tz);
  utc = guess - off2;
  return new Date(utc);
}

// Hoje (data local do sistema) como Date em 00:00 UTC.
export function localToday(now = new Date(), tz = config.timezone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now).map((x) => [x.type, x.value])
  );
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
}

export const runAtFor = (due, daysBefore, hhmm) => zonedToUtc(addDays(due, -daysBefore), hhmm);

function nextRunAfter(now, sendTime) {
  const today = localToday(now);
  const todayRun = zonedToUtc(today, sendTime);
  return todayRun > now ? todayRun : zonedToUtc(addDays(today, 1), sendTime);
}

// Primeira ocorrência que ainda vai acontecer (a partir de "agora").
export function firstOccurrence(schedule, now = new Date()) {
  const { recurrence, dueDate, daysBefore, sendTime } = schedule;
  if (recurrence === 'avulsa') {
    const runAt = runAtFor(dueDate, daysBefore, sendTime);
    if (runAt > now) return { nextDueDate: dueDate, nextRunAt: runAt };
    if (!schedule.untilPaid) return null;
    const dueRun = zonedToUtc(dueDate, sendTime);
    return { nextDueDate: dueDate, nextRunAt: dueRun > now ? dueRun : nextRunAfter(now, sendTime) };
  }
  if (recurrence === 'semanal') {
    const weekDays = schedule.weekDays || [];
    const start = localToday(now) > dueDate ? localToday(now) : dueDate;
    for (let offset = 0; offset < 400; offset += 1) {
      const runDay = addDays(start, offset);
      if (!weekDays.includes(runDay.getUTCDay())) continue;
      const nextRunAt = zonedToUtc(runDay, sendTime);
      if (nextRunAt > now) return { nextDueDate: dueDate, nextRunAt };
    }
    return null;
  }
  const firstMonth = Math.max(0, monthIndexDiff(dueDate, schedule.nextDueDate ?? dueDate));
  for (let k = firstMonth; k < firstMonth + 600; k++) {
    const due = dueForMonthOffset(dueDate, k);
    const runAt = runAtFor(due, daysBefore, sendTime);
    if (runAt > now) return { nextDueDate: due, nextRunAt: runAt };
    if (schedule.untilPaid) {
      const dueRun = zonedToUtc(due, sendTime);
      return { nextDueDate: due, nextRunAt: dueRun > now ? dueRun : nextRunAfter(now, sendTime) };
    }
  }
  return null;
}

// Próxima ocorrência mensal depois da que acabou de ser tratada.
export function occurrenceAfter(schedule, now = new Date()) {
  if (schedule.recurrence === 'semanal') {
    const start = localToday(now);
    for (let offset = 0; offset < 8; offset += 1) {
      const runDay = addDays(start, offset);
      if (runDay < schedule.dueDate || !(schedule.weekDays || []).includes(runDay.getUTCDay())) continue;
      const nextRunAt = zonedToUtc(runDay, schedule.sendTime);
      if (nextRunAt > now) return { nextDueDate: schedule.dueDate, nextRunAt };
    }
    return null;
  }
  if (schedule.untilPaid) {
    const due = schedule.nextDueDate ?? schedule.dueDate;
    const dueRun = zonedToUtc(due, schedule.sendTime);
    return { nextDueDate: due, nextRunAt: dueRun > now ? dueRun : nextRunAfter(now, schedule.sendTime) };
  }
  return nextMonthlyOccurrence(schedule, now);
}

// Avança o ciclo mensal quando o vencimento atual foi pago.
export function occurrenceAfterPaid(schedule, now = new Date()) {
  if (schedule.recurrence !== 'mensal') return null;
  return nextMonthlyOccurrence(schedule, now);
}

function nextMonthlyOccurrence(schedule, now) {
  const base = monthIndexDiff(schedule.dueDate, schedule.nextDueDate ?? schedule.dueDate);
  for (let k = base + 1; k < base + 600; k++) {
    const due = dueForMonthOffset(schedule.dueDate, k);
    const runAt = runAtFor(due, schedule.daysBefore, schedule.sendTime);
    if (runAt > now) return { nextDueDate: due, nextRunAt: runAt };
    if (schedule.untilPaid) {
      const dueRun = zonedToUtc(due, schedule.sendTime);
      if (dueRun > now) return { nextDueDate: due, nextRunAt: dueRun };
    }
  }
  return null;
}

// Vencimentos de uma cobrança que dá para marcar como pagos: o da avulsa, ou os mensais de
// 5 meses atrás até o mês que vem (pagamento adiantado).
export function payableDues(schedule, today = localToday()) {
  if (schedule.recurrence === 'avulsa') return [schedule.dueDate];
  if (schedule.recurrence === 'semanal') return [schedule.dueDate];
  const kNow = monthIndexDiff(schedule.dueDate, today);
  const out = [];
  for (let k = Math.max(0, kNow - 5); k <= Math.max(0, kNow + 1); k++) out.push(dueForMonthOffset(schedule.dueDate, k));
  if (schedule.untilPaid) out.push(schedule.nextDueDate ?? schedule.dueDate);
  return [...new Map(out.map((date) => [toISODate(date), date])).values()].sort((a, b) => a - b);
}

// Qual vencimento sugerir: o mais antigo que já venceu e segue sem pagamento; se nenhum, o mais próximo.
export function defaultPayableDue(openDues, today = localToday()) {
  return openDues.find((d) => d <= today) ?? openDues[0] ?? null;
}

// Vencimento do agendamento dentro de um mês (ou null). month0 = 0..11.
export function dueInMonth(schedule, year, month0) {
  if (schedule.recurrence === 'avulsa') {
    const d = schedule.dueDate;
    return d.getUTCFullYear() === year && d.getUTCMonth() === month0 ? d : null;
  }
  if (schedule.recurrence === 'semanal') {
    const start = new Date(Date.UTC(year, month0, 1));
    const end = new Date(Date.UTC(year, month0 + 1, 0));
    const weekDays = schedule.weekDays || [];
    for (let day = Math.max(start.getUTCDate(), schedule.dueDate.getUTCMonth() === month0 && schedule.dueDate.getUTCFullYear() === year ? schedule.dueDate.getUTCDate() : 1); day <= end.getUTCDate(); day += 1) {
      const date = new Date(Date.UTC(year, month0, day));
      if (weekDays.includes(date.getUTCDay())) return date;
    }
    return null;
  }
  const k = (year - schedule.dueDate.getUTCFullYear()) * 12 + (month0 - schedule.dueDate.getUTCMonth());
  return k >= 0 ? dueForMonthOffset(schedule.dueDate, k) : null;
}
