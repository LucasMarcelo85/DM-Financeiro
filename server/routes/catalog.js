import { Router } from 'express';
import crypto from 'node:crypto';
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
import { assertPin } from '../utils/pin.js';

// Catálogo digital do usuário: configuração de entregas/frete e a lista de pedidos.
const router = Router();
const customerScopeKey = (storeId) => storeId === null ? 'main' : `store:${storeId}`;

function orderWhere(userId, filters = {}, { archived = false, includeStatus = true, includeText = true, storeId = null } = {}) {
  const where = { userId, storeId, deletedAt: archived ? { not: null } : null };
  if (includeStatus && (filters.status === 'novo' || filters.status === 'atendido')) where.status = filters.status;
  if (filters.deliveryType === 'retirada' || filters.deliveryType === 'excursao' || filters.deliveryType === 'motoboy' || filters.deliveryType === 'correios') where.deliveryType = filters.deliveryType;
  if (filters.source === 'pdv' || filters.source === 'catalog') where.source = filters.source;
  const requestedDays = Number(filters.days);
  const days = [7, 30, 60, config.orderRetentionDays].includes(requestedDays) ? requestedDays : config.orderRetentionDays;
  where[archived ? 'deletedAt' : 'createdAt'] = { gte: new Date(Date.now() - days * 86400000) };
  const q = includeText ? String(filters.q || '').trim() : '';
  if (q) where.OR = [{ customerName: { contains: q, mode: 'insensitive' } }, { customerPhone: { contains: q.replace(/\D/g, '') || '§' } }, { code: { contains: q.toUpperCase() } }];
  return where;
}

function reportDays(value) {
  const days = Number(value);
  return [7, 30, 60, config.orderRetentionDays].includes(days) ? days : 30;
}

async function customerReport(userId, storeId, scopeKey, days) {
  const cutoff = new Date(Date.now() - days * 86400000);
  const [profiles, profileCount, purchases, paidSales, overallSales] = await Promise.all([
    prisma.orderCustomerProfile.findMany({ where: { userId, scopeKey }, orderBy: { updatedAt: 'desc' } }),
    prisma.orderCustomerProfile.count({ where: { userId, scopeKey } }),
    prisma.orderStrategyRecord.groupBy({
      by: ['customerPhone'],
      where: { userId, storeId, createdAt: { gte: cutoff } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.orderStrategyRecord.groupBy({
      by: ['customerPhone'],
      where: { userId, storeId, paid: true, createdAt: { gte: cutoff } },
      _sum: { totalCents: true },
      _avg: { totalCents: true },
      _count: { _all: true },
    }),
    prisma.orderStrategyRecord.aggregate({
      where: { userId, storeId, paid: true, createdAt: { gte: cutoff } },
      _sum: { totalCents: true },
    }),
  ]);
  const purchaseByPhone = new Map(purchases.map((row) => [row.customerPhone, row]));
  const salesByPhone = new Map(paidSales.map((row) => [row.customerPhone, row]));
  const customers = profiles.map((profile) => {
    const purchase = purchaseByPhone.get(profile.customerPhone);
    const sales = salesByPhone.get(profile.customerPhone);
    return {
      phone: profile.customerPhone,
      name: profile.customerName,
      labels: profile.labels,
      notes: profile.notes,
      orders: purchase?._count._all || 0,
      totalCents: sales?._sum.totalCents || 0,
      averageCents: Math.round(sales?._avg.totalCents || 0),
      lastOrderAt: purchase?._max.createdAt?.getTime() || null,
    };
  });
  const buyingCustomers = customers.filter((customer) => customer.orders > 0).length;
  const recurringCustomers = customers.filter((customer) => customer.orders > 1).length;
  const oneTimeCustomers = customers.filter((customer) => customer.orders === 1).length;
  return {
    customers,
    totalCustomers: profileCount,
    buyingCustomers,
    recurringCustomers,
    oneTimeCustomers,
    nonBuyingCustomers: Math.max(0, profileCount - buyingCustomers),
    salesCents: overallSales._sum.totalCents || 0,
    days,
  };
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

const defaultReceipt = { enabled: false, storeName: '', document: '', address: '', phone: '', footer: '' };
const posReceipt = (value) => {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (typeof body.enabled !== 'boolean') throw new AppError(400, 'Informe se a impressão do comprovante está habilitada.');
  const fields = { storeName: 120, document: 40, address: 240, phone: 30, footer: 300 };
  const receipt = { enabled: body.enabled };
  for (const [field, max] of Object.entries(fields)) {
    if (body[field] !== undefined && typeof body[field] !== 'string') throw new AppError(400, 'Dados do comprovante inválidos.');
    receipt[field] = String(body[field] || '').trim().slice(0, max);
  }
  return receipt;
};
const posCents = (value, label, { allowZero = false } = {}) => {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < (allowZero ? 0 : 1) || cents > 1_000_000_000) throw new AppError(400, `${label} inválido.`);
  return cents;
};

router.get('/pos/settings', async (req, res) => {
  const storeId = await storeScope(req);
  const scopeKey = customerScopeKey(storeId);
  const settings = await prisma.posSettings.findUnique({ where: { userId_scopeKey: { userId: req.user.id, scopeKey } } });
  const store = storeId ? await prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }) : null;
  const receipt = { ...defaultReceipt, ...(settings?.receipt || {}) };
  if (!receipt.storeName) receipt.storeName = store?.name || req.user.name;
  res.json({ receipt });
});

router.put('/pos/settings', async (req, res) => {
  const storeId = await storeScope(req);
  const scopeKey = customerScopeKey(storeId);
  const receipt = posReceipt(req.body?.receipt);
  await prisma.posSettings.upsert({
    where: { userId_scopeKey: { userId: req.user.id, scopeKey } },
    create: { userId: req.user.id, storeId, scopeKey, receipt },
    update: { receipt },
  });
  res.json({ receipt });
});

router.post('/pos/checkout', async (req, res) => {
  const storeId = await storeScope(req);
  const body = req.body || {};
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 60) throw new AppError(400, 'Adicione de 1 a 60 itens ao carrinho.');
  const lines = body.items.map((line) => {
    const productId = Number(line?.productId);
    const qty = Number(line?.qty);
    const imageId = line?.imageId === null || line?.imageId === undefined ? null : Number(line.imageId);
    const priceOptionId = line?.priceOptionId === null || line?.priceOptionId === undefined ? null : Number(line.priceOptionId);
    if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(qty) || qty < 1 || qty > 1000
      || (imageId !== null && (!Number.isSafeInteger(imageId) || imageId < 1))
      || (priceOptionId !== null && (!Number.isSafeInteger(priceOptionId) || priceOptionId < 1))) throw new AppError(400, 'Um dos itens do carrinho é inválido.');
    return { productId, qty, imageId, priceOptionId };
  });
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const paymentTypes = new Set(['dinheiro', 'cartao', 'pix']);
  const rawPayments = body.payments;
  if (!Array.isArray(rawPayments) || rawPayments.length < 1 || rawPayments.length > 3) throw new AppError(400, 'Informe a forma de pagamento.');
  const payments = rawPayments.map((payment) => {
    if (!paymentTypes.has(payment?.method)) throw new AppError(400, 'Forma de pagamento inválida.');
    const amountCents = posCents(payment.amountCents, 'Valor do pagamento');
    const receivedCents = payment.method === 'dinheiro' ? posCents(payment.receivedCents ?? amountCents, 'Valor recebido') : amountCents;
    if (receivedCents < amountCents) throw new AppError(400, 'O valor recebido em dinheiro não cobre o pagamento.');
    return { method: payment.method, amountCents, receivedCents };
  });
  if (new Set(payments.map((payment) => payment.method)).size !== payments.length) throw new AppError(400, 'Não repita a mesma forma de pagamento; consolide o valor.');
  const customerName = String(body.customerName || '').trim().slice(0, 120);
  const customerPhone = body.customerPhone ? normalizePhone(body.customerPhone) : '';
  if (body.customerPhone && !customerPhone) throw new AppError(400, 'Telefone do cliente inválido.');
  if (customerPhone && customerName.length < 2) throw new AppError(400, 'Informe o nome do cliente.');
  if (customerName && customerName.length < 2) throw new AppError(400, 'O nome do cliente deve ter ao menos 2 caracteres.');
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length > 2000) throw new AppError(400, 'As observações podem ter até 2.000 caracteres.');

  const order = await prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, userId: req.user.id, storeId, active: true },
      include: {
        images: { select: { id: true, isPrimary: true, label: true, size: true, color: true, priceCents: true, stockQuantity: true } },
        priceOptions: { select: { id: true, label: true, priceCents: true, minQuantity: true, scope: true, minCartCents: true }, orderBy: { position: 'asc' } },
      },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    if (products.length !== productIds.length) throw new AppError(409, 'Um produto não está mais disponível nesta loja.');
    const baseLines = lines.map((line) => {
      const product = byId.get(line.productId);
      const variations = product.images.filter((image) => !image.isPrimary);
      const image = line.imageId ? variations.find((row) => row.id === line.imageId) : null;
      if (line.imageId && !image) throw new AppError(409, `A variação escolhida de ${product.name} não está mais disponível.`);
      if (variations.length && !image) throw new AppError(400, `Escolha uma variação para ${product.name}.`);
      const baseCents = image?.priceCents ?? product.priceCents;
      if (!Number.isSafeInteger(baseCents) || baseCents < 1) throw new AppError(400, `${product.name} não possui preço para venda.`);
      return { ...line, product, image, baseCents };
    });
    const cartQty = baseLines.reduce((sum, line) => sum + line.qty, 0);
    const cartCents = baseLines.reduce((sum, line) => sum + line.baseCents * line.qty, 0);
    if (!Number.isSafeInteger(cartCents) || cartCents > 1_000_000_000) throw new AppError(400, 'O total do carrinho excede o limite permitido.');
    const productQty = new Map();
    for (const line of baseLines) productQty.set(line.productId, (productQty.get(line.productId) || 0) + line.qty);
    const items = baseLines.map((line) => {
      let unitCents = line.baseCents;
      const option = line.priceOptionId ? line.product.priceOptions.find((row) => row.id === line.priceOptionId) : null;
      if (line.priceOptionId && (!option || option.priceCents === null)) throw new AppError(400, `A forma de preço de ${line.product.name} não está disponível.`);
      if (option) {
        const eligible = option.scope === 'cart_quantity'
          ? cartQty >= option.minQuantity
          : option.scope === 'cart_value'
            ? cartCents >= option.minCartCents
            : (productQty.get(line.productId) || 0) >= option.minQuantity;
        if (!eligible) throw new AppError(400, `A condição para ${option.label} ainda não foi atingida.`);
        unitCents = option.priceCents;
      }
      const variation = line.image ? [line.image.label, line.image.size, line.image.color].filter(Boolean).join(' · ') : '';
      return {
        productId: line.product.id,
        ...(line.image ? { imageId: line.image.id } : {}),
        name: line.product.name,
        variation,
        qty: line.qty,
        unitCents,
        totalCents: unitCents * line.qty,
        stockTracked: Boolean(line.product.stockEnabled),
      };
    });
    const subtotalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
    const discountCents = posCents(body.discountCents ?? 0, 'Desconto', { allowZero: true });
    const surchargeCents = posCents(body.surchargeCents ?? 0, 'Acréscimo', { allowZero: true });
    if (discountCents > subtotalCents) throw new AppError(400, 'O desconto não pode superar o subtotal.');
    const totalCents = subtotalCents - discountCents + surchargeCents;
    if (!Number.isSafeInteger(totalCents) || totalCents < 1 || totalCents > 1_000_000_000) throw new AppError(400, 'O total do pedido é inválido.');
    if (payments.reduce((sum, payment) => sum + payment.amountCents, 0) !== totalCents) throw new AppError(400, 'A soma das formas de pagamento deve ser igual ao total do pedido.');
    const paymentMethod = payments.length > 1 ? 'misto' : payments[0].method;
    const code = `PDV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const displayName = customerName || 'Consumidor final';
    const stockOrder = { userId: req.user.id, storeId, items };
    await changeOrderStock(tx, stockOrder, 'reserve');
    if (customerPhone) {
      const scopeKey = customerScopeKey(storeId);
      await tx.orderCustomerProfile.upsert({
        where: { userId_scopeKey_customerPhone: { userId: req.user.id, scopeKey, customerPhone } },
        create: { userId: req.user.id, scopeKey, customerPhone, customerName: displayName },
        update: { customerName: displayName },
      });
    }
    const created = await tx.order.create({
      data: {
        userId: req.user.id,
        storeId,
        code,
        customerName: displayName,
        customerPhone,
        deliveryType: 'retirada',
        delivery: { name: 'Venda no caixa', address: 'PDV' },
        items,
        subtotalCents,
        shippingCents: 0,
        totalCents,
        discountCents,
        surchargeCents,
        notes,
        status: 'atendido',
        stockReserved: false,
        paymentStatus: 'paid',
        paymentProvider: 'manual',
        paymentMethod,
        paymentBreakdown: payments,
        paidAt: new Date(),
        source: 'pdv',
      },
    });
    await tx.orderStrategyRecord.create({
      data: { orderId: created.id, userId: req.user.id, storeId, customerPhone, totalCents, paid: true, createdAt: created.createdAt },
    });
    return created;
  });
  emitApiWebhook({ userId: req.user.id, storeId, event: 'order.created', data: { order: orderDTO(order), source: 'pdv' } })
    .catch((error) => console.error(`[api-webhook] pedido PDV ${order.id}: ${error.message}`));
  res.status(201).json({ order: orderDTO(order) });
});

// ---------- Pedidos ----------
router.get('/orders', async (req, res) => {
  const archived = req.query.view === 'log';
  const storeId = await storeScope(req);
  const where = orderWhere(req.user.id, req.query, { archived, storeId });
  const statsWhere = orderWhere(req.user.id, req.query, { includeStatus: false, includeText: false, storeId });
  const [rows, total, fresh, archivedCount, stats, customerCount] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 }),
    prisma.order.count({ where }),
    prisma.order.count({ where: { ...statsWhere, status: 'novo' } }),
    prisma.order.count({ where: { userId: req.user.id, storeId, deletedAt: { not: null } } }),
    prisma.order.aggregate({ where: { ...statsWhere, paymentStatus: 'paid' }, _sum: { totalCents: true }, _avg: { totalCents: true }, _count: { _all: true } }),
    prisma.orderCustomerProfile.count({ where: { userId: req.user.id, scopeKey: customerScopeKey(storeId) } }),
  ]);
  res.json({ orders: rows.map(orderDTO), total, fresh, archived: archivedCount, customerCount, stats: { totalCents: stats._sum.totalCents || 0, averageCents: Math.round(stats._avg.totalCents || 0), count: stats._count._all }, retentionDays: config.orderRetentionDays, archivedRetentionDays: config.archivedOrderRetentionDays });
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
  const paymentMethods = new Set(['dinheiro', 'cartao', 'pix', 'misto']);
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
      const source = row.source === 'pdv' ? 'pdv' : 'catalog';
      const customerPhone = source === 'pdv' && !row.customerPhone ? '' : normalizePhone(row.customerPhone);
      if (!code || code.length > 32) throw new AppError(400, 'Código do pedido inválido.');
      if (customerName.length < 2 || customerName.length > 120 || (!customerPhone && source !== 'pdv')) throw new AppError(400, 'Nome ou telefone do cliente inválido.');
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
      const paymentBreakdown = row.paymentBreakdown === undefined || row.paymentBreakdown === null
        ? null
        : Array.isArray(row.paymentBreakdown) && row.paymentBreakdown.length <= 3
          ? row.paymentBreakdown.map((payment) => {
            if (!payment || !['dinheiro', 'cartao', 'pix'].includes(payment.method)) throw new AppError(400, 'Formas de pagamento inválidas.');
            return {
              method: payment.method,
              amountCents: cents(payment.amountCents, 'Valor do pagamento'),
              receivedCents: cents(payment.receivedCents ?? payment.amountCents, 'Valor recebido'),
            };
          })
          : (() => { throw new AppError(400, 'Detalhes de pagamento inválidos.'); })();
      const paymentMethod = row.paymentMethod === undefined || row.paymentMethod === null || row.paymentMethod === ''
        ? null
        : paymentMethods.has(row.paymentMethod) ? row.paymentMethod : (() => { throw new AppError(400, 'Forma de pagamento inválida.'); })();
      const createdAt = importedDate(row.createdAt, 'pedido') || new Date();
      const deletedAt = importedDate(row.deletedAt, 'arquivamento');
      const paidAt = importedDate(row.paidAt, 'pagamento');
      prepared.push({
        sourceRow: index + 2,
        data: {
          code, customerName, customerPhone, deliveryType: row.deliveryType, delivery: row.delivery, items, source, paymentMethod, paymentBreakdown,
          subtotalCents: cents(row.subtotalCents, 'Subtotal'),
          shippingCents: cents(row.shippingCents, 'Frete'),
          totalCents: cents(row.totalCents, 'Total'),
          discountCents: cents(row.discountCents ?? 0, 'Desconto'),
          surchargeCents: cents(row.surchargeCents ?? 0, 'Acréscimo'),
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
        const order = await tx.order.create({ data: { ...data, userId: req.user.id, storeId } });
        if (order.customerPhone || order.source === 'pdv') {
          await tx.orderStrategyRecord.create({
            data: { orderId: order.id, userId: req.user.id, storeId, customerPhone: order.customerPhone, totalCents: order.totalCents, paid: order.paymentStatus === 'paid', createdAt: order.createdAt },
          });
        }
        created += 1;
      }
      if (data.customerPhone) {
        await tx.orderCustomerProfile.upsert({
          where: { userId_scopeKey_customerPhone: { userId: req.user.id, scopeKey, customerPhone: data.customerPhone } },
          create: { userId: req.user.id, scopeKey, customerPhone: data.customerPhone, customerName: data.customerName },
          update: { customerName: data.customerName },
        });
      }
    }
  });
  res.json({ created, updated, skipped: skipped + errors.length, errors });
});

router.get('/customers', async (req, res) => {
  const storeId = await storeScope(req);
  const result = await customerReport(req.user.id, storeId, customerScopeKey(storeId), reportDays(req.query.days));
  res.json({ ...result, retentionDays: config.orderRetentionDays, pinRequired: Boolean(req.user.pinHash) });
});

router.post('/customers', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const phone = normalizePhone(req.body?.phone);
  if (name.length < 2 || name.length > 120 || !phone) throw new AppError(400, 'Informe um nome e telefone válidos para o cliente.');
  const storeId = await storeScope(req);
  const scopeKey = customerScopeKey(storeId);
  const existing = await prisma.orderCustomerProfile.findUnique({
    where: { userId_scopeKey_customerPhone: { userId: req.user.id, scopeKey, customerPhone: phone } },
  });
  if (existing) throw new AppError(409, 'Já existe um cliente com este telefone.');
  const customer = await prisma.orderCustomerProfile.create({
    data: { userId: req.user.id, scopeKey, customerPhone: phone, customerName: name },
  });
  res.status(201).json({ customer: { phone: customer.customerPhone, name: customer.customerName, labels: customer.labels, notes: customer.notes } });
});

router.get('/strategy', async (req, res) => {
  const storeId = await storeScope(req);
  const days = reportDays(req.query.days);
  const result = await customerReport(req.user.id, storeId, customerScopeKey(storeId), days);
  const { customers, ...summary } = result;
  res.json({
    ...summary,
    customers: customers.map((customer) => ({
      phone: customer.phone,
      name: customer.name,
      labels: customer.labels,
      orders: customer.orders,
      totalCents: customer.totalCents,
      averageCents: customer.averageCents,
      lastOrderAt: customer.lastOrderAt,
    })),
    salesCents: result.salesCents,
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
      if (existing && req.user.pinHash) assertPin(req.user, req.body?.pin);
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
  const days = reportDays(req.query.days);
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
  res.json({ customer: { phone: profile.customerPhone, name: profile.customerName, labels: profile.labels, notes: profile.notes }, orders: orders.map(orderDTO), retentionDays: config.orderRetentionDays, days, pinRequired: Boolean(req.user.pinHash) });
});

router.patch('/customers/:phone', async (req, res) => {
  if (req.user.pinHash) assertPin(req.user, req.body?.pin);
  const phone = normalizePhone(req.params.phone);
  if (!phone) throw new AppError(400, 'Telefone inválido.');
  const storeId = await storeScope(req);
  const scopeKey = customerScopeKey(storeId);
  const profile = await prisma.orderCustomerProfile.findUnique({ where: { userId_scopeKey_customerPhone: { userId: req.user.id, scopeKey, customerPhone: phone } } });
  if (!profile) throw new AppError(404, 'Cliente não encontrado.');
  const labels = req.body?.labels;
  const notes = req.body?.notes;
  const data = {};
  const name = req.body?.name;
  const nextPhone = req.body?.phone === undefined ? phone : normalizePhone(req.body.phone);
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) throw new AppError(400, 'O nome deve ter de 2 a 120 caracteres.');
    data.customerName = name.trim();
  }
  if (!nextPhone) throw new AppError(400, 'Telefone inválido.');
  if (nextPhone !== phone) {
    const duplicate = await prisma.orderCustomerProfile.findUnique({
      where: { userId_scopeKey_customerPhone: { userId: req.user.id, scopeKey, customerPhone: nextPhone } },
    });
    if (duplicate) throw new AppError(409, 'Já existe um cliente com este telefone.');
    data.customerPhone = nextPhone;
  }
  if (labels !== undefined) {
    if (!Array.isArray(labels) || labels.length > 20 || labels.some((label) => typeof label !== 'string' || label.trim().length > 30)) throw new AppError(400, 'Use até 20 etiquetas, com no máximo 30 caracteres cada.');
    data.labels = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  }
  if (notes !== undefined) {
    if (typeof notes !== 'string' || notes.length > 2000) throw new AppError(400, 'A anotação pode ter até 2.000 caracteres.');
    data.notes = notes.trim();
  }
  const customer = await prisma.$transaction(async (tx) => {
    const updated = await tx.orderCustomerProfile.update({ where: { id: profile.id }, data });
    if (nextPhone !== phone) {
      await tx.orderStrategyRecord.updateMany({ where: { userId: req.user.id, storeId, customerPhone: phone }, data: { customerPhone: nextPhone } });
    }
    return updated;
  });
  res.json({ customer: { phone: customer.customerPhone, name: customer.customerName, labels: customer.labels, notes: customer.notes } });
});

router.delete('/customers/:phone', async (req, res) => {
  if (req.user.pinHash) assertPin(req.user, req.body?.pin);
  const phone = normalizePhone(req.params.phone);
  if (!phone) throw new AppError(400, 'Telefone inválido.');
  const scopeKey = customerScopeKey(await storeScope(req));
  const result = await prisma.orderCustomerProfile.deleteMany({
    where: { userId: req.user.id, scopeKey, customerPhone: phone },
  });
  if (!result.count) throw new AppError(404, 'Cliente não encontrado.');
  res.json({ deleted: true });
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
  if (o.source === 'pdv') throw new AppError(409, 'Vendas finalizadas no PDV não podem ter o pagamento alterado.');
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
  await prisma.orderStrategyRecord.updateMany({
    where: { orderId: saved.id },
    data: { paid: saved.paymentStatus === 'paid', totalCents: saved.totalCents },
  });
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
