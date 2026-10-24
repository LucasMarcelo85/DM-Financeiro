import crypto from 'node:crypto';
import { prisma } from '../prisma.js';
import { AppError, normalizePhone, onlyDigits } from '../utils/helpers.js';
import { defaultCatalogConfig, publicProduct } from '../utils/catalog.js';
import { accessibleUserFilter } from './access.js';
import { limitsFor } from '../plans.js';
import { decrypt } from '../utils/secret.js';
import { lookupCep, quoteCorreios, quoteMotoboy } from './geo.js';

// Pedido do catálogo digital: valida tudo no servidor (preços, frete e campos obrigatórios), grava o pedido e já salva
// o cliente na aba Clientes (o telefone é único por usuário).

const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

// Dono da página (com acesso ativo e plano com catálogo) + configuração do catálogo.
export async function loadCatalogOwner(userSlug) {
  const slug = String(userSlug || '').toLowerCase();
  const owner = await prisma.user.findFirst({ where: { portfolioSlug: slug, ...accessibleUserFilter() }, include: { catalogSettings: true } });
  if (!owner || limitsFor(owner).catalogProducts < 1) throw new AppError(404, 'Catálogo não encontrado.');
  const cfg = { ...defaultCatalogConfig(), ...(owner.catalogSettings?.config || {}) };
  return { owner, cfg, token: decrypt(owner.catalogSettings?.superfrete) };
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
    if (!token) throw new AppError(503, 'O frete dos Correios não está disponível nesta loja agora.', 'SHIPPING_UNAVAILABLE');
    const dest = await resolveDestination({ zip: rawDest?.zip });
    const options = await quoteCorreios({ token, sandbox: Boolean(cfg.correios.sandbox), correios: cfg.correios, toZip: dest.zip, insuranceCents: subtotalCents });
    return { type, dest, options };
  }
  throw new AppError(400, 'Forma de entrega inválida.');
}

export async function createOrder(userSlug, body = {}) {
  const ctx = await loadCatalogOwner(userSlug);
  const { owner, cfg } = ctx;

  // 1) Cliente: nome e telefone são obrigatórios para todos.
  const c = body.customer || {};
  const customerName = line(c.name, 120);
  const phone = normalizePhone(c.phone);
  if (customerName.length < 2) throw new AppError(400, 'Informe o seu nome.');
  if (!phone) throw new AppError(400, 'Informe o seu telefone com DDD, por exemplo (85) 99999-9999.');

  // 2) Itens: preço sempre vem do banco (o que o navegador mandar de preço é ignorado).
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 60) : [];
  if (!rawItems.length) throw new AppError(400, 'O carrinho está vazio.');
  const ids = [...new Set(rawItems.map((i) => Number(i?.productId)).filter(Number.isInteger))];
  const products = await prisma.product.findMany({ where: { id: { in: ids }, userId: owner.id, active: true }, include: { images: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = [];
  for (const it of rawItems) {
    const p = byId.get(Number(it?.productId));
    const qty = Number(it?.qty);
    if (!p || !Number.isInteger(qty) || qty < 1 || qty > 99) throw new AppError(400, 'Um dos itens do carrinho não está mais disponível. Atualize a página.');
    const img = it.imageId ? p.images.find((x) => x.id === Number(it.imageId)) : null;
    if (it.imageId && !img) throw new AppError(400, 'Uma variação escolhida não existe mais. Atualize a página.');
    const unit = img && img.priceCents !== null ? img.priceCents : p.priceCents;
    items.push({ productId: p.id, name: p.name, variation: img?.label || '', qty, unitCents: unit, totalCents: unit * qty });
  }
  const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0);

  // 3) Entrega (cada forma tem os seus campos obrigatórios).
  const d = body.delivery || {};
  const type = String(d.type || '');
  let delivery;
  let shippingCents = 0;
  if (type === 'excursao') {
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
  const addr = type === 'excursao'
    ? { street: delivery.address, city: delivery.city, state: delivery.state || null, complement: `Galpão: ${delivery.warehouse}` }
    : { zip: delivery.zip || null, street: delivery.street || null, number: delivery.number || null, complement: delivery.complement || null, district: delivery.district || null, city: delivery.city || null, state: delivery.state || null };
  const clean = Object.fromEntries(Object.entries(addr).filter(([, v]) => v));

  let order;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      order = await prisma.$transaction(async (tx) => {
        const existing = await tx.contact.findUnique({ where: { userId_phone: { userId: owner.id, phone } } });
        if (existing) await tx.contact.update({ where: { id: existing.id }, data: { ...clean, ...(existing.name ? {} : { name: customerName }) } });
        else await tx.contact.create({ data: { userId: owner.id, name: customerName, phone, ...clean } });
        return tx.order.create({
          data: { userId: owner.id, code: newCode(), customerName, customerPhone: phone, deliveryType: type, delivery, items, subtotalCents, shippingCents, totalCents, notes },
        });
      });
      break;
    } catch (e) {
      if (e?.code !== 'P2002' || attempt === 2) throw e; // outro pedido criou o mesmo cliente agora: tenta de novo
    }
  }
  return { order, cfg };
}

export const orderDTO = (o) => ({
  id: o.id, code: o.code, customerName: o.customerName, customerPhone: o.customerPhone, deliveryType: o.deliveryType, delivery: o.delivery, items: o.items,
  subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, totalCents: o.totalCents, notes: o.notes, status: o.status, createdAt: o.createdAt.getTime(),
});

export { publicProduct };
