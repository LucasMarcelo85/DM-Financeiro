import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { isPlan } from '../plans.js';
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

export default router;
