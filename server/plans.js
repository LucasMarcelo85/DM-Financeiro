import { config } from './config.js';
import { prisma } from './prisma.js';

// Limites de cada plano (valores PADRÃO, usados só para criar os planos no banco na primeira execução).
//  instances: WhatsApps para cobranças e lembretes · auditInstances: números conectados na auditoria
//  contracts: modelos de contrato · auditSend: pode responder conversas dentro da auditoria
//  portfolios: páginas de portfólio (páginas públicas personalizáveis)
// Depois da primeira execução, quem manda é o banco (tabela plan_settings): o administrador edita pela tela "Planos".
const DEFAULT_LIMITS = {
  bronze: { instances: 1, auditInstances: 1, contracts: 2, portfolios: 1, auditSend: false },
  prata: { instances: 1, auditInstances: 3, contracts: 7, portfolios: 2, auditSend: false },
  ouro: { instances: 3, auditInstances: 5, contracts: 20, portfolios: 7, auditSend: true },
};

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

// ---------- Planos no banco (com cópia em memória, para as consultas rápidas do dia a dia) ----------
const defaultPriceCents = (id) => Math.round(config.prices[id] * 100);
const defaults = (id) => ({ priceCents: defaultPriceCents(id), ...DEFAULT_LIMITS[id] });
const fromRow = (r) => ({ priceCents: r.priceCents, instances: r.instances, auditInstances: r.auditInstances, contracts: r.contracts, portfolios: r.portfolios, auditSend: r.auditSend });

let cache = Object.fromEntries(PLAN_IDS.map((id) => [id, defaults(id)]));
const setting = (id) => cache[id] || cache.bronze;

// Lê os planos do banco para a memória.
export async function loadPlans() {
  const rows = await prisma.planSetting.findMany();
  const next = Object.fromEntries(PLAN_IDS.map((id) => [id, defaults(id)]));
  for (const r of rows) if (isPlan(r.plan)) next[r.plan] = fromRow(r);
  cache = next;
  return cache;
}

// Primeira execução: cria os 3 planos no banco com os valores padrão (não mexe nos que já existem).
export async function ensurePlans() {
  await prisma.planSetting.createMany({ data: PLAN_IDS.map((id) => ({ plan: id, ...defaults(id) })), skipDuplicates: true });
  return loadPlans();
}

// Grava a alteração feita pelo administrador e já atualiza a memória.
export async function savePlan(id, data) {
  const row = await prisma.planSetting.upsert({ where: { plan: id }, create: { plan: id, ...defaults(id), ...data }, update: data });
  cache = { ...cache, [id]: fromRow(row) };
  return cache[id];
}

export const planName = (id) => id.charAt(0).toUpperCase() + id.slice(1);
const monthlyCents = (id) => setting(id).priceCents;
export const priceCents = (id, period = 'mensal') => monthlyCents(id) * (PERIODS[period] || PERIODS.mensal).charged;

const limitsOf = (id) => {
  const { instances, auditInstances, contracts, portfolios, auditSend } = setting(id);
  return { instances, auditInstances, contracts, portfolios, auditSend };
};

// O administrador tem os mesmos limites do plano Ouro.
export function limitsFor(user) {
  return user.role === 'admin' ? limitsOf('ouro') : limitsOf(isPlan(user.plan) ? user.plan : 'bronze');
}

export const listPeriods = () => PERIOD_IDS.map((id) => ({ id, label: PERIODS[id].label, months: PERIODS[id].months, days: periodDays(id) }));

export function listPlans() {
  return PLAN_IDS.map((id) => ({
    id,
    name: planName(id),
    priceCents: priceCents(id), // mensal (mantido por compatibilidade)
    prices: Object.fromEntries(PERIOD_IDS.map((p) => [p, priceCents(id, p)])),
    ...limitsOf(id),
  }));
}
