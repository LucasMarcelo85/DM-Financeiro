import crypto from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { decrypt, encrypt, safeEqual } from '../utils/secret.js';
import * as infinitePay from './infinitepay.js';

const providerName = { stripe: 'Stripe', mercadopago: 'Mercado Pago', infinitepay: 'InfinitePay' };
const scopeFor = (storeId) => storeId ? `store:${storeId}` : 'main';
const safeUrl = (v) => {
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : ''; } catch { return ''; }
};
const jsonFetch = async (url, options = {}) => {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  let data = {};
  try { data = await res.json(); } catch { /* resposta sem JSON */ }
  if (!res.ok) {
    const error = new AppError(502, 'O provedor de pagamento não concluiu a solicitação. Tente novamente.', 'PAYMENT_PROVIDER_ERROR');
    error.providerStatus = res.status;
    throw error;
  }
  return data;
};

async function refreshMercadoPago(connection) {
  const refreshToken = decrypt(connection.refreshToken);
  if (!refreshToken || !config.catalogPayments.mercadoPagoClientId || !config.catalogPayments.mercadoPagoClientSecret) return null;
  const result = await jsonFetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.catalogPayments.mercadoPagoClientId, client_secret: config.catalogPayments.mercadoPagoClientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
  }).catch(() => null);
  if (!result?.access_token) return null;
  await prisma.catalogPaymentConnection.update({
    where: { id: connection.id },
    data: { accessToken: encrypt(result.access_token), refreshToken: result.refresh_token ? encrypt(result.refresh_token) : connection.refreshToken },
  });
  return result.access_token;
}

async function mercadoPagoFetch(connection, url, options = {}) {
  let token = decrypt(connection.accessToken);
  if (!token) return null;
  try {
    return await jsonFetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  } catch (error) {
    if (error.providerStatus !== 401) throw error;
    token = await refreshMercadoPago(connection);
    if (!token) throw error;
    return jsonFetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  }
}

export async function paymentConnections(userId, storeId) {
  const rows = await prisma.catalogPaymentConnection.findMany({
    where: { userId, scopeKey: scopeFor(storeId) },
    select: { provider: true, accountId: true },
  });
  return Object.fromEntries(rows.map((row) => [row.provider, row.provider === 'infinitepay' ? { handle: row.accountId } : { connected: true }]));
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

export async function removeConnection(userId, storeId, provider) {
  await prisma.catalogPaymentConnection.deleteMany({ where: { userId, scopeKey: scopeFor(storeId), provider } });
}

export async function startOAuth(userId, storeId, provider) {
  if (!['stripe', 'mercadopago'].includes(provider)) throw new AppError(400, 'Provedor inválido.');
  const paymentCfg = config.catalogPayments;
  const clientId = provider === 'stripe' ? paymentCfg.stripeClientId : paymentCfg.mercadoPagoClientId;
  const clientSecret = provider === 'stripe' ? paymentCfg.stripeSecretKey : paymentCfg.mercadoPagoClientSecret;
  if (!clientId || !clientSecret) throw new AppError(503, `${providerName[provider]} ainda não está configurado no servidor.`, 'PAYMENTS_NOT_CONFIGURED');

  const state = crypto.randomBytes(32).toString('base64url');
  await prisma.catalogPaymentOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.catalogPaymentOAuthState.create({
    data: { stateHash: crypto.createHash('sha256').update(state).digest('hex'), userId, storeId, scopeKey: scopeFor(storeId), provider, expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  const redirectUri = `${config.appUrl}/api/catalog/payments/oauth/callback/${provider}`;
  const params = provider === 'stripe'
    ? new URLSearchParams({ response_type: 'code', client_id: clientId, scope: 'read_write', redirect_uri: redirectUri, state })
    : new URLSearchParams({ client_id: clientId, response_type: 'code', platform_id: 'mp', redirect_uri: redirectUri, state });
  return `${provider === 'stripe' ? 'https://connect.stripe.com/oauth/authorize' : 'https://auth.mercadopago.com/authorization'}?${params}`;
}

export async function finishOAuth(provider, state, code) {
  const stateHash = crypto.createHash('sha256').update(String(state || '')).digest('hex');
  const saved = await prisma.catalogPaymentOAuthState.findUnique({ where: { stateHash } });
  if (!saved || saved.provider !== provider || saved.expiresAt < new Date()) throw new AppError(400, 'A autorização expirou ou não é válida.');
  await prisma.catalogPaymentOAuthState.delete({ where: { id: saved.id } });
  const redirectUri = `${config.appUrl}/api/catalog/payments/oauth/callback/${provider}`;
  let accountId, accessToken, refreshToken = null;
  if (provider === 'stripe') {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: String(code || ''), client_secret: config.catalogPayments.stripeSecretKey });
    const data = await jsonFetch('https://connect.stripe.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    accountId = data.stripe_user_id; accessToken = data.access_token;
  } else if (provider === 'mercadopago') {
    const data = await jsonFetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.catalogPayments.mercadoPagoClientId, client_secret: config.catalogPayments.mercadoPagoClientSecret, grant_type: 'authorization_code', code: String(code || ''), redirect_uri: redirectUri }),
    });
    accountId = String(data.user_id || ''); accessToken = data.access_token; refreshToken = data.refresh_token || null;
  } else throw new AppError(400, 'Provedor inválido.');
  if (!accountId || !accessToken) throw new AppError(502, `Não foi possível concluir a conexão com ${providerName[provider]}.`);
  await prisma.catalogPaymentConnection.upsert({
    where: { userId_scopeKey_provider: { userId: saved.userId, scopeKey: saved.scopeKey, provider } },
    create: { userId: saved.userId, storeId: saved.storeId, scopeKey: saved.scopeKey, provider, accountId, accessToken: encrypt(accessToken), refreshToken: refreshToken ? encrypt(refreshToken) : null },
    update: { accountId, accessToken: encrypt(accessToken), refreshToken: refreshToken ? encrypt(refreshToken) : null },
  });
  return saved;
}

async function connectionFor(order, provider) {
  return prisma.catalogPaymentConnection.findUnique({ where: { userId_scopeKey_provider: { userId: order.userId, scopeKey: scopeFor(order.storeId), provider } } });
}

export async function createOnlineCheckout(order, provider, slug) {
  const connection = await connectionFor(order, provider);
  if (!connection) throw new AppError(400, 'Esta forma de pagamento não está conectada a esta loja.');
  const returnUrl = `${config.appUrl}/${encodeURIComponent(slug)}?payment=return&order=${encodeURIComponent(order.code)}&carrinho=1`;
  let url, id;
  if (provider === 'stripe') {
    if (!config.catalogPayments.stripeSecretKey) throw new AppError(503, 'Stripe não está configurado no servidor.');
    const accountToken = decrypt(connection.accessToken);
    if (!accountToken) throw new AppError(503, 'A conexão com Stripe precisa ser refeita.');
    const form = new URLSearchParams({
      mode: 'payment', success_url: `${returnUrl}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: returnUrl,
      'line_items[0][price_data][currency]': 'brl', 'line_items[0][price_data][unit_amount]': String(order.totalCents),
      'line_items[0][price_data][product_data][name]': `Pedido ${order.code}`, 'line_items[0][quantity]': '1',
      'metadata[orderId]': String(order.id), 'metadata[orderCode]': order.code,
    });
    const session = await jsonFetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${config.catalogPayments.stripeSecretKey}`, 'Stripe-Account': connection.accountId, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
    });
    url = session.url; id = session.id;
  } else if (provider === 'mercadopago') {
    if (!decrypt(connection.accessToken)) throw new AppError(503, 'A conexão com Mercado Pago precisa ser refeita.');
    const pref = await mercadoPagoFetch(connection, 'https://api.mercadopago.com/checkout/preferences', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: String(order.id), title: `Pedido ${order.code}`, quantity: 1, currency_id: 'BRL', unit_price: order.totalCents / 100 }],
        external_reference: String(order.id), notification_url: `${config.appUrl}/api/webhooks/catalog-payments/mercadopago`,
        back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl }, auto_return: 'approved',
      }),
    });
    url = pref.init_point; id = String(pref.id || '');
  } else if (provider === 'infinitepay') {
    const returnUrlWithOrder = `${returnUrl}&order_nsu=${encodeURIComponent(`catalog-${order.id}`)}`;
    url = await infinitePay.createCheckout({
      orderNsu: `catalog-${order.id}`, description: `Pedido ${order.code}`, amountCents: order.totalCents,
      redirectUrl: returnUrlWithOrder,
      webhookUrl: `${config.appUrl}/api/webhooks/catalog-payments/infinitepay`,
      customer: { name: order.customerName, phone_number: `+${order.customerPhone}` },
      handle: connection.accountId,
    });
    id = `catalog-${order.id}`;
  } else throw new AppError(400, 'Provedor de pagamento inválido.');
  url = safeUrl(url);
  if (!url) throw new AppError(502, 'O provedor não retornou um link de pagamento válido.');
  await prisma.order.updateMany({ where: { id: order.id, paymentStatus: { not: 'paid' } }, data: { paymentId: id } });
  return url;
}

async function markPaid(order, { provider, paymentId, proofUrl }) {
  const proof = safeUrl(proofUrl);
  await prisma.order.updateMany({
    where: { id: order.id, paymentStatus: { not: 'paid' } },
    data: { paymentStatus: 'paid', paymentProvider: provider, paymentId: String(paymentId || order.paymentId || ''), paymentProofUrl: proof || null, paidAt: new Date() },
  });
}

async function verifyStripe(order, sessionId) {
  const connection = await connectionFor(order, 'stripe');
  if (!connection || !config.catalogPayments.stripeSecretKey || !sessionId) return false;
  const session = await jsonFetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${config.catalogPayments.stripeSecretKey}`, 'Stripe-Account': connection.accountId },
  }).catch(() => null);
  if (!session || session.payment_status !== 'paid' || session.currency !== 'brl' || Number(session.amount_total) !== order.totalCents || String(session.metadata?.orderId) !== String(order.id)) return false;
  let receipt = '';
  if (session.payment_intent) {
    const intent = await jsonFetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(session.payment_intent)}?expand[]=latest_charge`, {
      headers: { Authorization: `Bearer ${config.catalogPayments.stripeSecretKey}`, 'Stripe-Account': connection.accountId },
    }).catch(() => null);
    receipt = intent?.latest_charge?.receipt_url || '';
  }
  await markPaid(order, { provider: 'stripe', paymentId: session.payment_intent || session.id, proofUrl: receipt });
  return true;
}

async function verifyMercadoPago(order, paymentId) {
  const connection = await connectionFor(order, 'mercadopago');
  if (!decrypt(connection?.accessToken) || !paymentId) return false;
  const payment = await mercadoPagoFetch(connection, `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`).catch(() => null);
  if (!payment || payment.status !== 'approved' || Math.round(Number(payment.transaction_amount) * 100) !== order.totalCents || String(payment.external_reference) !== String(order.id) || String(payment.currency_id).toUpperCase() !== 'BRL') return false;
  await markPaid(order, { provider: 'mercadopago', paymentId: payment.id, proofUrl: payment.transaction_details?.external_resource_url || payment.point_of_interaction?.transaction_data?.ticket_url });
  return true;
}

async function verifyInfinitePay(order, data = {}) {
  const connection = await connectionFor(order, 'infinitepay');
  if (!connection) return false;
  const orderNsu = `catalog-${order.id}`;
  const transactionNsu = String(data.transaction_nsu || '');
  const slug = String(data.invoice_slug || data.slug || '');
  if (!transactionNsu || !slug) return false;
  const result = await infinitePay.checkPayment({ handle: connection.accountId, orderNsu, transactionNsu, slug });
  if (!result.paid || result.amount !== order.totalCents) return false;
  await markPaid(order, { provider: 'infinitepay', paymentId: transactionNsu, proofUrl: result.receiptUrl });
  return true;
}

export async function verifyOrderPayment(order, query = {}) {
  if (order.paymentStatus === 'paid') return true;
  if (order.paymentProvider === 'stripe') return verifyStripe(order, query.session_id || order.paymentId);
  if (order.paymentProvider === 'mercadopago') return verifyMercadoPago(order, query.payment_id || order.paymentId);
  if (order.paymentProvider === 'infinitepay') return verifyInfinitePay(order, query);
  return false;
}

function stripeEventValid(req) {
  const secret = config.catalogPayments.stripeWebhookSecret;
  const header = String(req.get('stripe-signature') || '');
  const timestamp = header.match(/(?:^|,)t=(\d+)/)?.[1];
  const signatures = [...header.matchAll(/(?:^|,)v1=([a-f0-9]+)/g)].map((m) => m[1]);
  if (!secret || !timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(req.rawBody).digest('hex');
  return signatures.some((signature) => safeEqual(signature, expected));
}

export async function handleStripeWebhook(req) {
  if (!stripeEventValid(req)) throw new AppError(400, 'Assinatura Stripe inválida.');
  const event = req.body;
  if (event?.type !== 'checkout.session.completed' && event?.type !== 'checkout.session.async_payment_succeeded') return;
  const session = event.data?.object;
  const orderId = Number(session?.metadata?.orderId);
  if (!Number.isInteger(orderId)) return;
  const order = await prisma.order.findFirst({ where: { id: orderId, paymentProvider: 'stripe' } });
  if (order && session?.payment_status === 'paid') await verifyStripe(order, session.id);
}

function mercadoPagoSignatureValid(req, paymentId) {
  const secret = config.catalogPayments.mercadoPagoWebhookSecret;
  const x = String(req.get('x-signature') || '');
  const requestId = String(req.get('x-request-id') || '');
  const ts = x.match(/(?:^|,)\s*ts=(\d+)/)?.[1];
  const v1 = x.match(/(?:^|,)\s*v1=([a-f0-9]+)/i)?.[1];
  if (!secret || !requestId || !ts || !v1 || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const manifest = `id:${String(paymentId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  return safeEqual(crypto.createHmac('sha256', secret).update(manifest).digest('hex'), v1);
}

export async function handleMercadoPagoWebhook(req) {
  const paymentId = req.query['data.id'] || req.body?.data?.id || req.body?.id;
  if (!paymentId || !mercadoPagoSignatureValid(req, paymentId)) throw new AppError(400, 'Assinatura Mercado Pago inválida.');
  const merchantId = req.body?.user_id || req.query.user_id;
  const rows = await prisma.catalogPaymentConnection.findMany({ where: { provider: 'mercadopago', ...(merchantId ? { accountId: String(merchantId) } : {}) } });
  for (const connection of rows) {
    if (!decrypt(connection.accessToken)) continue;
    const payment = await mercadoPagoFetch(connection, `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`).catch(() => null);
    if (!payment || !payment.external_reference) continue;
    const orderId = Number(payment.external_reference);
    if (!Number.isInteger(orderId)) continue;
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: connection.userId, storeId: connection.storeId, paymentProvider: 'mercadopago', paymentStatus: { not: 'paid' } },
    });
    if (!order || payment.status !== 'approved' || Math.round(Number(payment.transaction_amount) * 100) !== order.totalCents || String(payment.currency_id).toUpperCase() !== 'BRL') continue;
    await markPaid(order, { provider: 'mercadopago', paymentId: payment.id, proofUrl: payment.transaction_details?.external_resource_url || payment.point_of_interaction?.transaction_data?.ticket_url });
    break;
  }
}

export async function handleInfinitePayWebhook(body) {
  const orderNsu = String(body?.order_nsu || '');
  const id = Number(orderNsu.replace(/^catalog-/, ''));
  const order = Number.isInteger(id) ? await prisma.order.findFirst({ where: { id, paymentProvider: 'infinitepay' } }) : null;
  if (!order) return;
  if (!await verifyInfinitePay(order, body)) throw new AppError(503, 'A InfinitePay ainda não confirmou o valor total deste pedido.', 'PAYMENT_PENDING');
}

export function providerReady(provider) {
  if (!config.appUrl.startsWith('https://')) return false;
  if (provider === 'stripe') return Boolean(config.catalogPayments.stripeClientId && config.catalogPayments.stripeSecretKey && config.catalogPayments.stripeWebhookSecret);
  if (provider === 'mercadopago') return Boolean(config.catalogPayments.mercadoPagoClientId && config.catalogPayments.mercadoPagoClientSecret && config.catalogPayments.mercadoPagoWebhookSecret);
  return provider === 'infinitepay';
}
