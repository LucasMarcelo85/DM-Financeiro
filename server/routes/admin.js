import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { AppError } from '../utils/helpers.js';
import { isPlan } from '../plans.js';
import { extendAccess, publicUser } from '../services/access.js';
import * as evo from '../services/evolution.js';

const router = Router();

function target(req) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!user) throw new AppError(404, 'Usuário não encontrado.');
  return user;
}

router.get('/users', (_req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY id DESC').all();
  const counts = Object.fromEntries(db.prepare('SELECT user_id, COUNT(*) AS c FROM instances GROUP BY user_id').all().map((r) => [r.user_id, r.c]));
  res.json({ users: users.map((u) => ({ ...publicUser(u), instanceCount: counts[u.id] || 0 })) });
});

router.post('/users/:id/grant', (req, res) => {
  const user = target(req);
  const updated = extendAccess(user.id, config.accessDays);
  res.json({ user: publicUser(updated) });
});

router.patch('/users/:id/plan', (req, res) => {
  const user = target(req);
  if (user.role === 'admin') throw new AppError(400, 'O plano do administrador não pode ser alterado.');
  if (!isPlan(req.body?.plan)) throw new AppError(400, 'Plano inválido.');
  db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(req.body.plan, user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

router.delete('/users/:id', async (req, res) => {
  const user = target(req);
  if (user.id === req.user.id) throw new AppError(400, 'Você não pode excluir a própria conta.');
  if (user.role === 'admin') throw new AppError(400, 'Contas de administrador não podem ser excluídas por aqui.');

  // Remove as instâncias na Evolution (se falhar, não impede a exclusão da conta).
  const instances = db.prepare('SELECT name FROM instances WHERE user_id = ?').all(user.id);
  await Promise.all(instances.map((i) => evo.deleteInstance(i.name).catch((e) => console.warn(`[admin] não removeu ${i.name} na Evolution: ${e.message}`))));

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

export default router;
