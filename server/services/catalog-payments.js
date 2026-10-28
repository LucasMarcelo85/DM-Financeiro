import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import * as infinitePay from './infinitepay.js';
import { notifyCatalogOrder } from './catalog-notifications.js';
import { emitApiWebhook } from './api-webhooks.js';

const scopeFor = (storeId) => storeId ? `store:${storeId}` : 'main';
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
};

export async function paymentConnections(userId, storeId) {
  const connection = await prisma.catalogPaymentConnection.findUnique({
    where: { userId_scopeKey_provider: { userId, scopeKey: scopeFor(storeId), provider: 'infinitepay' } },
    select: { accountId: true },
  });
  return connection ? { infinitepay: { handle: connection.accountId } } : {};
}

export async function saveInfinitePayHandle(userId, storeId, handle) {
  const value = String(handle || '').trim().replace(/^\$/, '').replace(/^@/, '').slice(0, 100);
  if (!/^[a-zA-Z0-9._-]{2,100}$/.test(value)) throw new AppError(400, 'Informe uma InfiniteTag válida.');
  const scopeKey = scopeFor(storeId);
  await prisma.catalogPaymentConnection.upsert({
    where: { userId_scopeKey_provider: { userId, scopeKey, provider: 'infinitepay' } },
    create: { userId, storeId, scopeKey, provider: 'infinitepay', accountId: value },
    update: { accountId: value },
  });
}

export async function removeInfinitePayConnection(userId, storeId) {
  await prisma.catalogPaymentConnection.deleteMany({ where: { userId, scopeKey: scopeFor(storeId), provider: 'infinitepay' } });
}

async function connectionFor(order) {
  return prisma.catalogPaymentConnection.findUnique({
    where: { userId_scopeKey_provider: { userId: order.userId, scopeKey: scopeFor(order.storeId), provider: 'infinitepay' } },
  });
}

export async function createOnlineCheckout(order, slug) {
  const connection = await connectionFor(order);
  if (!connection) throw new AppError(400, 'A InfinitePay não está conectada a esta loja.');
  const returnUrl = `${config.appUrl}/${encodeURIComponent(slug)}?payment=return&order=${encodeURIComponent(order.code)}&carrinho=1`;
  const url = await infinitePay.createCheckout({
    orderNsu: `catalog-${order.id}`,
    description: `Pedido ${order.code}`,
    amountCents: order.totalCents,
    redirectUrl: `${returnUrl}&order_nsu=${encodeURIComponent(`catalog-${order.id}`)}`,
    webhookUrl: `${config.appUrl}/api/webhooks/catalog-payments/infinitepay`,
    customer: { name: order.customerName, phone_number: `+${order.customerPhone}` },
    handle: connection.accountId,
  });
  const checkoutUrl = safeUrl(url);
  if (!checkoutUrl) throw new AppError(502, 'A InfinitePay não retornou um link de pagamento válido.');
  await prisma.order.updateMany({
    where: { id: order.id, paymentStatus: { not: 'paid' } },
    data: { paymentId: `catalog-${order.id}` },
  });
  return checkoutUrl;
}

async function markPaid(order, { paymentId, proofUrl }) {
  const validProofUrl = safeUrl(proofUrl);
  const updated = await prisma.order.updateMany({
    where: {
      id: order.id,
      OR: [
        { paymentStatus: { not: 'paid' } },
        ...(validProofUrl ? [{ paymentProofUrl: null }] : []),
      ],
    },
    data: {
      paymentStatus: 'paid',
      paymentProvider: 'infinitepay',
      paymentId: String(paymentId || order.paymentId || ''),
      ...(validProofUrl ? { paymentProofUrl: validProofUrl } : {}),
      paidAt: new Date(),
    },
  });
  if (updated.count && order.paymentStatus !== 'paid') {
    const paidOrder = { ...order, paymentStatus: 'paid', paymentProvider: 'infinitepay', paymentId: String(paymentId || order.paymentId || '') };
    notifyCatalogOrder(paidOrder, 'paid').catch((e) => console.error(`[catálogo] falha na notificação de pagamento do pedido ${order.id}: ${e.message}`));
    emitApiWebhook({
      userId: order.userId, storeId: order.storeId, event: 'order.paid',
      data: {
        id: order.id, code: order.code, customerName: order.customerName, customerPhone: order.customerPhone,
        totalCents: order.totalCents, paymentStatus: 'paid', paymentProvider: 'infinitepay',
        paymentId: paidOrder.paymentId, paymentProofUrl: validProofUrl || order.paymentProofUrl || null,
        paidAt: paidOrder.paidAt?.toISOString() || new Date().toISOString(),
      },
    }).catch((e) => console.error(`[api-webhook] pagamento do pedido ${order.id}: ${e.message}`));
  }
}

async function verifyInfinitePay(order, data = {}) {
  const connection = await connectionFor(order);
  if (!connection) return false;
  const transactionNsu = String(data.transaction_nsu || '');
  const invoiceSlug = String(data.invoice_slug || data.slug || '');
  if (!transactionNsu || !invoiceSlug) return false;
  const result = await infinitePay.checkPayment({
    handle: connection.accountId,
    orderNsu: `catalog-${order.id}`,
    transactionNsu,
    slug: invoiceSlug,
  });
  if (!result.paid || result.amount !== order.totalCents) return false;
  await markPaid(order, {
    paymentId: transactionNsu,
    proofUrl: result.receiptUrl || data.receipt_url || data.receiptUrl || data.receipt?.url || data.receipt,
  });
  return true;
}

export async function verifyOrderPayment(order, query = {}) {
  if (order.paymentStatus === 'paid' && order.paymentProofUrl) return true;
  if (order.paymentProvider === 'infinitepay') return verifyInfinitePay(order, query);
  return order.paymentStatus === 'paid';
}

export async function handleInfinitePayWebhook(body) {
  const orderNsu = String(body?.order_nsu || '');
  const id = Number(orderNsu.replace(/^catalog-/, ''));
  const order = Number.isInteger(id) ? await prisma.order.findFirst({ where: { id, paymentProvider: 'infinitepay' } }) : null;
  if (!order) return;
  if (!await verifyInfinitePay(order, body)) throw new AppError(503, 'A InfinitePay ainda não confirmou o valor total deste pedido.', 'PAYMENT_PENDING');
}

export const infinitePayReady = () => config.appUrl.startsWith('https://');
