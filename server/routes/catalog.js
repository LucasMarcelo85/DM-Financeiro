import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError, normalizePhone } from '../utils/helpers.js';
import { cleanCatalogConfig, defaultCatalogConfig } from '../utils/catalog.js';
import { config } from '../config.js';
import { decrypt } from '../utils/secret.js';
import { orderDTO, quoteShipping } from '../services/orders.js';
import { changeOrderStock } from '../services/order-stock.js';
import { storeScope } from '../utils/store.js';
import { emitApiWebhook } from '../services/api-webhooks.js';
import * as whatsapp from '../services/whatsapp.js';
import { dateRange, importedDate } from '../utils/date-range.js';

// Catálogo digital do usuário: configuração de entregas/frete e a lista de pedidos.
const router = Router();
const customerScopeKey = (storeId) => storeId === null ? 'main' : `store:${storeId}`;

function orderWhere(userId, filters = {}, { archived = false, includeStatus = true, includeText = true, storeId = null } = {}) {
  const where = { userId, storeId, deletedAt: archived ? { not: null } : null };
  if (includeStatus && (filters.status === 'novo' || filters.status === 'atendido')) where.status = filters.status;
  if (filters.deliveryType === 'retirada' || filters.deliveryType === 'excursao' || filters.deliveryType === 'motoboy' || filters.deliveryType === 'correios') where.deliveryType = filters.deliveryType;
  const days = Number(filters.days);
  if (days === 7 || days === config.orderRetentionDays) where[archived ? 'deletedAt' : 'createdAt'] = { gte: new Date(Date.now() - days * 86400000) };
  const q = includeText ? String(filters.q || '').trim() : '';
  if (q) where.OR = [{ customerName: { contains: q, mode: 'insensitive' } }, { customerPhone: { contains: q.replace(/\D/g, '') || '§' } }, { code: { contains: q.toUpperCase() } }];
  return where;
}

async function loadSettings(userId, storeId = null) {
  if (storeId) {
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { config: true } });
    const row = await prisma.catalogSettings.findUnique({ where: { userId } });
    return { cfg: { ...defaultCatalogConfig(), ...(store?.config || {}) }, token: config.geo.superfreteToken || decrypt(row?.superfrete) };
  }
  const row = await prisma.catalogSettings.findUnique({ where: { userId } });
  return { cfg: { ...defaultCatalogConfig(), ...(row?.config || {}) }, token: config.geo.superfreteToken || decrypt(row?.superfrete) };
}

const tokenInfo = (token) => ({ hasSuperfreteToken: Boolean(config.geo.superfreteToken || token) });

router.get('/settings', async (req, res) => {
  const { cfg, token } = await loadSettings(req.user.id, await storeScope(req));
  res.json({ config: cfg, ...tokenInfo(token) });
});

router.put('/settings', async (req, res) => {
  const b = req.body || {};
  const storeId = await storeScope(req);
  const current = await loadSettings(req.user.id, storeId);
  const token = current.token;
  const cfg = cleanCatalogConfig(b.config, { hasToken: Boolean(config.geo.superfreteToken || token) });
  if (cfg.orderNotifications.enabled) {
    const instance = await prisma.instance.findFirst({
      where: { id: cfg.orderNotifications.instanceId, userId: req.user.id, purpose: 'envio', storeId },
    });
    if (!instance || await whatsapp.getState(instance) !== 'open') {
      throw new AppError(400, 'Conecte uma instância de WhatsApp deste site antes de ativar as notificações.');
    }
  }
  if (storeId) await prisma.store.update({ where: { id: storeId }, data: { config: cfg } });
  else await prisma.catalogSettings.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, config: cfg }, update: { config: cfg } });
  res.json({ config: cfg, ...tokenInfo(token) });
});

// "Testar frete": simula com a configuração salva para um CEP de exemplo.
router.post('/settings/test-shipping', async (req, res) => {
  const { cfg, token } = await loadSettings(req.user.id, await storeScope(req));
  if (!cfg.correios.enabled) throw new AppError(400, 'Ative e salve as configurações dos Correios antes de testar.');
  const q = await quoteShipping({ cfg, token }, 'correios', { zip: req.body?.zip }, 0);
  res.json({ options: q.options, provider: 'SuperFrete' });
});

// ---------- Pedidos ----------
router.get('/orders', async (req, res) => {
  const archived = req.query.view === 'log';
  const storeId = await storeScope(req);
  const where = orderWhere(req.user.id, req.query, { archived, storeId });
  const statsWhere = orderWhere(req.user.id, req.query, { includeStatus: false, includeText: false, storeId });
  const [rows, total, fresh, archivedCount, stats] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 }),
    prisma.order.count({ where }),
    prisma.order.count({ where: { ...statsWhere, status: 'novo' } }),
    prisma.order.count({ where: { userId: req.user.id, storeId, deletedAt: { not: null } } }),
    prisma.order.aggregate({ where: { ...statsWhere, paymentStatus: 'paid' }, _sum: { totalCents: true }, _avg: { totalCents: true }, _count: { _all: true } }),
  ]);
  res.json({ orders: rows.map(orderDTO), total, fresh, archived: archivedCount, stats: { totalCents: stats._sum.totalCents || 0, averageCents: Math.round(stats._avg.totalCents || 0), count: stats._count._all }, retentionDays: config.orderRetentionDays });
});

router.get('/orders/export', async (req, res) => {
  const where = { userId: req.user.id, storeId: await storeScope(req), ...dateRange(req.query) };
  const rows = await prisma.order.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  res.json({ rows: rows.map(orderDTO) });
});

router.post('/orders/import', async (req, res) => {
  const rows = req.body?.orders;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new AppError(400, 'Envie de 1 a 500 pedidos por importação.');
  const storeId = await storeScope(req);
  const scopeKey = customerScopeKey(storeId);
  const prepared = [];
  const errors = [];
  const paymentStatuses = new Set(['unpaid', 'pending', 'paid', 'failed']);
  const deliveryTypes = new Set(['retirada', 'excursao', 'motoboy', 'correios']);
  const cents = (value, label) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 1_000_000_000) throw new AppError(400, `${label} inválido.`);
    return number;
  };
  for (const [index, row] of rows.entries()) {
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new AppError(400, 'Registro de pedido inválido.');
      const code = String(row.code || '').trim();
      const customerName = String(row.customerName || '').trim();
      const customerPhone = normalizePhone(row.customerPhone);
      if (!code || code.length > 32) throw new AppError(400, 'Código do pedido inválido.');
      if (customerName.length < 2 || customerName.length > 120 || !customerPhone) throw new AppError(400, 'Nome ou telefone do cliente inválido.');
      if (!deliveryTypes.has(row.deliveryType) || !row.delivery || typeof row.delivery !== 'object' || Array.isArray(row.delivery)) throw new AppError(400, 'Dados de entrega inválidos.');
      if (!Array.isArray(row.items) || row.items.length < 1 || row.items.length > 60) throw new AppError(400, 'O pedido deve conter de 1 a 60 itens.');
      const items = row.items.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new AppError(400, 'Um item do pedido é inválido.');
        const qty = Number(item?.qty);
        const name = String(item?.name || '').trim();
        if (!Number.isInteger(qty) || qty < 1 || qty > 999 || !name || name.length > 120) throw new AppError(400, 'Um item do pedido é inválido.');
        return {
          productId: Number.isInteger(Number(item.productId)) && Number(item.productId) > 0 ? Number(item.productId) : null,
          imageId: Number.isInteger(Number(item.imageId)) && Number(item.imageId) > 0 ? Number(item.imageId) : null,
          stockTracked: Boolean(item.stockTracked), name, variation: String(item.variation || '').slice(0, 200),
          qty, unitCents: cents(item.unitCents, 'Preço do item'), totalCents: cents(item.totalCents, 'Total do item'),
        };
      });
      const status = row.status === 'atendido' ? 'atendido' : row.status === 'novo' ? 'novo' : null;
      const paymentStatus = paymentStatuses.has(row.paymentStatus) ? row.paymentStatus : null;
      if (!status || !paymentStatus) throw new AppError(400, 'Situação do pedido ou do pagamento inválida.');
      const createdAt = importedDate(row.createdAt, 'pedido') || new Date();
      const deletedAt = importedDate(row.deletedAt, 'arquivamento');
      const paidAt = importedDate(row.paidAt, 'pagamento');
      prepared.push({
        sourceRow: index + 2,
        data: {
          code, customerName, customerPhone, deliveryType: row.deliveryType, delivery: row.delivery, items,
          subtotalCents: cents(row.subtotalCents, 'Subtotal'),
          shippingCents: cents(row.shippingCents, 'Frete'),
          totalCents: cents(row.totalCents, 'Total'),
          notes: String(row.notes || '').slice(0, 500), status, paymentStatus,
          paymentProvider: row.paymentProvider ? String(row.paymentProvider).slice(0, 40) : null,
          paymentId: row.paymentId ? String(row.paymentId).slice(0, 200) : null,
          paymentProofUrl: row.paymentProofUrl ? String(row.paymentProofUrl).slice(0, 2000) : null,
          paidAt, createdAt, deletedAt, stockReserved: false,
        },
      });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      errors.push({ row: index + 2, message: error.message });
    }
  }
  let created = 0;
  let updated = 0;
  let skipped = 0;
  await prisma.$transaction(async (tx) => {
    for (const { data } of prepared) {
      const current = await tx.order.findFirst({ where: { userId: req.user.id, storeId, code: data.code } });
      if (current) {
        skipped += 1;
      } else {
        await tx.order.create({ data: { ...data, userId: req.user.id, storeId } });
        created += 1;
      }
      await tx.orderCustomerProfile.upsert({
        where: { userId_scopeKey_customerPhone: { userId: req.user.id, scopeKey, customerPhone: data.customerPhone } },
        create: { userId: req.user.id, scopeKey, customerPhone: data.customerPhone, customerName: data.customerName },
        update: { customerName: data.customerName },
      });
    }
  });
  res.json({ created, updated, skipped: skipped + errors.length, errors });
});

router.get('/customers', async (req, res) => {
  const requestedDays = Number(req.query.days);
  const days = requestedDays === 7 ? 7 : config.orderRetentionDays;
  const cutoff = new Date(Date.now() - days * 86400000);
  const storeId = await storeScope(req);
  const scopeKey = customerScopeKey(storeId);
  const [profiles, aggregates] = await Promise.all([
    prisma.orderCustomerProfile.findMany({ where: { userId: req.user.id, scopeKey }, orderBy: { updatedAt: 'desc' }, take: 1000 }),
    prisma.order.groupBy({
      by: ['customerPhone'],
      where: { userId: req.user.id, storeId, deletedAt: null, paymentStatus: 'paid', createdAt: { gte: cutoff } },
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

router.get('/customers/export', async (req, res) => {
  const storeId = await storeScope(req);
  const profiles = await prisma.orderCustomerProfile.findMany({
    where: { userId: req.user.id, scopeKey: customerScopeKey(storeId), ...dateRange(req.query, 'updatedAt') },
    orderBy: { updatedAt: 'asc' },
  });
  res.json({ rows: profiles.map((profile) => ({
    name: profile.customerName, phone: profile.customerPhone, labels: profile.labels,
    notes: profile.notes, updatedAt: profile.updatedAt.getTime(),
  })) });
});

router.post('/customers/import', async (req, res) => {
  const rows = req.body?.customers;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new AppError(400, 'Envie de 1 a 500 clientes por importação.');
  const scopeKey = customerScopeKey(await storeScope(req));
  let created = 0;
  let updated = 0;
  const errors = [];
  for (const [index, row] of rows.entries()) {
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new AppError(400, 'Registro de cliente inválido.');
      const name = String(row.name || '').trim();
      const phone = normalizePhone(row.phone);
      const labels = row.labels;
      const notes = String(row.notes || '').slice(0, 500);
      if (name.length < 2 || name.length > 120 || !phone) throw new AppError(400, 'Nome ou telefone do cliente inválido.');
      if (!Array.isArray(labels) || labels.length > 30 || labels.some((label) => typeof label !== 'string' || label.length > 40)) throw new AppError(400, 'Etiquetas inválidas.');
      const existing = await prisma.orderCustomerProfile.findUnique({ where: { userId_scopeKey_customerPhone: { userId: req.user.id, scopeKey, customerPhone: phone } } });
      await prisma.orderCustomerProfile.upsert({
        where: { userId_scopeKey_customerPhone: { userId: req.user.id, scopeKey, customerPhone: phone } },
        create: { userId: req.user.id, scopeKey, customerPhone: phone, customerName: name, labels, notes },
        update: { customerName: name, labels, notes },
      });
      if (existing) updated += 1;
      else created += 1;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      errors.push({ row: index + 2, message: error.message });
    }
  }
  res.json({ created, updated, skipped: 0, errors });
});

router.get('/customers/:phone', async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) throw new AppError(400, 'Telefone inválido.');
  const requestedDays = Number(req.query.days);
  const days = requestedDays === 7 ? 7 : config.orderRetentionDays;
  const storeId = await storeScope(req);
  const scopeKey = customerScopeKey(storeId);
  const [profile, orders] = await Promise.all([
    prisma.orderCustomerProfile.findUnique({ where: { userId_scopeKey_customerPhone: { userId: req.user.id, scopeKey, customerPhone: phone } } }),
    prisma.order.findMany({
      where: { userId: req.user.id, storeId, customerPhone: phone, deletedAt: null, createdAt: { gte: new Date(Date.now() - days * 86400000) } },
      orderBy: { createdAt: 'desc' }, take: 50,
    }),
  ]);
  if (!profile) throw new AppError(404, 'Cliente não encontrado.');
  res.json({ customer: { phone: profile.customerPhone, name: profile.customerName, labels: profile.labels, notes: profile.notes }, orders: orders.map(orderDTO), retentionDays: config.orderRetentionDays, days });
});

router.patch('/customers/:phone', async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) throw new AppError(400, 'Telefone inválido.');
  const scopeKey = customerScopeKey(await storeScope(req));
  const profile = await prisma.orderCustomerProfile.findUnique({ where: { userId_scopeKey_customerPhone: { userId: req.user.id, scopeKey, customerPhone: phone } } });
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
  const o = Number.isInteger(id) ? await prisma.order.findFirst({ where: { id, userId: req.user.id, storeId: await storeScope(req) } }) : null;
  if (!o) throw new AppError(404, 'Pedido não encontrado.');
  return o;
}

router.patch('/orders/:id', async (req, res) => {
  const o = await ownedOrder(req);
  if (o.deletedAt) throw new AppError(409, 'Pedidos arquivados não podem ser alterados.');
  const status = req.body?.status;
  if (status !== 'novo' && status !== 'atendido') throw new AppError(400, 'Situação inválida.');
  const data = { status };
  if (status === 'atendido' && o.paymentStatus !== 'paid') {
    Object.assign(data, { paymentStatus: 'paid', paymentProvider: 'manual', paymentId: null, paymentProofUrl: null, paidAt: new Date() });
  } else if (status === 'novo' && o.paymentProvider === 'manual') {
    Object.assign(data, { paymentStatus: 'unpaid', paymentProvider: null, paymentId: null, paymentProofUrl: null, paidAt: null });
  }
  const updated = await prisma.order.updateMany({
    where: { id: o.id, userId: req.user.id, deletedAt: null, status: o.status },
    data,
  });
  if (updated.count !== 1) throw new AppError(409, 'O pedido foi alterado em outra tela. Atualize e tente novamente.');
  const saved = await prisma.order.findUnique({ where: { id: o.id } });
  emitApiWebhook({ userId: req.user.id, storeId: saved.storeId, event: 'order.updated', data: orderDTO(saved) })
    .catch((error) => console.error(`[api-webhook] pedido ${saved.id}: ${error.message}`));
  if (saved.paymentStatus === 'paid' && o.paymentStatus !== 'paid') {
    emitApiWebhook({ userId: req.user.id, storeId: saved.storeId, event: 'order.paid', data: orderDTO(saved) })
      .catch((error) => console.error(`[api-webhook] pagamento do pedido ${saved.id}: ${error.message}`));
  }
  res.json({ order: orderDTO(saved) });
});

async function archiveOrders(where) {
  return prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({ where, select: { id: true, userId: true, storeId: true, items: true, stockReserved: true } });
    if (!orders.length) return 0;
    for (const order of orders) {
      if (order.stockReserved) await changeOrderStock(tx, order, 'restore');
    }
    const archived = await tx.order.updateMany({ where, data: { deletedAt: new Date(), stockReserved: false } });
    if (archived.count !== orders.length) throw new AppError(409, 'Alguns pedidos foram alterados em outra tela. Atualize e tente novamente.');
    return archived.count;
  });
}

router.delete('/orders/:id', async (req, res) => {
  const o = await ownedOrder(req);
  if (o.deletedAt) return res.json({ ok: true, removed: 0 });
  const removed = await archiveOrders({ id: o.id, userId: req.user.id, deletedAt: null });
  const saved = await prisma.order.findUnique({ where: { id: o.id } });
  emitApiWebhook({ userId: req.user.id, storeId: saved.storeId, event: 'order.updated', data: orderDTO(saved) })
    .catch((error) => console.error(`[api-webhook] pedido ${saved.id}: ${error.message}`));
  res.json({ ok: true, removed });
});

// Arquiva vários pedidos de uma vez (`ids`) ou todos os que correspondem aos filtros (`all: true`).
router.post('/orders/bulk-delete', async (req, res) => {
  const b = req.body || {};
  let where;
  if (b.all === true) where = orderWhere(req.user.id, b, { storeId: await storeScope(req) });
  else {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
    if (!ids.length) throw new AppError(400, 'Escolha os pedidos para excluir.');
    where = { userId: req.user.id, storeId: await storeScope(req), id: { in: ids }, deletedAt: null };
  }
  const removed = await archiveOrders(where);
  res.json({ ok: true, removed });
});

router.post('/orders/:id/restore', async (req, res) => {
  const id = Number(req.params.id);
  const storeId = await storeScope(req);
  if (!Number.isInteger(id)) throw new AppError(404, 'Pedido não encontrado.');
  const restored = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id, userId: req.user.id, storeId, deletedAt: { not: null } } });
    if (!order) throw new AppError(404, 'Pedido arquivado não encontrado.');
    if (!order.stockReserved) await changeOrderStock(tx, order, 'reserve');
    const result = await tx.order.updateMany({
      where: { id, userId: req.user.id, storeId, deletedAt: { not: null } },
      data: { deletedAt: null, stockReserved: true },
    });
    if (result.count !== 1) throw new AppError(409, 'O pedido foi alterado em outra tela. Atualize e tente novamente.');
    return tx.order.findUnique({ where: { id } });
  });
  emitApiWebhook({ userId: req.user.id, storeId: restored.storeId, event: 'order.updated', data: orderDTO(restored) })
    .catch((error) => console.error(`[api-webhook] pedido ${restored.id}: ${error.message}`));
  res.json({ ok: true, order: orderDTO(restored) });
});

export default router;
