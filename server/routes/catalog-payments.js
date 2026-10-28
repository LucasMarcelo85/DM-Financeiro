import { Router } from 'express';
import { AppError } from '../utils/helpers.js';
import { storeScope } from '../utils/store.js';
import { config } from '../config.js';
import {
  finishOAuth, handleInfinitePayWebhook, handleMercadoPagoWebhook, handleStripeWebhook,
  paymentConnections, providerReady, removeConnection, saveInfinitePayHandle, startOAuth,
} from '../services/catalog-payments.js';

export const catalogPaymentsRouter = Router();
export const catalogPaymentCallbacks = Router();
export const catalogPaymentWebhooks = Router();

catalogPaymentsRouter.get('/', async (req, res) => {
  const storeId = await storeScope(req);
  const connections = await paymentConnections(req.user.id, storeId);
  res.json({
    providers: ['stripe', 'mercadopago', 'infinitepay'].map((provider) => ({
      provider, connected: Boolean(connections[provider]), ready: providerReady(provider),
      ...(provider === 'infinitepay' && connections[provider] ? { handle: connections[provider].handle } : {}),
    })),
  });
});

catalogPaymentsRouter.get('/connect/:provider', async (req, res) => {
  const storeId = await storeScope(req);
  res.json({ url: await startOAuth(req.user.id, storeId, req.params.provider) });
});

catalogPaymentsRouter.put('/infinitepay', async (req, res) => {
  const storeId = await storeScope(req);
  await saveInfinitePayHandle(req.user.id, storeId, req.body?.handle);
  res.json({ ok: true });
});

catalogPaymentsRouter.delete('/:provider', async (req, res) => {
  const provider = String(req.params.provider || '');
  if (!['stripe', 'mercadopago', 'infinitepay'].includes(provider)) throw new AppError(400, 'Provedor inválido.');
  const storeId = await storeScope(req);
  await removeConnection(req.user.id, storeId, provider);
  res.json({ ok: true });
});

catalogPaymentCallbacks.get('/:provider', async (req, res) => {
  const provider = String(req.params.provider || '');
  if (!['stripe', 'mercadopago'].includes(provider)) throw new AppError(400, 'Provedor inválido.');
  if (req.query.error) return res.redirect(`${config.appUrl}/pedidos?catalog_payment=error`);
  const saved = await finishOAuth(provider, req.query.state, req.query.code);
  res.redirect(`${config.appUrl}/pedidos?catalog_payment=connected&store=${encodeURIComponent(saved.storeId || '')}`);
});

catalogPaymentWebhooks.post('/stripe', async (req, res) => {
  await handleStripeWebhook(req);
  res.json({ received: true });
});
catalogPaymentWebhooks.post('/mercadopago', async (req, res) => {
  await handleMercadoPagoWebhook(req);
  res.json({ received: true });
});
catalogPaymentWebhooks.post('/infinitepay', async (req, res) => {
  await handleInfinitePayWebhook(req.body || {});
  res.json({ received: true });
});
