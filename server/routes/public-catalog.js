import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { lookupCep } from '../services/geo.js';
import { createOrder, loadCatalogOwner, quoteShipping } from '../services/orders.js';
import { createOnlineCheckout, verifyOrderPayment } from '../services/catalog-payments.js';

// Catálogo digital: partes públicas (sem login) — imagem do produto, CEP, simulação de frete — e o webhook que recebe os pedidos.
const router = Router();
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Imagem do produto (o endereço nunca muda: cada troca de imagem cria uma nova linha, então pode ficar em cache por 1 ano).
router.get('/product-image/:id', async (req, res) => {
  const id = Number(req.params.id);
  const img = Number.isInteger(id) ? await prisma.productImage.findUnique({ where: { id }, select: { mime: true, data: true, product: { select: { active: true } } } }) : null;
  if (!img || !img.product.active) throw new AppError(404, 'Sem imagem.');
  res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' });
  res.send(Buffer.from(img.data));
});

// Autopreenche o endereço pelo CEP.
router.get('/cep/:cep', async (req, res) => {
  res.json({ address: await lookupCep(req.params.cep) });
});

// Simula o frete antes do pedido. `type`: 'motoboy' ou 'correios'.
router.post('/catalog/shipping/quote', async (req, res) => {
  const b = req.body || {};
  const ctx = await loadCatalogOwner(b.u);
  const subtotal = Number.isInteger(b.subtotalCents) && b.subtotalCents > 0 ? Math.min(b.subtotalCents, 10_000_000) : 0;
  const q = await quoteShipping(ctx, String(b.type || ''), b, subtotal);
  res.json({ type: q.type, address: q.dest, options: q.options, provider: q.type === 'correios' ? 'SuperFrete' : null });
});

// ---------- Webhook de pedidos ----------
// A página do catálogo envia o pedido para cá: ele é gravado em Pedidos e o cliente já fica salvo em Clientes.
export const ordersWebhook = Router();

ordersWebhook.post('/:slug', async (req, res) => {
  const { order, cfg, paymentMethod } = await createOrder(req.params.slug, req.body);
  const lines = order.items.map((i) => `• ${i.qty}x ${i.name}${i.variation ? ` (${i.variation})` : ''} — ${brl(i.totalCents)}`);
  const text = [`Olá! Fiz o pedido ${order.code}:`, ...lines, `Subtotal: ${brl(order.subtotalCents)}`, order.deliveryType === 'excursao' ? 'Frete: a combinar (excursão)' : `Frete: ${brl(order.shippingCents)}`, `Total: ${brl(order.totalCents)}`].join('\n');
  let checkoutUrl = '';
  let paymentError = '';
  if (paymentMethod === 'online') {
    try { checkoutUrl = await createOnlineCheckout(order, req.params.slug); }
    catch (e) {
      paymentError = e.message || 'Não foi possível gerar o pagamento online.';
      await prisma.order.updateMany({ where: { id: order.id, paymentStatus: { not: 'paid' } }, data: { paymentStatus: 'failed' } });
    }
  }
  res.status(201).json({
    ok: true,
    order: { id: order.id, code: order.code, subtotalCents: order.subtotalCents, shippingCents: order.shippingCents, totalCents: order.totalCents, deliveryType: order.deliveryType, paymentStatus: order.paymentStatus, paymentProvider: order.paymentProvider },
    checkoutUrl, paymentError,
    whatsappUrl: cfg.whatsapp ? `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(text)}` : '',
  });
});

router.get('/catalog/payment-status/:slug/:code', async (req, res) => {
  const ctx = await loadCatalogOwner(req.params.slug);
  const order = await prisma.order.findFirst({ where: { userId: ctx.owner.id, storeId: ctx.store?.id ?? null, code: String(req.params.code).slice(0, 20) } });
  if (!order) throw new AppError(404, 'Pedido não encontrado.');
  await verifyOrderPayment(order, req.query);
  const fresh = await prisma.order.findUnique({ where: { id: order.id } });
  res.json({ paid: fresh.paymentStatus === 'paid', status: fresh.paymentStatus, provider: fresh.paymentProvider, paymentId: fresh.paymentStatus === 'paid' ? fresh.paymentId : null, proofUrl: fresh.paymentStatus === 'paid' ? fresh.paymentProofUrl : null, paidAt: fresh.paidAt?.getTime() || null });
});

export default router;
