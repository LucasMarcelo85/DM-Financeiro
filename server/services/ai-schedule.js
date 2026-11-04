// Horário de funcionamento do agente, sempre no fuso de Brasília.
const ZONE = 'America/Sao_Paulo';
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function localNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { day: WEEKDAYS[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute), stamp: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` };
}

// Valida o que veio do formulário. Retorna {} (sempre ligado) ou a configuração completa.
export function normalizeSchedule(input) {
  if (!input || typeof input !== 'object' || !input.enabled) return {};
  const days = [...new Set((Array.isArray(input.days) ? input.days : []).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  const start = String(input.start || '');
  const end = String(input.end || '');
  const from = String(input.from || '');
  const until = String(input.until || '');
  if (!days.length) return { error: 'Escolha ao menos um dia da semana para o horário de funcionamento.' };
  if (!TIME.test(start) || !TIME.test(end) || start === end) return { error: 'Informe um horário inicial e final diferentes (HH:MM).' };
  if ((from && !DATETIME.test(from)) || (until && !DATETIME.test(until))) return { error: 'Data e hora do período inválidas.' };
  if (from && until && until <= from) return { error: 'O fim do período deve ser depois do início.' };
  return { enabled: true, days, start, end, from, until };
}

export function isWithinSchedule(schedule, date = new Date()) {
  if (!schedule?.enabled) return true;
  const now = localNow(date);
  if (schedule.from && now.stamp < schedule.from) return false;
  if (schedule.until && now.stamp >= schedule.until) return false;
  const start = toMinutes(schedule.start);
  const end = toMinutes(schedule.end);
  const days = schedule.days || [];
  if (start < end) return days.includes(now.day) && now.minutes >= start && now.minutes < end;
  // Janela que atravessa a meia-noite: a parte da madrugada pertence ao dia anterior.
  return (days.includes(now.day) && now.minutes >= start) || (days.includes((now.day + 6) % 7) && now.minutes < end);
}
