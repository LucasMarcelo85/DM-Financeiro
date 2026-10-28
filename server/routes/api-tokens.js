import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { publicProduct } from '../utils/catalog.js';
import { computeAccess } from '../services/access.js';
import { orderDTO } from '../services/orders.js';
import { encrypt } from '../utils/secret.js';
import { API_WEBHOOK_EVENTS, resolveWebhookTarget } from '../services/api-webhooks.js';

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ---------- Painel: o usuário cria e revoga os tokens (aba API) ----------
export const tokenRoutes = Router();
const MAX_TOKENS = 20;
const MAX_WEBHOOKS = 10;

async function ownedStore(userId, value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new AppError(400, 'Identificador de loja inválido.');
  const store = await prisma.store.findFirst({ where: { id, userId }, select: { id: true } });
  if (!store) throw new AppError(404, 'Loja não encontrada.');
  return store.id;
}

function webhookInput(body = {}, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim().slice(0, 60);
    if (!name) throw new AppError(400, 'Dê um nome ao webhook.');
    out.name = name;
  }
  if (!partial || body.events !== undefined) {
    const events = Array.isArray(body.events) ? [...new Set(body.events)] : [];
    if (!events.length || events.some((event) => !API_WEBHOOK_EVENTS.includes(event))) {
      throw new AppError(400, 'Selecione pelo menos um evento válido.');
    }
    out.events = events;
  }
  if (!partial || body.url !== undefined) {
    const url = String(body.url ?? '').trim();
    if (!url || url.length > 2000) throw new AppError(400, 'Informe uma URL HTTPS válida.');
    out.url = url;
  }
  return out;
}

const webhookDTO = (item) => ({
  id: item.id, name: item.name, url: item.url, storeId: item.storeId,
  events: item.events, createdAt: item.createdAt,
  ...(item.deliveries ? { deliveries: item.deliveries } : {}),
});

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

tokenRoutes.get('/webhooks', async (req, res) => {
  const [rows, stores] = await Promise.all([
    prisma.apiWebhookEndpoint.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 5, select: { event: true, status: true, attempts: true, lastStatus: true, lastError: true, createdAt: true } } },
    }),
    prisma.store.findMany({ where: { userId: req.user.id }, select: { id: true, name: true } }),
  ]);
  res.json({ webhooks: rows.map(webhookDTO), stores, events: API_WEBHOOK_EVENTS, limit: MAX_WEBHOOKS });
});

tokenRoutes.post('/webhooks', async (req, res) => {
  const data = webhookInput(req.body);
  try { await resolveWebhookTarget(data.url); } catch (error) { throw new AppError(400, error.message); }
  const storeId = await ownedStore(req.user.id, req.body?.storeId);
  if (await prisma.apiWebhookEndpoint.count({ where: { userId: req.user.id } }) >= MAX_WEBHOOKS) {
    throw new AppError(403, `Limite de ${MAX_WEBHOOKS} webhooks. Remova um para cadastrar outro.`);
  }
  const secret = crypto.randomBytes(32).toString('hex');
  const row = await prisma.apiWebhookEndpoint.create({
    data: { userId: req.user.id, storeId, ...data, secret: encrypt(secret) },
  });
  res.status(201).json({ webhook: webhookDTO(row), secret });
});

tokenRoutes.patch('/webhooks/:id', async (req, res) => {
  const id = Number(req.params.id) || 0;
  const current = await prisma.apiWebhookEndpoint.findFirst({ where: { id, userId: req.user.id } });
  if (!current) throw new AppError(404, 'Webhook não encontrado.');
  const data = webhookInput(req.body, true);
  if (data.url) {
    try { await resolveWebhookTarget(data.url); } catch (error) { throw new AppError(400, error.message); }
  }
  if (req.body?.storeId !== undefined) data.storeId = await ownedStore(req.user.id, req.body.storeId);
  if (!Object.keys(data).length) throw new AppError(400, 'Nada para atualizar.');
  const row = await prisma.apiWebhookEndpoint.update({ where: { id }, data });
  res.json({ webhook: webhookDTO(row) });
});

tokenRoutes.delete('/webhooks/:id', async (req, res) => {
  const result = await prisma.apiWebhookEndpoint.deleteMany({ where: { id: Number(req.params.id) || 0, userId: req.user.id } });
  if (!result.count) throw new AppError(404, 'Webhook não encontrado.');
  res.json({ ok: true });
});

// O token completo só aparece uma vez, na criação: no banco fica apenas o hash.
tokenRoutes.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (!name) throw new AppError(400, 'Dê um nome ao token.');
  const storeId = await ownedStore(req.user.id, req.body?.storeId);
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
  images: { select: { id: true, position: true, isPrimary: true, label: true, priceCents: true, color: true, size: true, colorHex: true, stockQuantity: true }, orderBy: { position: 'asc' } },
  priceOptions: { select: { id: true, position: true, label: true, priceCents: true, minQuantity: true, scope: true, minCartCents: true }, orderBy: { position: 'asc' } },
};
const page = (req) => ({ take: Math.min(Math.max(Number(req.query.limit) || 50, 1), 200), skip: Math.max(Number(req.query.offset) || 0, 0) });

publicApi.get('/customers', async (req, res) => {
  const { userId, storeId } = req.apiScope;
  const take = page(req).take;
  const skip = page(req).skip;
  const where = { userId, storeId, deletedAt: null };
  const [groups, totals] = await Promise.all([
    prisma.order.groupBy({ by: ['customerPhone'], where, orderBy: { customerPhone: 'asc' }, take: take + 1, skip }),
    prisma.$queryRaw`SELECT COUNT(DISTINCT "customer_phone")::int AS total FROM "orders" WHERE "user_id" = ${userId} AND "store_id" IS NOT DISTINCT FROM ${storeId} AND "deleted_at" IS NULL`,
  ]);
  const hasMore = groups.length > take;
  const pageGroups = groups.slice(0, take);
  const phones = pageGroups.map((row) => row.customerPhone);
  const [latestOrders, aggregates] = phones.length ? await Promise.all([
    prisma.order.findMany({
      where: { ...where, customerPhone: { in: phones } },
      orderBy: { createdAt: 'desc' },
      distinct: ['customerPhone'],
      select: { customerPhone: true, customerName: true, createdAt: true },
    }),
    prisma.order.groupBy({
      by: ['customerPhone'], where: { ...where, customerPhone: { in: phones }, paymentStatus: 'paid' },
      _sum: { totalCents: true }, _count: { _all: true },
    }),
  ]) : [[], []];
  const latest = new Map(latestOrders.map((order) => [order.customerPhone, order]));
  const stats = new Map(aggregates.map((row) => [row.customerPhone, row]));
  res.json({
    total: totals[0]?.total || 0,
    hasMore,
    customers: pageGroups.map(({ customerPhone }) => {
      const recent = latest.get(customerPhone);
      const aggregate = stats.get(customerPhone);
      return {
        phone: customerPhone, name: recent?.customerName || '', lastOrderAt: recent?.createdAt?.getTime() || null,
        paidOrders: aggregate?._count._all || 0, paidTotalCents: aggregate?._sum.totalCents || 0,
      };
    }),
  });
});

publicApi.get('/customers/:phone', async (req, res) => {
  const { userId, storeId } = req.apiScope;
  const phone = String(req.params.phone || '').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) throw new AppError(400, 'Telefone inválido.');
  const where = { userId, storeId, customerPhone: phone, deletedAt: null };
  const [orders, orderCount, paidTotals] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.order.count({ where }),
    prisma.order.aggregate({ where: { ...where, paymentStatus: 'paid' }, _sum: { totalCents: true } }),
  ]);
  if (!orders.length) throw new AppError(404, 'Cliente não encontrado.');
  res.json({
    customer: { phone, name: orders[0].customerName, ordersCount: orderCount, paidTotalCents: paidTotals._sum.totalCents || 0 },
    orders: orders.map(orderDTO),
  });
});

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
