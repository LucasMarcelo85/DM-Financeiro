import { config } from '../config.js';
import { AppError } from '../utils/helpers.js';

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${config.infinitepay.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(502, 'Não foi possível falar com a InfinitePay. Tente novamente em instantes.', 'INFINITEPAY_UNREACHABLE');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

export async function createCheckout({ orderNsu, description, amountCents, redirectUrl, webhookUrl, customer, handle = config.infinitepay.handle }) {
  const body = {
    handle,
    order_nsu: orderNsu,
    items: [{ quantity: 1, price: amountCents, description }],
    redirect_url: redirectUrl,
  };
  if (webhookUrl) body.webhook_url = webhookUrl;
  if (customer) body.customer = customer;

  const { ok, data } = await post('/links', body);
  const url = data?.url || data?.checkout_url || data?.link;
  if (!ok || !url) {
    throw new AppError(502, 'Não foi possível gerar o link de pagamento agora. Tente novamente em instantes.', 'INFINITEPAY_ERROR');
  }
  return url;
}

// Confirma com a InfinitePay se o pedido foi pago. Retorna { paid, amount }.
export async function checkPayment({ orderNsu, transactionNsu, slug, handle = config.infinitepay.handle }) {
  const { ok, data } = await post('/payment_check', {
    handle,
    order_nsu: orderNsu,
    transaction_nsu: transactionNsu,
    slug,
  });
  return {
    paid: Boolean(ok && data?.success !== false && data?.paid),
    amount: Number(data?.amount) || null,
    receiptUrl: data?.receipt_url || data?.receiptUrl || data?.receipt?.url || data?.receipt || '',
  };
}
