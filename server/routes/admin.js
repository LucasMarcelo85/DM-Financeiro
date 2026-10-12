import { Router } from 'express';
import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { isPlan } from '../plans.js';
import { extendAccess, publicUser } from '../services/access.js';
import * as evo from '../services/evolution.js';

const router = Router();

async function target(req) {
  const id = Number(req.params.id);
  const user = Number.isInteger(id) ? await prisma.user.findUnique({ where: { id } }) : null;
  if (!user) throw new AppError(404, 'Usuário não encontrado.');
  return user;
}

router.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { id: 'desc' }, include: { _count: { select: { instances: true, contacts: true } } } });
  res.json({ users: users.map((u) => ({ ...publicUser(u), instanceCount: u._count.instances, contactCount: u._count.contacts })) });
});

router.post('/users/:id/grant', async (req, res) => {
  const user = await target(req);
  res.json({ user: publicUser(await extendAccess(user.id, config.accessDays)) });
});

router.patch('/users/:id/plan', async (req, res) => {
  const user = await target(req);
  if (user.role === 'admin') throw new AppError(400, 'O plano do administrador não pode ser alterado.');
  if (!isPlan(req.body?.plan)) throw new AppError(400, 'Plano inválido.');
  res.json({ user: publicUser(await prisma.user.update({ where: { id: user.id }, data: { plan: req.body.plan } })) });
});

router.delete('/users/:id', async (req, res) => {
  const user = await target(req);
  if (user.id === req.user.id) throw new AppError(400, 'Você não pode excluir a própria conta.');
  if (user.role === 'admin') throw new AppError(400, 'Contas de administrador não podem ser excluídas por aqui.');

  // Remove as instâncias na Evolution (se falhar, não impede a exclusão da conta).
  const instances = await prisma.instance.findMany({ where: { userId: user.id }, select: { name: true } });
  await Promise.all(instances.map((i) => evo.deleteInstance(i.name).catch((e) => console.warn(`[admin] não removeu ${i.name} na Evolution: ${e.message}`))));

  await prisma.user.delete({ where: { id: user.id } }); // apaga em cascata clientes, agendamentos e histórico
  res.json({ ok: true });
});

export default router;
