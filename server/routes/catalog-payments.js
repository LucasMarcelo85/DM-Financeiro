import { Router } from 'express';
import { storeScope } from '../utils/store.js';
import {
  handleInfinitePayWebhook, infinitePayReady, paymentConnections, removeInfinitePayConnection, saveInfinitePayHandle,
} from '../services/catalog-payments.js';

export const catalogPaymentsRouter = Router();
export const catalogPaymentWebhooks = Router();

catalogPaymentsRouter.get('/', async (req, res) => {
  const storeId = await storeScope(req);
  const connections = await paymentConnections(req.user.id, storeId);
  res.json({
    providers: [{
      provider: 'infinitepay',
      connected: Boolean(connections.infinitepay),
      ready: infinitePayReady(),
      ...(connections.infinitepay ? { handle: connections.infinitepay.handle } : {}),
    }],
  });
});

catalogPaymentsRouter.put('/infinitepay', async (req, res) => {
  const storeId = await storeScope(req);
  await saveInfinitePayHandle(req.user.id, storeId, req.body?.handle);
  res.json({ ok: true });
});

catalogPaymentsRouter.delete('/infinitepay', async (req, res) => {
  const storeId = await storeScope(req);
  await removeInfinitePayConnection(req.user.id, storeId);
  res.json({ ok: true });
});

catalogPaymentWebhooks.post('/infinitepay', async (req, res) => {
  await handleInfinitePayWebhook(req.body || {});
  res.json({ received: true });
});
