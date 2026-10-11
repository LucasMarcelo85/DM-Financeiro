export class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const DAY = 24 * 60 * 60 * 1000;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');

export function isValidCPF(value) {
  const c = onlyDigits(value);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const check = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(c[9]) && check(10) === Number(c[10]);
}

export function isValidCNPJ(value) {
  const c = onlyDigits(value);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const check = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * w[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(c[12]) && check(13) === Number(c[13]);
}

// Aceita DDD + número (10 ou 11 dígitos) ou já com 55. Retorna null se inválido.
export function normalizePhone(value) {
  let d = onlyDigits(value);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}
