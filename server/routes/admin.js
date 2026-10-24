import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { PLAN_ID_RE, RESERVED_PLAN_IDS, deletePlan, isPlan, listPlans, listPeriods, planName, savePlan } from '../plans.js';
import { eventDTO, grantAccess, publicUser, undoLastGrant } from '../services/access.js';
import * as evo from '../services/evolution.js';

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

// Dar acesso mensal (+30 dias) ou de teste (+3 dias). As duas ficam no histórico e podem ser retrocedidas.
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
    catalogProducts: intIn(b.catalogProducts, 0, 100000, 'Produtos do catálogo (0 = sem catálogo digital)'),
    auditSend: b.auditSend,
  };
}

async function plansView() {
  const counts = await prisma.user.groupBy({ by: ['plan'], where: { role: 'usuario' }, _count: { _all: true } });
  const byPlan = new Map(counts.map((c) => [c.plan, c._count._all]));
  return { plans: listPlans().map((p) => ({ ...p, userCount: byPlan.get(p.id) || 0 })), periods: listPeriods() };
}

router.get('/plans', async (_req, res) => {
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
