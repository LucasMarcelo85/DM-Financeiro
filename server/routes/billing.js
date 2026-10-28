import { Router } from 'express';
import crypto from 'node:crypto';
import { config, infinitepayConfigured } from '../config.js';
import { prisma } from '../prisma.js';
import { AppError, normalizePhone } from '../utils/helpers.js';
import { PERIODS, isPeriod, isPlan, listPeriods, listPlans, periodDays, planName, priceCents } from '../plans.js';
import { computeAccess, extendAccess, publicUser } from '../services/access.js';
import * as pay from '../services/infinitepay.js';
import { ADDON_RESOURCES, ADDON_DAYS, addonPurchases, applyAddonPayment, extrasFor, listAddonSettings, priceAddonItems } from '../addons.js';

export const billingRouter = Router();
export const webhookRouter = Router();

// Marca o pagamento como pago e libera os dias. Seguro para rodar mais de uma vez:
// só quem conseguir virar "pending" -> "paid" libera o acesso.
export async function settle(payment, { slug, transactionNsu, receiptUrl }) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'pending' },
      data: { status: 'paid', slug: slug || null, transactionNsu: transactionNsu || null, receiptUrl: receiptUrl || null, paidAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    if (payment.kind === 'addon') await applyAddonPayment(payment, tx);
    else await extendAccess(payment.userId, payment.days || config.accessDays, payment.plan, tx); // dias do período contratado
    return true;
  });
}

async function verifyAndSettle(payment, { slug, transactionNsu, receiptUrl }) {
  if (!slug || !transactionNsu) throw new AppError(400, 'Dados do pagamento incompletos.');
  const result = await pay.checkPayment({ orderNsu: payment.orderNsu, transactionNsu, slug });
  if (!result.paid) throw new AppError(402, 'A InfinitePay ainda não confirmou este pagamento. Aguarde alguns instantes e tente de novo.', 'NOT_PAID');
  if (result.amount && result.amount < payment.amountCents) throw new AppError(400, 'O valor pago não confere com o plano.');
  await settle(payment, { slug, transactionNsu, receiptUrl });
}

billingRouter.get('/', async (req, res) => {
  const rows = await prisma.payment.findMany({ where: { userId: req.user.id }, orderBy: { id: 'desc' }, take: 12 });
  res.json({
    access: computeAccess(req.user),
    plan: req.user.plan,
    plans: listPlans(),
    periods: listPeriods(),
    accessDays: config.accessDays,
    paymentsConfigured: infinitepayConfigured(),
    addons: { settings: listAddonSettings().filter((s) => s.enabled), extras: extrasFor(req.user.id), purchases: addonPurchases(req.user.id), days: ADDON_DAYS },
    payments: rows.map((p) => ({
      id: p.id, kind: p.kind, plan: p.plan, period: p.period, days: p.days, amountCents: p.amountCents, status: p.status, receiptUrl: p.receiptUrl,
      createdAt: p.createdAt.getTime(), paidAt: p.paidAt ? p.paidAt.getTime() : null,
    })),
  });
});

billingRouter.post('/checkout', async (req, res) => {
  if (!infinitepayConfigured()) {
    throw new AppError(503, 'O pagamento ainda não foi configurado pelo administrador.', 'PAYMENTS_NOT_CONFIGURED');
  }
  const plan = isPlan(req.body?.plan) ? req.body.plan : req.user.plan;
  const period = isPeriod(req.body?.period) ? req.body.period : 'mensal';
  const custom = req.user.planPriceCents != null && plan === req.user.plan;
  const amountCents = custom ? req.user.planPriceCents * PERIODS[period].charged : priceCents(plan, period);
  const days = periodDays(period);
  const orderNsu = `dm-${req.user.id}-${crypto.randomUUID()}`;

  await prisma.payment.create({ data: { userId: req.user.id, orderNsu, plan, period, days, amountCents } });

  const phone = normalizePhone(req.user.phone);
  const url = await pay.createCheckout({
    orderNsu,
    description: `DM Gerenciador - Plano ${planName(plan)} ${PERIODS[period].label.toLowerCase()} (${days} dias)`,
    amountCents,
    redirectUrl: `${config.appUrl}/pagamento/retorno`,
    // A InfinitePay só consegue avisar se o sistema estiver publicado com https.
    webhookUrl: config.appUrl.startsWith('https://') ? `${config.appUrl}/api/webhooks/infinitepay` : undefined,
    customer: { name: req.user.name, email: req.user.email, ...(phone ? { phone_number: `+${phone}` } : {}) },
  });
  res.json({ url });
});

// Compra ou renova limites extras (WhatsApp, auditoria, contratos, portfólio, produtos). Valor e pacote vêm do que o admin configurou.
billingRouter.post('/addons/checkout', async (req, res) => {
  if (!infinitepayConfigured()) {
    throw new AppError(503, 'O pagamento ainda não foi configurado pelo administrador.', 'PAYMENTS_NOT_CONFIGURED');
  }
  if (req.user.role === 'admin') throw new AppError(400, 'Administradores já têm acesso ilimitado.');
  const { lines, total } = priceAddonItems(req.user.id, req.body?.items);
  const orderNsu = `dm-${req.user.id}-${crypto.randomUUID()}`;
  const items = lines.map(({ resource, units, addonId }) => ({ resource, units, ...(addonId != null ? { addonId } : {}) }));
  await prisma.payment.create({ data: { userId: req.user.id, orderNsu, kind: 'addon', plan: req.user.plan, period: 'mensal', days: ADDON_DAYS, amountCents: total, items } });

  const phone = normalizePhone(req.user.phone);
  const summary = lines.map((l) => `${l.units} ${ADDON_RESOURCES[l.resource].units}`).join(', ');
  const url = await pay.createCheckout({
    orderNsu,
    description: `DM Gerenciador - Limites extras: ${summary} (${ADDON_DAYS} dias)`,
    amountCents: total,
    redirectUrl: `${config.appUrl}/pagamento/retorno`,
    webhookUrl: config.appUrl.startsWith('https://') ? `${config.appUrl}/api/webhooks/infinitepay` : undefined,
    customer: { name: req.user.name, email: req.user.email, ...(phone ? { phone_number: `+${phone}` } : {}) },
  });
  res.json({ url });
});

// Chamado pela página de retorno, depois que o cliente paga e volta ao sistema.
billingRouter.post('/confirm', async (req, res) => {
  const b = req.body || {};
  const payment = await prisma.payment.findFirst({ where: { orderNsu: String(b.order_nsu || ''), userId: req.user.id } });
  if (!payment) throw new AppError(404, 'Pagamento não encontrado.');

  if (payment.status !== 'paid') {
    await verifyAndSettle(payment, { slug: String(b.slug || ''), transactionNsu: String(b.transaction_nsu || ''), receiptUrl: String(b.receipt_url || '') });
  }
  res.json({ paid: true, user: publicUser(await prisma.user.findUnique({ where: { id: req.user.id } })) });
});

// Aviso automático da InfinitePay. Sempre confirmamos o pagamento direto com a InfinitePay.
webhookRouter.post('/infinitepay', async (req, res) => {
  const b = req.body || {};
  const payment = await prisma.payment.findUnique({ where: { orderNsu: String(b.order_nsu || '') } });
  if (!payment) throw new AppError(400, 'Pedido desconhecido.');
  if (payment.status !== 'paid') {
    await verifyAndSettle(payment, { slug: String(b.invoice_slug || b.slug || ''), transactionNsu: String(b.transaction_nsu || ''), receiptUrl: String(b.receipt_url || '') });
  }
  res.json({ success: true, message: null });
});
