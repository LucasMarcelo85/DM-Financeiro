import { AppError } from './helpers.js';

export function dateRange(query, field = 'createdAt') {
  const from = String(query.from || '');
  const to = String(query.to || '');
  if (!from && !to) return {};
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(from) || !validDate(to) || from > to) {
    throw new AppError(400, 'Informe um período válido, com as duas datas no formato AAAA-MM-DD.');
  }
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { [field]: { gte: new Date(`${from}T00:00:00.000Z`), lt: end } };
}

export function importedDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError(400, `A data de ${label} é inválida.`);
  return date;
}
