import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError, normalizePhone } from '../utils/helpers.js';
import { cleanCatalogConfig, defaultCatalogConfig } from '../utils/catalog.js';
import { config } from '../config.js';
import { decrypt } from '../utils/secret.js';
import { orderDTO, quoteShipping } from '../services/orders.js';

// Catálogo digital do usuário: configuração de entregas/frete e a lista de pedidos.
const router = Router();

function orderWhere(userId, filters = {}, { archived = false, includeStatus = true, includeText = true } = {}) {
  const where = { userId, deletedAt: archived ? { not: null } : null };
  if (includeStatus && (filters.status === 'novo' || filters.status === 'atendido')) where.status = filters.status;
  if (filters.deliveryType === 'retirada' || filters.deliveryType === 'excursao' || filters.deliveryType === 'motoboy' || filters.deliveryType === 'correios') where.deliveryType = filters.deliveryType;
  const days = Number(filters.days);
  if (days === 7 || days === config.orderRetentionDays) where[archived ? 'deletedAt' : 'createdAt'] = { gte: new Date(Date.now() - days * 86400000) };
  const q = includeText ? String(filters.q || '').trim() : '';
  if (q) where.OR = [{ customerName: { contains: q, mode: 'insensitive' } }, { customerPhone: { contains: q.replace(/\D/g, '') || '§' } }, { code: { contains: q.toUpperCase() } }];
  return where;
}

async function loadSettings(userId) {
  const row = await prisma.catalogSettings.findUnique({ where: { userId } });
  return { cfg: { ...defaultCatalogConfig(), ...(row?.config || {}) }, token: config.geo.superfreteToken || decrypt(row?.superfrete) };
}

const tokenInfo = (token) => ({ hasSuperfreteToken: Boolean(config.geo.superfreteToken || token) });

router.get('/settings', async (req, res) => {
  const { cfg, token } = await loadSettings(req.user.id);
  res.json({ config: cfg, ...tokenInfo(token) });
});

router.put('/settings', async (req, res) => {
  const b = req.body || {};
  const current = await loadSettings(req.user.id);
  const token = current.token;
  const cfg = cleanCatalogConfig(b.config, { hasToken: Boolean(config.geo.superfreteToken || token) });
  await prisma.catalogSettings.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, config: cfg }, update: { config: cfg } });
  res.json({ config: cfg, ...tokenInfo(token) });
});

// "Testar frete": simula com a configuração salva para um CEP de exemplo.
router.post('/settings/test-shipping', async (req, res) => {
  const { cfg, token } = await loadSettings(req.user.id);
  if (!cfg.correios.enabled) throw new AppError(400, 'Ative e salve as configurações dos Correios antes de testar.');
  const q = await quoteShipping({ cfg, token }, 'correios', { zip: req.body?.zip }, 0);
  res.json({ options: q.options, provider: 'SuperFrete' });
});

// ---------- Pedidos ----------
router.get('/orders', async (req, res) => {
  const archived = req.query.view === 'log';
  const where = orderWhere(req.user.id, req.query, { archived });
  const statsWhere = orderWhere(req.user.id, req.query, { includeStatus: false, includeText: false });
  const [rows, total, fresh, archivedCount, stats] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 }),
    prisma.order.count({ where }),
    prisma.order.count({ where: { ...statsWhere, status: 'novo' } }),
    prisma.order.count({ where: { userId: req.user.id, deletedAt: { not: null } } }),
    prisma.order.aggregate({ where: statsWhere, _sum: { totalCents: true }, _avg: { totalCents: true }, _count: { _all: true } }),
  ]);
  res.json({ orders: rows.map(orderDTO), total, fresh, archived: archivedCount, stats: { totalCents: stats._sum.totalCents || 0, averageCents: Math.round(stats._avg.totalCents || 0), count: stats._count._all }, retentionDays: config.orderRetentionDays });
});

router.get('/customers', async (req, res) => {
  const requestedDays = Number(req.query.days);
  const days = requestedDays === 7 ? 7 : config.orderRetentionDays;
  const cutoff = new Date(Date.now() - days * 86400000);
  const [profiles, aggregates] = await Promise.all([
    prisma.orderCustomerProfile.findMany({ where: { userId: req.user.id }, orderBy: { updatedAt: 'desc' }, take: 1000 }),
    prisma.order.groupBy({
      by: ['customerPhone'],
      where: { userId: req.user.id, createdAt: { gte: cutoff } },
      _sum: { totalCents: true },
      _avg: { totalCents: true },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ]);
  const stats = new Map(aggregates.map((row) => [row.customerPhone, row]));
  res.json({
    customers: profiles.map((profile) => {
      const aggregate = stats.get(profile.customerPhone);
      return {
        phone: profile.customerPhone, name: profile.customerName, labels: profile.labels, notes: profile.notes,
        orders: aggregate?._count._all || 0, totalCents: aggregate?._sum.totalCents || 0,
        averageCents: Math.round(aggregate?._avg.totalCents || 0), lastOrderAt: aggregate?._max.createdAt?.getTime() || null,
      };
    }),
    retentionDays: config.orderRetentionDays, days,
  });
});

router.get('/customers/:phone', async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) throw new AppError(400, 'Telefone inválido.');
  const requestedDays = Number(req.query.days);
  const days = requestedDays === 7 ? 7 : config.orderRetentionDays;
  const [profile, orders] = await Promise.all([
    prisma.orderCustomerProfile.findUnique({ where: { userId_customerPhone: { userId: req.user.id, customerPhone: phone } } }),
    prisma.order.findMany({
      where: { userId: req.user.id, customerPhone: phone, createdAt: { gte: new Date(Date.now() - days * 86400000) } },
      orderBy: { createdAt: 'desc' }, take: 50,
    }),
  ]);
  if (!profile) throw new AppError(404, 'Cliente não encontrado.');
  res.json({ customer: { phone: profile.customerPhone, name: profile.customerName, labels: profile.labels, notes: profile.notes }, orders: orders.map(orderDTO), retentionDays: config.orderRetentionDays, days });
});

router.patch('/customers/:phone', async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) throw new AppError(400, 'Telefone inválido.');
  const profile = await prisma.orderCustomerProfile.findUnique({ where: { userId_customerPhone: { userId: req.user.id, customerPhone: phone } } });
  if (!profile) throw new AppError(404, 'Cliente não encontrado.');
  const labels = req.body?.labels;
  const notes = req.body?.notes;
  const data = {};
  if (labels !== undefined) {
    if (!Array.isArray(labels) || labels.length > 20 || labels.some((label) => typeof label !== 'string' || label.trim().length > 30)) throw new AppError(400, 'Use até 20 etiquetas, com no máximo 30 caracteres cada.');
    data.labels = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  }
  if (notes !== undefined) {
    if (typeof notes !== 'string' || notes.length > 2000) throw new AppError(400, 'A anotação pode ter até 2.000 caracteres.');
    data.notes = notes.trim();
  }
  res.json({ customer: await prisma.orderCustomerProfile.update({ where: { id: profile.id }, data }) });
});

async function ownedOrder(req) {
  const id = Number(req.params.id);
  const o = Number.isInteger(id) ? await prisma.order.findFirst({ where: { id, userId: req.user.id } }) : null;
  if (!o) throw new AppError(404, 'Pedido não encontrado.');
  return o;
}

router.patch('/orders/:id', async (req, res) => {
  const o = await ownedOrder(req);
  if (o.deletedAt) throw new AppError(409, 'Pedidos arquivados não podem ser alterados.');
  const status = req.body?.status;
  if (status !== 'novo' && status !== 'atendido') throw new AppError(400, 'Situação inválida.');
  res.json({ order: orderDTO(await prisma.order.update({ where: { id: o.id }, data: { status } })) });
});

router.delete('/orders/:id', async (req, res) => {
  const o = await ownedOrder(req);
  if (!o.deletedAt) await prisma.order.update({ where: { id: o.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
});

// Arquiva vários pedidos de uma vez (`ids`) ou todos os que correspondem aos filtros (`all: true`).
router.post('/orders/bulk-delete', async (req, res) => {
  const b = req.body || {};
  let where;
  if (b.all === true) where = orderWhere(req.user.id, b);
  else {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
    if (!ids.length) throw new AppError(400, 'Escolha os pedidos para excluir.');
    where = { userId: req.user.id, id: { in: ids }, deletedAt: null };
  }
  const r = await prisma.order.updateMany({ where, data: { deletedAt: new Date() } });
  res.json({ ok: true, removed: r.count });
});

export default router;
