import { config } from './config.js';

// Limites de cada plano.
//  instances: WhatsApps para cobranças e lembretes · auditInstances: números conectados na auditoria
//  contracts: modelos de contrato · auditSend: pode responder conversas dentro da auditoria
//  portfolios: páginas de portfólio (páginas públicas personalizáveis)
const LIMITS = {
  bronze: { instances: 1, auditInstances: 1, contracts: 2, portfolios: 1, auditSend: false },
  prata: { instances: 1, auditInstances: 3, contracts: 7, portfolios: 2, auditSend: false },
  ouro: { instances: 3, auditInstances: 5, contracts: 20, portfolios: 7, auditSend: true },
};
LIMITS.admin = LIMITS.ouro;

export const PLAN_IDS = ['bronze', 'prata', 'ouro'];
export const isPlan = (p) => PLAN_IDS.includes(p);

// Períodos de cobrança. `charged` = quantas mensalidades são cobradas; `months` = meses de acesso.
// Semestral: 6 meses pagando 5. Anual: 12 meses pagando 9. (`days: null` usa ACCESS_DAYS, 30 por padrão.)
export const PERIODS = {
  mensal: { id: 'mensal', label: 'Mensal', months: 1, charged: 1, days: null },
  semestral: { id: 'semestral', label: 'Semestral', months: 6, charged: 5, days: 183 },
  anual: { id: 'anual', label: 'Anual', months: 12, charged: 9, days: 365 },
};
export const PERIOD_IDS = Object.keys(PERIODS);
export const isPeriod = (p) => Object.hasOwn(PERIODS, p);
export const periodDays = (period) => PERIODS[period]?.days ?? config.accessDays;

export const planName = (id) => id.charAt(0).toUpperCase() + id.slice(1);
const monthlyCents = (id) => Math.round(config.prices[id] * 100);
export const priceCents = (id, period = 'mensal') => monthlyCents(id) * (PERIODS[period] || PERIODS.mensal).charged;

export function limitsFor(user) {
  return user.role === 'admin' ? LIMITS.admin : LIMITS[user.plan] || LIMITS.bronze;
}

export const listPeriods = () => PERIOD_IDS.map((id) => ({ id, label: PERIODS[id].label, months: PERIODS[id].months, days: periodDays(id) }));

export function listPlans() {
  return PLAN_IDS.map((id) => ({
    id,
    name: planName(id),
    priceCents: priceCents(id), // mensal (mantido por compatibilidade)
    prices: Object.fromEntries(PERIOD_IDS.map((p) => [p, priceCents(id, p)])),
    ...LIMITS[id],
  }));
}
