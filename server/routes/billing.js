import { Router } from 'express';
import crypto from 'node:crypto';
import { config, infinitepayConfigured } from '../config.js';
import { db } from '../db.js';
import { AppError, normalizePhone } from '../utils/helpers.js';
import { isPlan, listPlans, planName, priceCents } from '../plans.js';
import { computeAccess, extendAccess, publicUser } from '../services/access.js';
import * as pay from '../services/infinitepay.js';

export const billingRouter = Router();
export const webhookRouter = Router();

// Marca o pagamento como pago e libera os dias. Seguro para rodar mais de uma vez.
function settle(payment, { slug, transactionNsu, receiptUrl }) {
  const run = db.transaction(() => {
    const fresh = db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
    if (fresh.status === 'paid') return false;
    db.prepare("UPDATE payments SET status = 'paid', slug = ?, transaction_nsu = ?, receipt_url = ?, paid_at = ? WHERE id = ?").run(
      slug || null,
      transactionNsu || null,
      receiptUrl || null,
      Date.now(),
      fresh.id
    );
    extendAccess(fresh.user_id, config.accessDays, fresh.plan);
    return true;
  });
  return run();
}

async function verifyAndSettle(payment, { slug, transactionNsu, receiptUrl }) {
  if (!slug || !transactionNsu) throw new AppError(400, 'Dados do pagamento incompletos.');
  const result = await pay.checkPayment({ orderNsu: payment.order_nsu, transactionNsu, slug });
  if (!result.paid) throw new AppError(402, 'A InfinitePay ainda não confirmou este pagamento. Aguarde alguns instantes e tente de novo.', 'NOT_PAID');
  if (result.amount && result.amount < payment.amount_cents) throw new AppError(400, 'O valor pago não confere com o plano.');
  settle(payment, { slug, transactionNsu, receiptUrl });
}

billingRouter.get('/', (req, res) => {
  const payments = db
    .prepare('SELECT id, plan, amount_cents AS amountCents, status, receipt_url AS receiptUrl, created_at AS createdAt, paid_at AS paidAt FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 12')
    .all(req.user.id);
  res.json({
    access: computeAccess(req.user),
    plan: req.user.plan,
    plans: listPlans(),
    accessDays: config.accessDays,
    paymentsConfigured: infinitepayConfigured(),
    payments,
  });
});

billingRouter.post('/checkout', async (req, res) => {
  if (!infinitepayConfigured()) {
    throw new AppError(503, 'O pagamento ainda não foi configurado pelo administrador.', 'PAYMENTS_NOT_CONFIGURED');
  }
  const plan = isPlan(req.body?.plan) ? req.body.plan : req.user.plan;
  const amountCents = priceCents(plan);
  const orderNsu = `dm-${req.user.id}-${crypto.randomUUID()}`;

  db.prepare('INSERT INTO payments (user_id, order_nsu, plan, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id,
    orderNsu,
    plan,
    amountCents,
    Date.now()
  );

  const phone = normalizePhone(req.user.phone);
  const url = await pay.createCheckout({
    orderNsu,
    description: `DM Financeiro - Plano ${planName(plan)} (${config.accessDays} dias)`,
    amountCents,
    redirectUrl: `${config.appUrl}/pagamento/retorno`,
    // A InfinitePay só consegue avisar se o sistema estiver publicado com https.
    webhookUrl: config.appUrl.startsWith('https://') ? `${config.appUrl}/api/webhooks/infinitepay` : undefined,
    customer: { name: req.user.name, email: req.user.email, ...(phone ? { phone_number: `+${phone}` } : {}) },
  });
  res.json({ url });
});

// Chamado pela página de retorno, depois que o cliente paga e volta ao sistema.
billingRouter.post('/confirm', async (req, res) => {
  const b = req.body || {};
  const orderNsu = String(b.order_nsu || '');
  const payment = db.prepare('SELECT * FROM payments WHERE order_nsu = ? AND user_id = ?').get(orderNsu, req.user.id);
  if (!payment) throw new AppError(404, 'Pagamento não encontrado.');

  if (payment.status !== 'paid') {
    await verifyAndSettle(payment, { slug: String(b.slug || ''), transactionNsu: String(b.transaction_nsu || ''), receiptUrl: String(b.receipt_url || '') });
  }
  res.json({ paid: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// Aviso automático da InfinitePay. Sempre confirmamos o pagamento direto com a InfinitePay.
webhookRouter.post('/infinitepay', async (req, res) => {
  const b = req.body || {};
  const payment = db.prepare('SELECT * FROM payments WHERE order_nsu = ?').get(String(b.order_nsu || ''));
  if (!payment) throw new AppError(400, 'Pedido desconhecido.');
  if (payment.status !== 'paid') {
    await verifyAndSettle(payment, { slug: String(b.invoice_slug || b.slug || ''), transactionNsu: String(b.transaction_nsu || ''), receiptUrl: String(b.receipt_url || '') });
  }
  res.json({ success: true, message: null });
});
