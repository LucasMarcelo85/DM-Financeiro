import crypto from 'node:crypto';
import { prisma } from '../prisma.js';
import { AppError, normalizePhone, onlyDigits } from '../utils/helpers.js';
import { defaultCatalogConfig, publicProduct } from '../utils/catalog.js';
import { accessibleUserFilter } from './access.js';
import { limitsFor } from '../plans.js';
import { decrypt } from '../utils/secret.js';
import { config } from '../config.js';
import { lookupCep, quoteCorreios, quoteMotoboy } from './geo.js';
import { resolvePublicOwner } from '../utils/store.js';
import { paymentConnections, infinitePayReady } from './catalog-payments.js';
import { emitApiWebhook } from './api-webhooks.js';

// Pedido do catálogo digital: valida tudo no servidor (preços, frete e campos obrigatórios), grava o pedido e já salva
// o cliente na aba Clientes (o telefone é único por usuário).

const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

// Dono da página (com acesso ativo e plano com catálogo) + configuração do catálogo.
export async function loadCatalogOwner(userSlug) {
  const found = await resolvePublicOwner(userSlug, { id: true, plan: true, role: true, accessUntil: true, trialEndsAt: true, catalogSettings: true });
  if (!found || limitsFor(found.owner).catalogProducts < 1) throw new AppError(404, 'Catálogo não encontrado.');
  const { owner, store } = found;
  const base = store ? store.config : owner.catalogSettings?.config;
  const cfg = { ...defaultCatalogConfig(), ...(base || {}) };
  const connections = await paymentConnections(owner.id, store?.id ?? null);
  const paymentMethods = connections.infinitepay && infinitePayReady() ? ['infinitepay'] : [];
  return { owner, store, cfg, token: config.geo.superfreteToken || decrypt(owner.catalogSettings?.superfrete), paymentMethods };
}

// Endereço de destino vindo do cliente (CEP ou endereço). Completa pelo CEP quando possível.
export async function resolveDestination(raw = {}) {
  const dest = {
    zip: onlyDigits(raw.zip), street: line(raw.street, 120), number: line(raw.number, 20), complement: line(raw.complement, 80),
    district: line(raw.district, 80), city: line(raw.city, 80), state: line(raw.state, 2).toUpperCase(),
  };
  if (dest.zip && dest.zip.length !== 8) throw new AppError(400, 'CEP inválido. Use os 8 números.');
  if (dest.zip && !(dest.street && dest.city)) {
    const found = await lookupCep(dest.zip).catch((e) => { if (e.status === 404 || e.status === 400) throw e; return null; });
    if (found) Object.assign(dest, { street: dest.street || found.street, district: dest.district || found.district, city: dest.city || found.city, state: dest.state || found.state });
  }
  return dest;
}

// Orçamento de frete (usado pela página antes do pedido e de novo pelo servidor ao gravar o pedido).
export async function quoteShipping({ cfg, token }, type, rawDest, subtotalCents = 0) {
  if (type === 'motoboy') {
    if (!cfg.motoboy.enabled) throw new AppError(400, 'Esta loja não entrega por motoboy.');
    const dest = await resolveDestination(rawDest);
    if (!dest.zip && !(dest.street && dest.city)) throw new AppError(400, 'Motoboy: informe o CEP ou o endereço de entrega.');
    const q = await quoteMotoboy(cfg, dest);
    return { type, dest, options: [{ id: 'motoboy', name: 'Motoboy', priceCents: q.priceCents, km: q.km, approx: q.approx }] };
  }
  if (type === 'correios') {
    if (!cfg.correios.enabled) throw new AppError(400, 'Esta loja não envia pelos Correios.');
    if (!token) throw new AppError(503, 'O SuperFrete não está configurado no servidor. Avise o administrador.', 'SHIPPING_UNAVAILABLE');
    const dest = await resolveDestination({ zip: rawDest?.zip });
    const options = await quoteCorreios({ token, sandbox: Boolean(cfg.correios.sandbox), correios: cfg.correios, toZip: dest.zip, insuranceCents: subtotalCents });
    return { type, dest, options };
  }
  throw new AppError(400, 'Forma de entrega inválida.');
}

export async function createOrder(userSlug, body = {}) {
  const ctx = await loadCatalogOwner(userSlug);
  const { owner, store, cfg } = ctx;
  const paymentMethod = body.paymentMethod === 'online' ? 'online' : 'whatsapp';
  const paymentProvider = paymentMethod === 'online' ? String(body.paymentProvider || '') : null;
  if (paymentMethod === 'online' && !ctx.paymentMethods.includes(paymentProvider)) throw new AppError(400, 'O pagamento online escolhido não está disponível nesta loja.');
  if (paymentMethod === 'online' && body.delivery?.type === 'excursao') throw new AppError(400, 'Como o frete da excursão é combinado depois, finalize este pedido pelo WhatsApp.');

  // 1) Cliente: nome e telefone são obrigatórios para todos.
  const c = body.customer || {};
  const customerName = line(c.name, 120);
  const phone = normalizePhone(c.phone);
  if (customerName.length < 2) throw new AppError(400, 'Informe o seu nome.');
  if (!phone) throw new AppError(400, 'Informe o seu telefone com DDD, por exemplo (85) 99999-9999.');

  // 2) Itens: preço e faixa por quantidade são sempre recalculados no servidor.
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 60) : [];
  if (!rawItems.length) throw new AppError(400, 'O carrinho está vazio.');
  const requestedCount = rawItems.reduce((sum, item) => sum + (Number.isInteger(Number(item?.qty)) && Number(item.qty) > 0 ? Number(item.qty) : 0), 0);
  if (requestedCount < (cfg.checkout?.minItems || 1)) throw new AppError(400, `Este pedido precisa ter pelo menos ${cfg.checkout.minItems} itens.`);
  const ids = [...new Set(rawItems.map((i) => Number(i?.productId)).filter(Number.isInteger))];
  const products = await prisma.product.findMany({ where: { id: { in: ids }, userId: owner.id, storeId: store?.id ?? null, active: true }, include: { images: true, priceOptions: { orderBy: { position: 'asc' } } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const qtyByProduct = new Map();
  for (const item of rawItems) {
    const productId = Number(item?.productId);
    const qty = Number(item?.qty);
    if (Number.isInteger(productId) && Number.isInteger(qty) && qty > 0) qtyByProduct.set(productId, (qtyByProduct.get(productId) || 0) + qty);
  }
  const cartQuantity = [...qtyByProduct.values()].reduce((sum, qty) => sum + qty, 0);
  const cartBaseCents = rawItems.reduce((sum, item) => {
    const product = byId.get(Number(item?.productId));
    const image = product?.images.find((row) => row.id === Number(item?.imageId) && !row.isPrimary);
    const qty = Number(item?.qty);
    return sum + (product && Number.isInteger(qty) && qty > 0 ? (image?.priceCents ?? product.priceCents) * qty : 0);
  }, 0);
  const items = [];
  const stockDemand = new Map();
  for (const it of rawItems) {
    const p = byId.get(Number(it?.productId));
    const qty = Number(it?.qty);
    if (!p || !Number.isInteger(qty) || qty < 1 || qty > 99) throw new AppError(400, 'Um dos itens do carrinho não está mais disponível. Atualize a página.');
    const img = it.imageId ? p.images.find((x) => x.id === Number(it.imageId) && !x.isPrimary) : null;
    const oldPrimaryImageId = it.imageId && p.images.some((image) => image.id === Number(it.imageId) && image.isPrimary);
    if (it.imageId && !img && !oldPrimaryImageId) throw new AppError(400, 'Uma variação escolhida não existe mais. Atualize a página.');
    if (p.images.some((image) => !image.isPrimary) && !img) throw new AppError(400, `Escolha uma variação de ${p.name}.`);
    const eligible = p.priceOptions.filter((option) => {
      if (option.priceCents === null) return false;
      if (option.scope === 'cart_quantity') return (option.minQuantity || 1) <= cartQuantity;
      if (option.scope === 'cart_value') return (option.minCartCents || 0) <= cartBaseCents;
      return (option.minQuantity || 1) <= (qtyByProduct.get(p.id) || qty);
    });
    const priceOption = eligible.at(-1) || null;
    const unit = priceOption ? priceOption.priceCents : img && img.priceCents !== null ? img.priceCents : p.priceCents;
    const variation = [img?.label, priceOption?.label].filter(Boolean).join(' · ');
    items.push({ productId: p.id, imageId: img?.id || null, stockTracked: p.stockEnabled, name: p.name, variation, qty, unitCents: unit, totalCents: unit * qty });
    if (p.stockEnabled) {
      const key = img ? `image:${img.id}` : `product:${p.id}`;
      const previous = stockDemand.get(key);
      stockDemand.set(key, { product: p, image: img, qty: qty + (previous?.qty || 0) });
      const stock = img ? img.stockQuantity : p.stockQuantity;
      if (stock < qty + (previous?.qty || 0)) throw new AppError(409, `Estoque insuficiente para ${p.name}${img?.label ? ` (${img.label})` : ''}. Disponível: ${stock}.`);
    }
  }
  const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0);
  if (subtotalCents < (cfg.checkout?.minSubtotalCents || 0)) throw new AppError(400, `O valor mínimo do pedido é R$ ${(cfg.checkout.minSubtotalCents / 100).toFixed(2).replace('.', ',')}.`);

  // 3) Entrega (cada forma tem os seus campos obrigatórios).
  const d = body.delivery || {};
  const type = String(d.type || '');
  let delivery;
  let shippingCents = 0;
  if (type === 'retirada') {
    if (!cfg.pickup?.enabled) throw new AppError(400, 'Esta loja não oferece retirada.');
    delivery = { type, name: cfg.pickup.name || cfg.storeName || 'Retirada na loja', address: cfg.pickup.address };
  } else if (type === 'excursao') {
    if (!cfg.excursion.enabled) throw new AppError(400, 'Esta loja não entrega por excursão.');
    const warehouse = line(d.warehouse, 120);
    const city = line(d.city, 80);
    const address = line(d.address, 200);
    if (warehouse.length < 2) throw new AppError(400, 'Excursão: informe o nome do galpão.');
    if (city.length < 2) throw new AppError(400, 'Excursão: informe a cidade do galpão.');
    if (address.length < 3) throw new AppError(400, 'Excursão: informe o endereço do galpão.');
    delivery = { type, warehouse, city, address, state: line(d.state, 2).toUpperCase(), note: 'Frete a combinar com a loja.' };
  } else if (type === 'motoboy' || type === 'correios') {
    const q = await quoteShipping(ctx, type, d, subtotalCents);
    let opt = q.options[0];
    if (type === 'correios') {
      if (!d.serviceId) throw new AppError(400, 'Escolha o serviço de envio (PAC, SEDEX...).');
      opt = q.options.find((o) => o.id === String(d.serviceId));
      if (!opt) throw new AppError(409, 'Esse serviço de envio não está mais disponível para o seu CEP. Simule o frete de novo.');
    }
    shippingCents = opt.priceCents;
    delivery = type === 'motoboy'
      ? { type, ...q.dest, km: opt.km, approx: Boolean(opt.approx), mode: cfg.motoboy.mode }
      : { type, zip: q.dest.zip, service: opt.name, serviceId: opt.id, days: opt.days, company: opt.company, quoteBy: 'SuperFrete', street: q.dest.street, city: q.dest.city, state: q.dest.state, number: line(d.number, 20), complement: line(d.complement, 80), district: q.dest.district };
  } else {
    throw new AppError(400, 'Escolha a forma de entrega.');
  }

  const totalCents = subtotalCents + shippingCents;
  const notes = typeof body.notes === 'string' ? body.notes.replace(/\r/g, '').trim().slice(0, 500) : '';

  // 4) Grava o pedido e o cliente juntos (o telefone é único por usuário: se já existe, só completa o endereço).
  const addr = type === 'retirada'
    ? { street: delivery.address, complement: delivery.name }
    : type === 'excursao'
    ? { street: delivery.address, city: delivery.city, state: delivery.state || null, complement: `Galpão: ${delivery.warehouse}` }
    : { zip: delivery.zip || null, street: delivery.street || null, number: delivery.number || null, complement: delivery.complement || null, district: delivery.district || null, city: delivery.city || null, state: delivery.state || null };
  const clean = Object.fromEntries(Object.entries(addr).filter(([, v]) => v));
  const knownCustomer = await prisma.order.findFirst({
    where: { userId: owner.id, storeId: store?.id ?? null, customerPhone: phone, deletedAt: null },
    select: { id: true },
  });

  let order;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      order = await prisma.$transaction(async (tx) => {
        for (const demand of stockDemand.values()) {
          const result = demand.image
            ? await tx.productImage.updateMany({ where: { id: demand.image.id, productId: demand.product.id, stockQuantity: { gte: demand.qty } }, data: { stockQuantity: { decrement: demand.qty } } })
            : await tx.product.updateMany({ where: { id: demand.product.id, stockEnabled: true, stockQuantity: { gte: demand.qty } }, data: { stockQuantity: { decrement: demand.qty } } });
          if (result.count !== 1) throw new AppError(409, `O estoque de ${demand.product.name} acabou de mudar. Atualize o carrinho e tente novamente.`);
        }
        await tx.orderCustomerProfile.upsert({
          where: { userId_scopeKey_customerPhone: { userId: owner.id, scopeKey: store?.id ? `store:${store.id}` : 'main', customerPhone: phone } },
          create: { userId: owner.id, scopeKey: store?.id ? `store:${store.id}` : 'main', customerPhone: phone, customerName },
          update: { customerName },
        });
        const existing = await tx.contact.findUnique({ where: { userId_phone: { userId: owner.id, phone } } });
        if (existing) await tx.contact.update({ where: { id: existing.id }, data: { ...clean, ...(existing.name ? {} : { name: customerName }) } });
        else await tx.contact.create({ data: { userId: owner.id, name: customerName, phone, ...clean } });
        const createdOrder = await tx.order.create({
          data: { userId: owner.id, storeId: store?.id ?? null, code: newCode(), customerName, customerPhone: phone, deliveryType: type, delivery, items, subtotalCents, shippingCents, totalCents, notes, paymentStatus: paymentMethod === 'online' ? 'pending' : 'unpaid', paymentProvider },
        });
        await tx.orderStrategyRecord.create({
          data: {
            orderId: createdOrder.id, userId: owner.id, storeId: store?.id ?? null,
            customerPhone: createdOrder.customerPhone, totalCents: createdOrder.totalCents,
            paid: createdOrder.paymentStatus === 'paid', createdAt: createdOrder.createdAt,
          },
        });
        return createdOrder;
      });
      break;
    } catch (e) {
      if (e?.code !== 'P2002' || attempt === 2) throw e; // outro pedido criou o mesmo cliente agora: tenta de novo
    }
  }
  emitApiWebhook({ userId: owner.id, storeId: store?.id ?? null, event: 'order.created', data: orderDTO(order) })
    .catch((error) => console.error(`[api-webhook] pedido ${order.id}: ${error.message}`));
  emitApiWebhook({
    userId: owner.id,
    storeId: store?.id ?? null,
    event: knownCustomer ? 'customer.updated' : 'customer.created',
    data: { phone, name: customerName, orderId: order.id, orderCode: order.code },
  }).catch((error) => console.error(`[api-webhook] cliente ${phone}: ${error.message}`));
  return { order, cfg, paymentMethod };
}

export const orderDTO = (o) => ({
  id: o.id, code: o.code, customerName: o.customerName, customerPhone: o.customerPhone, deliveryType: o.deliveryType, delivery: o.delivery, items: o.items,
  subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, totalCents: o.totalCents, notes: o.notes, status: o.status,
  source: o.source || 'catalog', paymentMethod: o.paymentMethod || null, paymentBreakdown: o.paymentBreakdown || [],
  discountCents: o.discountCents || 0, surchargeCents: o.surchargeCents || 0,
  paymentStatus: o.paymentStatus || 'unpaid', paymentProvider: o.paymentProvider || null, paymentId: o.paymentId || null,
  paymentProofUrl: o.paymentProofUrl || null, paidAt: o.paidAt?.getTime() || null,
  createdAt: o.createdAt.getTime(), deletedAt: o.deletedAt?.getTime() || null,
});

export { publicProduct };
