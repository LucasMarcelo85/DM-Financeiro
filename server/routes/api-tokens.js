import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { publicProduct } from '../utils/catalog.js';
import { computeAccess } from '../services/access.js';
import { orderDTO } from '../services/orders.js';

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ---------- Painel: o usuário cria e revoga os tokens (aba API) ----------
export const tokenRoutes = Router();
const MAX_TOKENS = 20;

const tokenDTO = (t, stores) => ({
  id: t.id, name: t.name, prefix: t.prefix, storeId: t.storeId,
  storeName: t.storeId ? stores.get(t.storeId) || 'Loja removida' : 'Loja principal',
  lastUsedAt: t.lastUsedAt, createdAt: t.createdAt,
});

tokenRoutes.get('/', async (req, res) => {
  const [rows, stores] = await Promise.all([
    prisma.apiToken.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } }),
    prisma.store.findMany({ where: { userId: req.user.id }, select: { id: true, name: true } }),
  ]);
  const names = new Map(stores.map((s) => [s.id, s.name]));
  res.json({ tokens: rows.map((t) => tokenDTO(t, names)), stores });
});

// O token completo só aparece uma vez, na criação: no banco fica apenas o hash.
tokenRoutes.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (!name) throw new AppError(400, 'Dê um nome ao token.');
  let storeId = null;
  if (req.body?.storeId) {
    const store = await prisma.store.findFirst({ where: { id: Number(req.body.storeId), userId: req.user.id }, select: { id: true } });
    if (!store) throw new AppError(404, 'Loja não encontrada.');
    storeId = store.id;
  }
  if ((await prisma.apiToken.count({ where: { userId: req.user.id } })) >= MAX_TOKENS) throw new AppError(403, `Limite de ${MAX_TOKENS} tokens. Revogue algum para criar outro.`);
  const token = `dmk_${crypto.randomBytes(24).toString('hex')}`;
  const row = await prisma.apiToken.create({ data: { userId: req.user.id, storeId, name, prefix: token.slice(0, 10), tokenHash: hash(token) } });
  res.status(201).json({ token, item: tokenDTO(row, new Map()) });
});

tokenRoutes.delete('/:id', async (req, res) => {
  const r = await prisma.apiToken.deleteMany({ where: { id: Number(req.params.id) || 0, userId: req.user.id } });
  if (!r.count) throw new AppError(404, 'Token não encontrado.');
  res.json({ ok: true });
});

// ---------- API pública (somente leitura), autenticada por "Authorization: Bearer <token>" ----------
export const publicApi = Router();

publicApi.use(async (req, res, next) => {
  const m = /^Bearer\s+(dmk_[a-f0-9]{48})$/.exec(req.get('authorization') || '');
  if (!m) throw new AppError(401, 'Envie o token no cabeçalho Authorization: Bearer <token>.', 'UNAUTHENTICATED');
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hash(m[1]) }, include: { user: true } });
  if (!row) throw new AppError(401, 'Token inválido ou revogado.', 'UNAUTHENTICATED');
  if (!computeAccess(row.user).hasAccess) throw new AppError(402, 'A licença desta conta expirou.', 'PAYMENT_REQUIRED');
  if (!limitsFor(row.user).tabs.includes('api')) throw new AppError(403, 'A API não está incluída no plano desta conta.', 'TAB_NOT_IN_PLAN');
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  req.apiScope = { userId: row.userId, storeId: row.storeId };
  next();
});

const include = {
  images: { select: { id: true, position: true, label: true, priceCents: true }, orderBy: { position: 'asc' } },
  priceOptions: { select: { id: true, position: true, label: true, priceCents: true, minQuantity: true }, orderBy: { position: 'asc' } },
};
const page = (req) => ({ take: Math.min(Math.max(Number(req.query.limit) || 50, 1), 200), skip: Math.max(Number(req.query.offset) || 0, 0) });

publicApi.get('/products', async (req, res) => {
  const { userId, storeId } = req.apiScope;
  const where = { userId, storeId };
  if (req.query.active === 'true') where.active = true;
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, include, orderBy: { id: 'asc' }, ...page(req) }),
    prisma.product.count({ where }),
  ]);
  res.json({ total, products: rows.map((p) => ({ ...publicProduct(p), active: p.active })) });
});

publicApi.get('/products/:id', async (req, res) => {
  const { userId, storeId } = req.apiScope;
  const p = await prisma.product.findFirst({ where: { id: Number(req.params.id) || 0, userId, storeId }, include });
  if (!p) throw new AppError(404, 'Produto não encontrado.');
  res.json({ product: { ...publicProduct(p), active: p.active } });
});

publicApi.get('/orders', async (req, res) => {
  const { userId, storeId } = req.apiScope;
  const where = { userId, storeId, deletedAt: null };
  if (req.query.status === 'novo' || req.query.status === 'atendido') where.status = req.query.status;
  const [rows, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, ...page(req) }),
    prisma.order.count({ where }),
  ]);
  res.json({ total, orders: rows.map(orderDTO) });
});

publicApi.get('/orders/:id', async (req, res) => {
  const { userId, storeId } = req.apiScope;
  const o = await prisma.order.findFirst({ where: { id: Number(req.params.id) || 0, userId, storeId, deletedAt: null } });
  if (!o) throw new AppError(404, 'Pedido não encontrado.');
  res.json({ order: orderDTO(o) });
});
