import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { prisma } from '../prisma.js';
import { decrypt } from '../utils/secret.js';

export const API_WEBHOOK_EVENTS = [
  'product.created', 'product.updated', 'product.deleted',
  'order.created', 'order.updated', 'order.paid',
  'customer.created', 'customer.updated',
];

const retryDelays = [30_000, 120_000, 600_000, 1_800_000, 3_600_000];
let timer = null;
let ticking = false;

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && address.split('.')[2] === '100')))
      || (a === 203 && b === 0 && address.split('.')[2] === '113'));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized !== '::' && normalized !== '::1'
      && !normalized.startsWith('fc') && !normalized.startsWith('fd')
      && !normalized.startsWith('fe8') && !normalized.startsWith('fe9')
      && !normalized.startsWith('fea') && !normalized.startsWith('feb')
      && !normalized.startsWith('ff')
      && !normalized.startsWith('::ffff:');
  }
  return false;
}

export async function resolveWebhookTarget(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('URL inválida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw new Error('Informe uma URL HTTPS pública, sem usuário ou senha.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('A URL precisa apontar para um endereço público.');
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('A URL precisa apontar exclusivamente para endereços IP públicos.');
  }
  const target = addresses.find(({ family }) => family === 4) || addresses[0];
  return { url, address: target.address, family: target.family };
}

function sendPayload(rawUrl, secret, payload) {
  return resolveWebhookTarget(rawUrl).then(({ url, address, family }) => new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const req = https.request({
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      servername: net.isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
      lookup: (_host, _options, callback) => callback(null, address, family),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-DM-Event': payload.event,
        'X-DM-Delivery': payload.id,
        'X-DM-Signature': `sha256=${signature}`,
      },
    }, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.statusCode);
        reject(Object.assign(new Error(`Destino respondeu HTTP ${res.statusCode}.`), { status: res.statusCode }));
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('Tempo limite ao chamar o webhook.')));
    req.on('error', reject);
    req.end(body);
  }));
}

export async function emitApiWebhook({ userId, storeId = null, event, data }) {
  if (!API_WEBHOOK_EVENTS.includes(event)) return;
  const endpoints = await prisma.apiWebhookEndpoint.findMany({ where: { userId, storeId } });
  const payloads = endpoints
    .filter((endpoint) => Array.isArray(endpoint.events) && endpoint.events.includes(event))
    .map((endpoint) => ({
      endpointId: endpoint.id,
      eventId: crypto.randomUUID(),
      event,
    }))
    .map((delivery) => ({
      ...delivery,
      payload: { id: delivery.eventId, event, createdAt: new Date().toISOString(), data },
    }));
  if (payloads.length) await prisma.apiWebhookDelivery.createMany({ data: payloads });
}

export async function deliverApiWebhooks() {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();
    const due = await prisma.apiWebhookDelivery.findMany({
      where: { status: 'queued', nextAttemptAt: { lte: now } },
      orderBy: { id: 'asc' },
      take: 20,
      include: { endpoint: true },
    });
    for (const item of due) {
      const leaseUntil = new Date(Date.now() + 300_000);
      const claimed = await prisma.apiWebhookDelivery.updateMany({
        where: { id: item.id, status: 'queued', nextAttemptAt: { lte: now } },
        data: { attempts: { increment: 1 }, nextAttemptAt: leaseUntil },
      });
      if (!claimed.count) continue;
      const attempt = item.attempts + 1;
      try {
        const status = await sendPayload(item.endpoint.url, decrypt(item.endpoint.secret), item.payload);
        await prisma.apiWebhookDelivery.update({
          where: { id: item.id },
          data: { status: 'delivered', lastStatus: status, lastError: null, deliveredAt: new Date() },
        });
      } catch (error) {
        const terminal = attempt >= retryDelays.length;
        const delay = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)];
        await prisma.apiWebhookDelivery.update({
          where: { id: item.id },
          data: {
            status: terminal ? 'failed' : 'queued',
            nextAttemptAt: terminal ? leaseUntil : new Date(Date.now() + delay),
            lastStatus: error.status || null,
            lastError: String(error.message || 'Falha ao enviar webhook.').slice(0, 500),
          },
        });
        console.error(`[api-webhook] entrega ${item.id} (${item.event}) falhou: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('[api-webhook] erro ao processar fila:', error);
  } finally {
    ticking = false;
  }
}

export function startApiWebhookWorker() {
  if (timer) return;
  timer = setInterval(deliverApiWebhooks, 5000);
  timer.unref?.();
  deliverApiWebhooks();
}

export function stopApiWebhookWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
