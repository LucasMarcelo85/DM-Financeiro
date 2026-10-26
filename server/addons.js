import { prisma } from './prisma.js';
import { AppError, DAY } from './utils/helpers.js';

// Limites extras que o usuário pode comprar além do plano. Valor e tamanho do pacote são definidos pelo admin em "Gerir planos".
export const ADDON_RESOURCES = {
  instances: { label: 'WhatsApps para cobranças e lembretes', unit: 'conexão', units: 'conexões', packUnits: 1, priceCents: 1990 },
  auditInstances: { label: 'Números para auditoria', unit: 'número', units: 'números', packUnits: 1, priceCents: 1490 },
  contracts: { label: 'Modelos de contrato', unit: 'modelo', units: 'modelos', packUnits: 5, priceCents: 990 },
  portfolios: { label: 'Páginas de portfólio', unit: 'página', units: 'páginas', packUnits: 1, priceCents: 1490 },
  catalogProducts: { label: 'Produtos/serviços do catálogo', unit: 'item', units: 'itens', packUnits: 50, priceCents: 1990 },
  stores: { label: 'Lojas', unit: 'loja', units: 'lojas', packUnits: 1, priceCents: 2990 },
};
export const ADDON_KEYS = Object.keys(ADDON_RESOURCES);
export const ADDON_DAYS = 30;
export const ADDON_GRACE_WARN_DAYS = 7; // avisa quando faltar esse tanto de dias

const DEFAULTS = (key) => ({ resource: key, enabled: true, packUnits: ADDON_RESOURCES[key].packUnits, priceCents: ADDON_RESOURCES[key].priceCents, maxPacks: 20 });

let settings = new Map(ADDON_KEYS.map((k) => [k, DEFAULTS(k)]));
let byUser = new Map(); // userId -> [{ id, resource, units, paidUntil }]

const settingDTO = (s) => ({ ...s, ...ADDON_RESOURCES[s.resource], resource: s.resource });

export async function loadAddons() {
  const [rows, owned] = await Promise.all([prisma.addonSetting.findMany(), prisma.userAddon.findMany({ where: { paidUntil: { gt: new Date(Date.now() - 365 * DAY) } } })]);
  const next = new Map(ADDON_KEYS.map((k) => [k, DEFAULTS(k)]));
  for (const r of rows) if (next.has(r.resource)) next.set(r.resource, { resource: r.resource, enabled: r.enabled, packUnits: r.packUnits, priceCents: r.priceCents, maxPacks: r.maxPacks });
  settings = next;
  const map = new Map();
  for (const a of owned) map.set(a.userId, [...(map.get(a.userId) || []), { id: a.id, resource: a.resource, units: a.units, priceCents: a.priceCents, paidUntil: a.paidUntil.getTime() }]);
  byUser = map;
}

async function reloadUser(userId, db = prisma) {
  const rows = await db.userAddon.findMany({ where: { userId } });
  byUser = new Map(byUser).set(userId, rows.map((a) => ({ id: a.id, resource: a.resource, units: a.units, priceCents: a.priceCents, paidUntil: a.paidUntil.getTime() })));
}

export const listAddonSettings = () => ADDON_KEYS.map((k) => settingDTO(settings.get(k)));

export async function saveAddonSettings(list) {
  if (!Array.isArray(list)) throw new AppError(400, 'Informe os limites extras.');
  for (const it of list) {
    if (!ADDON_RESOURCES[it?.resource]) throw new AppError(400, 'Recurso inválido.');
    const int = (v, min, max, label) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) throw new AppError(400, `${ADDON_RESOURCES[it.resource].label} — ${label}: informe um número inteiro de ${min} a ${max}.`);
      return n;
    };
    const data = { enabled: Boolean(it.enabled), packUnits: int(it.packUnits, 1, 100000, 'quantidade por pacote'), priceCents: int(it.priceCents, 0, 10_000_000, 'valor mensal (centavos)'), maxPacks: int(it.maxPacks, 1, 1000, 'máximo de pacotes') };
    await prisma.addonSetting.upsert({ where: { resource: it.resource }, create: { resource: it.resource, ...data }, update: data });
  }
  await loadAddons();
  return listAddonSettings();
}

// Soma das unidades extras ainda pagas de um usuário.
export function extraUnits(userId, resource, now = Date.now()) {
  return (byUser.get(userId) || []).reduce((sum, a) => (a.resource === resource && a.paidUntil > now ? sum + a.units : sum), 0);
}

export const extrasFor = (userId) => Object.fromEntries(ADDON_KEYS.map((k) => [k, extraUnits(userId, k)]));

// Valor mensal de uma compra: o combinado com o usuário ou, sem ele, pacotes × valor do pacote em "Gerir planos".
export function addonMonthlyCents(a) {
  if (a.priceCents != null) return a.priceCents;
  const s = settings.get(a.resource) || DEFAULTS(a.resource);
  return Math.max(1, Math.round(a.units / s.packUnits)) * s.priceCents;
}

// Compras do usuário que ainda valem ou venceram há pouco, com os dias restantes (para avisar e permitir pagar antes).
export function addonPurchases(userId, now = Date.now()) {
  return (byUser.get(userId) || [])
    .filter((a) => a.paidUntil > now - 30 * DAY)
    .map((a) => ({ id: a.id, resource: a.resource, label: ADDON_RESOURCES[a.resource]?.label, units: a.units, paidUntil: a.paidUntil, active: a.paidUntil > now, daysLeft: a.paidUntil > now ? Math.ceil((a.paidUntil - now) / DAY) : 0 }))
    .sort((a, b) => a.paidUntil - b.paidUntil);
}

// Valida os itens do carrinho e calcula o total. items: [{ resource, packs }] (nova compra) ou [{ addonId }] (renovação).
export function priceAddonItems(userId, items) {
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new AppError(400, 'Escolha o que deseja adquirir.');
  const owned = new Map((byUser.get(userId) || []).map((a) => [a.id, a]));
  let total = 0;
  const lines = items.map((it) => {
    if (it?.addonId != null) {
      const a = owned.get(Number(it.addonId));
      if (!a) throw new AppError(404, 'Limite extra não encontrado.');
      const s = settings.get(a.resource);
      const cents = addonMonthlyCents(a);
      total += cents;
      return { resource: a.resource, units: a.units, addonId: a.id, cents };
    }
    const s = settings.get(it?.resource);
    if (!s || !s.enabled) throw new AppError(400, 'Este limite extra não está disponível.');
    const packs = Number(it.packs);
    if (!Number.isInteger(packs) || packs < 1 || packs > s.maxPacks) throw new AppError(400, `${ADDON_RESOURCES[s.resource].label}: escolha de 1 a ${s.maxPacks} pacotes.`);
    const cents = packs * s.priceCents;
    total += cents;
    return { resource: s.resource, units: packs * s.packUnits, cents };
  });
  if (total < 100) throw new AppError(400, 'O valor mínimo de pagamento é R$ 1,00. Peça ao administrador para configurar o valor dos limites extras.');
  return { lines, total };
}

// Libera (ou renova) os limites de um pagamento confirmado. Roda dentro da transação do pagamento.
export async function applyAddonPayment(payment, db = prisma) {
  const items = Array.isArray(payment.items) ? payment.items : [];
  for (const it of items) {
    if (it.addonId != null) {
      const a = await db.userAddon.findFirst({ where: { id: it.addonId, userId: payment.userId } });
      if (a) await db.userAddon.update({ where: { id: a.id }, data: { paidUntil: new Date(Math.max(Date.now(), a.paidUntil.getTime()) + payment.days * DAY) } });
    } else {
      await db.userAddon.create({ data: { userId: payment.userId, resource: it.resource, units: it.units, paidUntil: new Date(Date.now() + payment.days * DAY) } });
    }
  }
  await reloadUser(payment.userId, db);
}

export const refreshUserAddons = (userId) => reloadUser(userId);
