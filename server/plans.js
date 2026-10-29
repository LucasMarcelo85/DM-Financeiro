import { config } from './config.js';
import { prisma } from './prisma.js';
import { extrasFor } from './addons.js';

// Planos: ficam no banco (tabela plan_settings) e o administrador cria, edita e exclui pela tela "Gerir planos".
// Os valores abaixo só servem para criar os 3 planos iniciais quando a tabela está vazia (primeira execução).
//  instances: WhatsApps para cobranças e lembretes · auditInstances: números conectados na auditoria
//  contracts: modelos de contrato · auditSend: pode responder conversas dentro da auditoria
//  portfolios: páginas de portfólio · catalogProducts: produtos/serviços cadastráveis (0 = sem catálogo digital)
const DEFAULT_PLANS = [
  { id: 'bronze', name: 'Bronze', color: '#a8672f', sortOrder: 1, instances: 1, auditInstances: 1, contracts: 2, portfolios: 1, catalogProducts: 0, appUsers: 10, auditSend: false },
  { id: 'prata', name: 'Prata', color: '#6f7c8c', sortOrder: 2, instances: 1, auditInstances: 3, contracts: 7, portfolios: 2, catalogProducts: 40, appUsers: 10, auditSend: false },
  { id: 'ouro', name: 'Ouro', color: '#b98a0f', sortOrder: 3, instances: 3, auditInstances: 5, contracts: 20, portfolios: 7, catalogProducts: 120, appUsers: 10, auditSend: true },
];
// Abas do menu que o administrador pode liberar, esconder e ordenar em cada plano.
export const PLAN_TABS = ['inicio', 'whatsapp', 'clientes', 'cobrancas', 'lembretes', 'contratos', 'auditoria', 'portfolio', 'produtos', 'pedidos', 'api'];
const cleanTabs = (list) => (Array.isArray(list)
  ? [...new Set(list.filter((tab) => PLAN_TABS.includes(tab)))]
  : [...PLAN_TABS]);
const DEFAULT_TRIAL = { days: config.trialDays, instances: 1, auditInstances: 1, contracts: 2, portfolios: 1, catalogProducts: 0, auditSend: false, tabs: [...PLAN_TABS] };
const seedPrice = (id) => Math.round((config.prices[id] ?? 49.9) * 100);

export const PLAN_ID_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
export const RESERVED_PLAN_IDS = new Set(['admin']);

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

// ---------- Planos em memória (cópia do banco, para as consultas rápidas do dia a dia) ----------
const normalize = (p) => ({
  id: p.id ?? p.plan,
  name: p.name || (p.id ?? p.plan).charAt(0).toUpperCase() + (p.id ?? p.plan).slice(1),
  color: p.color || '',
  sortOrder: p.sortOrder ?? 0,
  priceCents: p.priceCents ?? seedPrice(p.id ?? p.plan),
  instances: p.instances, auditInstances: p.auditInstances, contracts: p.contracts, portfolios: p.portfolios,
  catalogProducts: p.catalogProducts ?? 0,
  stores: p.stores ?? 0,
  appUsers: p.appUsers ?? 10,
  dmCredit: p.dmCredit ?? true,
  auditSend: Boolean(p.auditSend),
  tabs: cleanTabs(p.visibleTabs ?? p.tabs),
});
const sorted = (map) => [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

let cache = new Map(DEFAULT_PLANS.map((p) => [p.id, normalize({ ...p, priceCents: seedPrice(p.id) })]));
let trialCache = { ...DEFAULT_TRIAL };

const normalizeTrial = (t) => ({
  days: Number.isInteger(t?.days) && t.days > 0 ? t.days : DEFAULT_TRIAL.days,
  instances: t?.instances ?? DEFAULT_TRIAL.instances,
  auditInstances: t?.auditInstances ?? DEFAULT_TRIAL.auditInstances,
  contracts: t?.contracts ?? DEFAULT_TRIAL.contracts,
  portfolios: t?.portfolios ?? DEFAULT_TRIAL.portfolios,
  catalogProducts: t?.catalogProducts ?? DEFAULT_TRIAL.catalogProducts,
  auditSend: Boolean(t?.auditSend),
  tabs: cleanTabs(t?.visibleTabs ?? t?.tabs),
});

export async function loadPlans() {
  const [rows, trial] = await Promise.all([
    prisma.planSetting.findMany(),
    prisma.trialSetting.findFirst(),
  ]);
  if (rows.length) cache = new Map(rows.map((r) => [r.plan, normalize(r)]));
  if (trial) trialCache = normalizeTrial(trial);
  return sorted(cache);
}

// Primeira execução (tabela vazia): cria os 3 planos iniciais. Depois disso o administrador manda; um plano excluído não volta.
export async function ensurePlans() {
  if ((await prisma.planSetting.count()) === 0) {
    await prisma.planSetting.createMany({
      data: DEFAULT_PLANS.map((p) => ({ plan: p.id, name: p.name, color: p.color, sortOrder: p.sortOrder, priceCents: seedPrice(p.id), instances: p.instances, auditInstances: p.auditInstances, contracts: p.contracts, portfolios: p.portfolios, catalogProducts: p.catalogProducts, appUsers: p.appUsers, auditSend: p.auditSend, visibleTabs: [...PLAN_TABS] })),
      skipDuplicates: true,
    });
  }
  if ((await prisma.trialSetting.count()) === 0) {
    await prisma.trialSetting.create({
      data: {
        days: DEFAULT_TRIAL.days,
        instances: DEFAULT_TRIAL.instances,
        auditInstances: DEFAULT_TRIAL.auditInstances,
        contracts: DEFAULT_TRIAL.contracts,
        portfolios: DEFAULT_TRIAL.portfolios,
        catalogProducts: DEFAULT_TRIAL.catalogProducts,
        auditSend: DEFAULT_TRIAL.auditSend,
        visibleTabs: [...DEFAULT_TRIAL.tabs],
      },
    });
  }
  return loadPlans();
}

const toRow = (d) => ({ name: d.name, color: d.color, sortOrder: d.sortOrder, priceCents: d.priceCents, instances: d.instances, auditInstances: d.auditInstances, contracts: d.contracts, portfolios: d.portfolios, catalogProducts: d.catalogProducts, stores: d.stores ?? 0, appUsers: d.appUsers ?? 10, dmCredit: d.dmCredit ?? true, auditSend: d.auditSend, visibleTabs: cleanTabs(d.tabs) });

// Grava (cria ou altera) um plano e já atualiza a memória.
export async function savePlan(id, data) {
  const row = await prisma.planSetting.upsert({ where: { plan: id }, create: { plan: id, ...toRow(data) }, update: toRow(data) });
  cache = new Map(cache).set(id, normalize(row));
  return cache.get(id);
}

// Exclui um plano. Quem estava nele vai para `moveTo`. Não deixa excluir o último plano.
export async function deletePlan(id, moveTo) {
  await prisma.$transaction(async (tx) => {
    if (moveTo) await tx.user.updateMany({ where: { plan: id }, data: { plan: moveTo } });
    await tx.planSetting.delete({ where: { plan: id } });
  });
  const next = new Map(cache);
  next.delete(id);
  cache = next;
}

export const isPlan = (p) => typeof p === 'string' && cache.has(p);
export const planIds = () => sorted(cache).map((p) => p.id);
export const defaultPlanId = () => sorted(cache)[0]?.id || 'bronze'; // plano de quem se cadastra sem escolher
export const topPlanId = () => sorted(cache).at(-1)?.id || 'ouro'; // o administrador tem os limites do maior plano
export const planName = (id) => cache.get(id)?.name || (id ? id.charAt(0).toUpperCase() + id.slice(1) : '');
export const planShowsCredit = (id) => cache.get(id)?.dmCredit ?? true;
export const planColor = (id) => cache.get(id)?.color || '';

const monthlyCents = (id) => cache.get(id)?.priceCents ?? 0;
export const priceCents = (id, period = 'mensal') => monthlyCents(id) * (PERIODS[period] || PERIODS.mensal).charged;

const limitsOf = (id) => {
  const p = cache.get(id) || sorted(cache)[0];
  return { instances: p.instances, auditInstances: p.auditInstances, contracts: p.contracts, portfolios: p.portfolios, catalogProducts: p.catalogProducts, stores: p.stores, appUsers: p.appUsers, auditSend: p.auditSend, tabs: p.tabs };
};

export function isTrialUser(user) {
  if (!user || user.role === 'admin') return false;
  const now = Date.now();
  const paidUntil = user.accessUntil ? new Date(user.accessUntil).getTime() : 0;
  const trialUntil = user.trialEndsAt ? new Date(user.trialEndsAt).getTime() : 0;
  return paidUntil <= now && trialUntil > now;
}

export function limitsFor(user) {
  if (user.role === 'admin') {
    const unlimited = Number.MAX_SAFE_INTEGER;
    return {
      ...limitsOf(topPlanId()),
      instances: unlimited,
      auditInstances: unlimited,
      contracts: unlimited,
      portfolios: unlimited,
      catalogProducts: unlimited,
      stores: unlimited,
      tabs: [...PLAN_TABS],
    };
  }
  const base = limitsOf(user.plan); // o teste grátis tem todo o acesso do plano escolhido
  const extras = extrasFor(user.id);
  // Limite do plano + o que o usuário pagou à parte (só enquanto estiver em dia).
  return {
    ...base,
    instances: base.instances + extras.instances,
    auditInstances: base.auditInstances + extras.auditInstances,
    contracts: base.contracts + extras.contracts,
    portfolios: base.portfolios + extras.portfolios,
    catalogProducts: base.catalogProducts + extras.catalogProducts,
    stores: base.stores + extras.stores,
    extras,
  };
}

export function trialSettings() {
  return { ...trialCache };
}

export async function saveTrial(data) {
  const row = await prisma.trialSetting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      days: data.days,
      instances: data.instances,
      auditInstances: data.auditInstances,
      contracts: data.contracts,
      portfolios: data.portfolios,
      catalogProducts: data.catalogProducts,
      auditSend: data.auditSend,
      visibleTabs: cleanTabs(data.tabs),
    },
    update: {
      days: data.days,
      instances: data.instances,
      auditInstances: data.auditInstances,
      contracts: data.contracts,
      portfolios: data.portfolios,
      catalogProducts: data.catalogProducts,
      auditSend: data.auditSend,
      visibleTabs: cleanTabs(data.tabs),
    },
  });
  trialCache = normalizeTrial(row);
  return trialSettings();
}

export const listPeriods = () => PERIOD_IDS.map((id) => ({ id, label: PERIODS[id].label, months: PERIODS[id].months, days: periodDays(id) }));

export function listPlans() {
  return sorted(cache).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    sortOrder: p.sortOrder,
    priceCents: priceCents(p.id), // mensal (mantido por compatibilidade)
    prices: Object.fromEntries(PERIOD_IDS.map((per) => [per, priceCents(p.id, per)])),
    ...limitsOf(p.id),
    dmCredit: p.dmCredit,
  }));
}
