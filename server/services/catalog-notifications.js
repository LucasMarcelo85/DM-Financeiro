import { prisma } from '../prisma.js';
import { defaultCatalogConfig } from '../utils/catalog.js';
import { normalizePhone } from '../utils/helpers.js';
import * as whatsapp from './whatsapp.js';

const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function catalogConfig(userId, storeId) {
  const row = storeId
    ? await prisma.store.findFirst({ where: { id: storeId, userId }, select: { config: true } })
    : await prisma.catalogSettings.findUnique({ where: { userId }, select: { config: true } });
  return { ...defaultCatalogConfig(), ...(row?.config || {}) };
}

export async function notifyCatalogOrder(order, event) {
  const cfg = await catalogConfig(order.userId, order.storeId);
  const notification = cfg.orderNotifications;
  if (!notification?.enabled) return false;
  const number = normalizePhone(cfg.whatsapp);
  if (!number || !Number.isInteger(notification.instanceId)) throw new Error('Configure o WhatsApp da loja e a instância de notificação.');

  const instance = await prisma.instance.findFirst({
    where: { id: notification.instanceId, userId: order.userId, purpose: 'envio' },
  });
  if (!instance) throw new Error('A instância de notificação não pertence mais a esta conta.');
  if (await whatsapp.getState(instance) !== 'open') throw new Error('A instância de notificação está desconectada.');

  const lines = (Array.isArray(order.items) ? order.items : [])
    .map((item) => `• ${item.qty}x ${item.name}${item.variation ? ` (${item.variation})` : ''} — ${brl(item.totalCents)}`);
  const text = event === 'paid'
    ? [`✅ *Pedido pago pela InfinitePay*`, `Pedido: *#${order.code}*`, `Cliente: ${order.customerName}`, `Total: *${brl(order.totalCents)}*`, order.paymentId ? `ID do pagamento: ${order.paymentId}` : ''].filter(Boolean).join('\n')
    : [`🛍️ *Novo pedido recebido*`, `Pedido: *#${order.code}*`, `Cliente: ${order.customerName} · ${order.customerPhone}`, ...lines, `Total: *${brl(order.totalCents)}*`, order.paymentStatus === 'pending' ? 'Pagamento online pendente.' : ''].filter(Boolean).join('\n');

  await whatsapp.sendText(instance, number, text);
  return true;
}
