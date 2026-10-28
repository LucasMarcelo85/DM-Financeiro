import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { PLAN_ID_RE, PLAN_TABS, RESERVED_PLAN_IDS, deletePlan, isPlan, listPlans, listPeriods, periodDays, planName, priceCents, savePlan, saveTrial, trialSettings } from '../plans.js';
import { eventDTO, grantAccess, publicUser, undoLastGrant } from '../services/access.js';
import * as evo from '../services/evolution.js';
import { removeDomainFromEasypanel } from '../services/easypanel.js';
import { forgetDomain } from '../services/domains.js';
import { ADDON_DAYS, ADDON_KEYS, ADDON_RESOURCES, addonMonthlyCents, listAddonSettings, refreshUserAddons, saveAddonSettings } from '../addons.js';
import { settle } from './billing.js';
import crypto from 'node:crypto';

const router = Router();

async function target(req) {
  const id = Number(req.params.id);
  const user = Number.isInteger(id) ? await prisma.user.findUnique({ where: { id } }) : null;
  if (!user) throw new AppError(404, 'Usuário não encontrado.');
  return user;
}

const ms = (d) => (d ? d.getTime() : null);
const nonAdmin = (user) => {
  if (user.role === 'admin') throw new AppError(400, 'Administradores já têm acesso ilimitado.');
  return user;
};

// Dados do usuário para a lista do admin: telefone, última atividade e a liberação que ainda pode ser desfeita.
const adminView = (u, lastEvent) => ({
  ...publicUser(u),
  lastActivityAt: ms(u.lastActivityAt),
  lastActivity: u.lastActivity,
  lastGrant: lastEvent ? eventDTO(lastEvent) : null, // se houver, o botão "Retroceder" pode ser usado
});
const lastOpenEvent = (userId) => prisma.accessEvent.findFirst({ where: { userId, revertedAt: null }, orderBy: { id: 'desc' } });

router.get('/users', async (_req, res) => {
  const [users, events] = await Promise.all([
    prisma.user.findMany({ orderBy: { id: 'desc' }, include: { _count: { select: { instances: true, contacts: true } } } }),
    prisma.accessEvent.findMany({ where: { revertedAt: null }, orderBy: { id: 'desc' }, distinct: ['userId'] }),
  ]);
  const byUser = new Map(events.map((e) => [e.userId, e]));
  res.json({ users: users.map((u) => ({ ...adminView(u, byUser.get(u.id)), instanceCount: u._count.instances, contactCount: u._count.contacts })) });
});

// ---------- Cobrança e limites individuais ----------
const DAY_MS = 86_400_000;
const cents = (v, label) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new AppError(400, `${label} inválido.`);
  return n;
};
const optCents = (v, label) => (v === null || v === '' || v === undefined ? null : cents(v, label));

async function billingView(user) {
  await refreshUserAddons(user.id);
  const payments = await prisma.payment.findMany({ where: { userId: user.id }, orderBy: { id: 'desc' }, take: 20 });
  const owned = await prisma.userAddon.findMany({ where: { userId: user.id }, orderBy: { paidUntil: 'asc' } });
  const now = Date.now();
  const addons = owned.map((a) => {
    const live = a.paidUntil.getTime() > now;
    return {
      id: a.id, resource: a.resource, label: ADDON_RESOURCES[a.resource]?.label || a.resource, units: a.units,
      paidUntil: a.paidUntil.getTime(), active: live, custom: a.priceCents != null,
      monthlyCents: addonMonthlyCents({ resource: a.resource, units: a.units, priceCents: a.priceCents }),
    };
  });
  const planMonthly = user.planPriceCents ?? priceCents(user.plan, 'mensal');
  return {
    plan: user.plan, planName: planName(user.plan), planMonthlyCents: planMonthly, planCustom: user.planPriceCents != null, planListCents: priceCents(user.plan, 'mensal'),
    accessUntil: ms(user.accessUntil),
    addons,
    nextTotalCents: planMonthly + addons.filter((a) => a.active).reduce((s, a) => s + a.monthlyCents, 0),
    resources: ADDON_KEYS.map((k) => ({ key: k, label: ADDON_RESOURCES[k].label })),
    payments: payments.map((p) => ({ id: p.id, kind: p.kind, plan: p.plan, days: p.days, amountCents: p.amountCents, status: p.status, items: p.items, createdAt: p.createdAt.getTime(), paidAt: ms(p.paidAt) })),
  };
}

router.get('/users/:id/billing', async (req, res) => {
  res.json(await billingView(await target(req)));
});

// Valor mensal combinado só com este usuário (vazio volta ao valor do plano).
router.put('/users/:id/plan-price', async (req, res) => {
  const user = nonAdmin(await target(req));
  await prisma.user.update({ where: { id: user.id }, data: { planPriceCents: optCents(req.body?.priceCents, 'Valor') } });
  res.json(await billingView(await target(req)));
});

// Dá um limite extra a este usuário sem cobrar agora (ou com valor próprio para as renovações).
router.post('/users/:id/addons', async (req, res) => {
  const user = nonAdmin(await target(req));
  const b = req.body || {};
  if (!ADDON_KEYS.includes(b.resource)) throw new AppError(400, 'Escolha o recurso.');
  const units = Number(b.units);
  const days = Number(b.days);
  if (!Number.isInteger(units) || units < 1 || units > 100000) throw new AppError(400, 'Quantidade inválida.');
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new AppError(400, 'Dias inválidos.');
  await prisma.userAddon.create({ data: { userId: user.id, resource: b.resource, units, priceCents: optCents(b.priceCents, 'Valor'), paidUntil: new Date(Date.now() + days * DAY_MS) } });
  res.json(await billingView(user));
});

router.patch('/users/:id/addons/:addonId', async (req, res) => {
  const user = nonAdmin(await target(req));
  const addon = await prisma.userAddon.findFirst({ where: { id: Number(req.params.addonId), userId: user.id } });
  if (!addon) throw new AppError(404, 'Limite não encontrado.');
  const b = req.body || {};
  const data = {};
  if (b.units !== undefined) {
    const units = Number(b.units);
    if (!Number.isInteger(units) || units < 1 || units > 100000) throw new AppError(400, 'Quantidade inválida.');
    data.units = units;
  }
  if (b.priceCents !== undefined) data.priceCents = optCents(b.priceCents, 'Valor');
  if (b.addDays !== undefined) {
    const d = Number(b.addDays);
    if (!Number.isInteger(d) || d < -3650 || d > 3650) throw new AppError(400, 'Dias inválidos.');
    data.paidUntil = new Date(Math.max(Date.now(), addon.paidUntil.getTime()) + d * DAY_MS);
  }
  await prisma.userAddon.update({ where: { id: addon.id }, data });
  res.json(await billingView(user));
});

router.delete('/users/:id/addons/:addonId', async (req, res) => {
  const user = nonAdmin(await target(req));
  await prisma.userAddon.deleteMany({ where: { id: Number(req.params.addonId), userId: user.id } });
  res.json(await billingView(user));
});

// Cria uma cobrança pendente (do plano ou da renovação de um limite) com o valor que o admin definir.
router.post('/users/:id/charges', async (req, res) => {
  const user = nonAdmin(await target(req));
  const b = req.body || {};
  const amountCents = cents(b.amountCents, 'Valor');
  if (amountCents < 100) throw new AppError(400, 'O valor mínimo é R$ 1,00.');
  const orderNsu = `dm-${user.id}-${crypto.randomUUID()}`;
  if (b.addonId != null) {
    const addon = await prisma.userAddon.findFirst({ where: { id: Number(b.addonId), userId: user.id } });
    if (!addon) throw new AppError(404, 'Limite não encontrado.');
    await prisma.payment.create({ data: { userId: user.id, orderNsu, kind: 'addon', plan: user.plan, period: 'mensal', days: ADDON_DAYS, amountCents, items: [{ addonId: addon.id, resource: addon.resource, units: addon.units }] } });
  } else {
    await prisma.payment.create({ data: { userId: user.id, orderNsu, plan: user.plan, period: 'mensal', days: periodDays('mensal'), amountCents } });
  }
  res.json(await billingView(user));
});

router.put('/payments/:id', async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: Number(req.params.id) } });
  if (!payment) throw new AppError(404, 'Cobrança não encontrada.');
  if (payment.status !== 'pending') throw new AppError(400, 'Só dá para alterar cobranças pendentes.');
  const amountCents = cents(req.body?.amountCents, 'Valor');
  if (amountCents < 100) throw new AppError(400, 'O valor mínimo é R$ 1,00.');
  await prisma.payment.update({ where: { id: payment.id }, data: { amountCents } });
  res.json(await billingView(await prisma.user.findUnique({ where: { id: payment.userId } })));
});

// Marca como paga (ex.: pagou por Pix fora do sistema) e libera os dias do plano ou do limite.
router.post('/payments/:id/mark-paid', async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: Number(req.params.id) } });
  if (!payment) throw new AppError(404, 'Cobrança não encontrada.');
  if (payment.status !== 'pending') throw new AppError(400, 'Esta cobrança já foi paga.');
  await settle(payment, {});
  res.json(await billingView(await prisma.user.findUnique({ where: { id: payment.userId } })));
});

router.delete('/payments/:id', async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: Number(req.params.id) } });
  if (!payment) throw new AppError(404, 'Cobrança não encontrada.');
  if (payment.status !== 'pending') throw new AppError(400, 'Cobranças pagas não podem ser canceladas.');
  await prisma.payment.delete({ where: { id: payment.id } });
  res.json(await billingView(await prisma.user.findUnique({ where: { id: payment.userId } })));
});

// Dar acesso mensal (+30 dias) ou de teste (dias configuráveis no painel). As duas ficam no histórico e podem ser retrocedidas.
router.post('/users/:id/grant', async (req, res) => {
  const user = nonAdmin(await target(req));
  const { user: updated, event } = await grantAccess(user.id, 'mensal', req.user);
  res.json({ user: adminView(updated, event) });
});

router.post('/users/:id/grant-trial', async (req, res) => {
  const user = nonAdmin(await target(req));
  const { user: updated, event } = await grantAccess(user.id, 'teste', req.user);
  res.json({ user: adminView(updated, event) });
});

// Retroceder: desfaz a última liberação feita pelo administrador (uma de cada vez, da mais nova para a mais antiga).
router.post('/users/:id/undo-access', async (req, res) => {
  const user = nonAdmin(await target(req));
  const done = await undoLastGrant(user.id);
  if (!done) throw new AppError(409, 'Não há nenhuma liberação do administrador para desfazer neste usuário.', 'NOTHING_TO_UNDO');
  res.json({ user: adminView(done.user, await lastOpenEvent(user.id)), undone: eventDTO(done.event) });
});

router.get('/users/:id/access-events', async (req, res) => {
  const user = await target(req);
  const events = await prisma.accessEvent.findMany({ where: { userId: user.id }, orderBy: { id: 'desc' }, take: 20 });
  res.json({ events: events.map(eventDTO) });
});

router.patch('/users/:id/plan', async (req, res) => {
  const user = await target(req);
  if (user.role === 'admin') throw new AppError(400, 'O plano do administrador não pode ser alterado.');
  if (!isPlan(req.body?.plan)) throw new AppError(400, 'Plano inválido.');
  res.json({ user: adminView(await prisma.user.update({ where: { id: user.id }, data: { plan: req.body.plan } }), await lastOpenEvent(user.id)) });
});

router.delete('/users/:id', async (req, res) => {
  const user = await target(req);
  if (user.id === req.user.id) throw new AppError(400, 'Você não pode excluir a própria conta.');
  if (user.role === 'admin') throw new AppError(400, 'Contas de administrador não podem ser excluídas por aqui.');

  // Remove as instâncias na Evolution (se falhar, não impede a exclusão da conta).
  const instances = await prisma.instance.findMany({ where: { userId: user.id, provider: 'evolution' }, select: { name: true } });
  await Promise.all(instances.map((i) => evo.deleteInstance(i.name).catch((e) => console.warn(`[admin] não removeu ${i.name} na Evolution: ${e.message}`))));
  if (user.customDomain) {
    await removeDomainFromEasypanel(user.customDomain).catch((e) => console.warn(`[admin] não removeu o domínio ${user.customDomain} do EasyPanel: ${e.message}`));
    forgetDomain(user.customDomain);
  }

  await prisma.user.delete({ where: { id: user.id } }); // apaga em cascata clientes, agendamentos e histórico
  res.json({ ok: true });
});

// ---------- Planos: criar, editar e excluir (ficam no banco, não no .env) ----------
const intIn = (v, min, max, label) => {
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v ?? '').trim()) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(400, `${label}: informe um número inteiro de ${min} a ${max}.`);
  return n;
};

// Campos de um plano vindos da tela (validados). `id` só vale na criação.
function planFields(b) {
  if (typeof b.auditSend !== 'boolean') throw new AppError(400, 'Informe se o plano pode responder conversas pela auditoria (sim ou não).');
  const name = String(b.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 40) throw new AppError(400, 'Dê um nome ao plano (de 2 a 40 letras).');
  const color = b.color === '' || b.color == null ? '' : /^#[0-9a-fA-F]{6}$/.test(String(b.color)) ? String(b.color).toLowerCase() : null;
  if (color === null) throw new AppError(400, 'Cor inválida. Use o formato #aabbcc.');
  return {
    name, color,
    sortOrder: intIn(b.sortOrder ?? 0, 0, 1000, 'Ordem'),
    priceCents: intIn(b.priceCents, 100, 10_000_000, 'Preço mensal (em centavos)'),
    instances: intIn(b.instances, 0, 1000, 'WhatsApps para cobranças e lembretes'),
    auditInstances: intIn(b.auditInstances, 0, 1000, 'Números para auditoria'),
    contracts: intIn(b.contracts, 0, 100000, 'Modelos de contrato'),
    portfolios: intIn(b.portfolios, 0, 1000, 'Páginas de portfólio'),
    catalogProducts: intIn(b.catalogProducts, 0, 100000, 'Produtos/serviços do catálogo (0 = sem catálogo digital)'),
    stores: intIn(b.stores ?? 0, 0, 1000, 'Lojas que o plano permite criar (0 = sem a função Criar loja)'),
    dmCredit: b.dmCredit !== false,
    auditSend: b.auditSend,
    tabs: (() => {
      if (!Array.isArray(b.tabs) || b.tabs.some((t) => !PLAN_TABS.includes(t))) throw new AppError(400, 'Escolha as abas liberadas no plano.');
      return [...new Set(b.tabs)];
    })(),
  };
}

// O teste grátis usa todo o acesso do plano escolhido no cadastro; aqui só se define a duração.
function trialFields(b) {
  return { ...trialSettings(), days: intIn(b.days, 1, 60, 'Dias de teste grátis') };
}

async function plansView() {
  const counts = await prisma.user.groupBy({ by: ['plan'], where: { role: 'usuario' }, _count: { _all: true } });
  const byPlan = new Map(counts.map((c) => [c.plan, c._count._all]));
  return { plans: listPlans().map((p) => ({ ...p, userCount: byPlan.get(p.id) || 0 })), periods: listPeriods(), trial: trialSettings(), addons: listAddonSettings() };
}

// Limites extras: pacote (quantidade) e valor mensal de cada recurso que o usuário pode comprar além do plano.
router.put('/addons', async (req, res) => {
  await saveAddonSettings(req.body?.addons);
  res.json({ ...(await plansView()), saved: 'Limites extras' });
});

router.get('/plans', async (_req, res) => {
  res.json(await plansView());
});

router.put('/trial', async (req, res) => {
  await saveTrial(trialFields(req.body || {}));
  res.json(await plansView());
});

// Cria um plano novo. O identificador (ex.: "diamante") vira o nome interno e não muda depois.
router.post('/plans', async (req, res) => {
  const b = req.body || {};
  const id = String(b.id ?? '').trim().toLowerCase();
  if (!PLAN_ID_RE.test(id) || RESERVED_PLAN_IDS.has(id)) throw new AppError(400, 'Identificador inválido. Use de 2 a 30 letras minúsculas, números ou hífen (ex.: diamante).');
  if (isPlan(id)) throw new AppError(409, 'Já existe um plano com esse identificador.');
  const fields = planFields({ ...b, sortOrder: b.sortOrder ?? listPlans().length + 1 });
  await savePlan(id, fields);
  res.status(201).json({ ...(await plansView()), saved: fields.name });
});

// Altera nome, cor, ordem, preço mensal e limites. Vale na hora para novos pagamentos e para os limites de uso.
// Quem já passou do novo limite mantém o que criou; só não consegue adicionar mais.
router.put('/plans/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!isPlan(id)) throw new AppError(404, 'Plano não encontrado.');
  const fields = planFields(req.body || {});
  await savePlan(id, fields);
  res.json({ ...(await plansView()), saved: fields.name });
});

// Exclui um plano. Se tiver usuários, `moveTo` diz para qual plano eles passam. Sempre deve sobrar pelo menos um plano.
router.delete('/plans/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!isPlan(id)) throw new AppError(404, 'Plano não encontrado.');
  if (listPlans().length <= 1) throw new AppError(400, 'Não dá para excluir o único plano. Crie outro antes.');
  const inPlan = await prisma.user.count({ where: { plan: id } });
  const moveTo = req.body?.moveTo ? String(req.body.moveTo) : '';
  if (inPlan > 0 && (!moveTo || moveTo === id || !isPlan(moveTo))) {
    throw new AppError(409, `Este plano tem ${inPlan} ${inPlan === 1 ? 'usuário' : 'usuários'}. Escolha para qual plano eles vão antes de excluir.`, 'PLAN_IN_USE');
  }
  const name = planName(id);
  await deletePlan(id, inPlan > 0 ? moveTo : '');
  res.json({ ...(await plansView()), removed: name, moved: inPlan });
});

export default router;
