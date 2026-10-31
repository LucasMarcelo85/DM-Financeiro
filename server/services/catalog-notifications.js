import { prisma } from '../prisma.js';
import { defaultCatalogConfig } from '../utils/catalog.js';
import { normalizePhone } from '../utils/helpers.js';
import * as whatsapp from './whatsapp.js';

const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function catalogConfig(userId, storeId) {
  if (storeId) {
    const store = await prisma.store.findFirst({ where: { id: storeId, userId }, select: { config: true } });
    return { ...defaultCatalogConfig(), ...(store?.config || {}) };
  }
  const row = await prisma.catalogSettings.findUnique({ where: { userId }, select: { config: true } });
  return { ...defaultCatalogConfig(), ...(row?.config || {}) };
}

export async function notifyCatalogOrder(order, event) {
  if (order.source !== 'catalog') return false;
  const cfg = await catalogConfig(order.userId, order.storeId);
  const notification = cfg.orderNotifications;
  if (!notification?.enabled) return false;
  const number = normalizePhone(cfg.whatsapp);
  if (!number || !Number.isInteger(notification.instanceId)) throw new Error('Configure o WhatsApp da loja para receber notificações e a instância de envio.');

  const instance = await prisma.instance.findFirst({
    where: {
      id: notification.instanceId, userId: order.userId, purpose: 'envio',
      ...(order.storeId === null ? { storeId: null } : { OR: [{ storeId: null }, { storeId: order.storeId }] }),
    },
  });

  const lines = (Array.isArray(order.items) ? order.items : [])
    .map((item) => `• ${item.qty}x ${item.name}${item.variation ? ` (${item.variation})` : ''} — ${brl(item.totalCents)}`);
  const text = event === 'paid'
    ? [`✅ *Pedido pago pela InfinitePay*`, `Pedido: *#${order.code}*`, `Cliente: ${order.customerName}`, `Total: *${brl(order.totalCents)}*`, order.paymentId ? `ID do pagamento: ${order.paymentId}` : ''].filter(Boolean).join('\n')
    : [`🛍️ *Novo pedido recebido*`, `Pedido: *#${order.code}*`, `Cliente: ${order.customerName} · ${order.customerPhone}`, ...lines, `Total: *${brl(order.totalCents)}*`, order.paymentStatus === 'pending' ? 'Pagamento online pendente.' : ''].filter(Boolean).join('\n');

  let primaryError;
  try {
    if (!instance) throw new Error('A instância principal de notificação não pertence mais à conta ou a esta loja.');
    if (await whatsapp.getState(instance) !== 'open') throw new Error('A instância principal de notificação está desconectada.');
    await whatsapp.sendText(instance, number, text);
    return true;
  } catch (error) {
    primaryError = error;
  }

  if (!notification.fallbackEnabled || !notification.fallbackInstanceId) throw primaryError;
  const fallback = await prisma.instance.findFirst({
    where: {
      id: notification.fallbackInstanceId, userId: order.userId, purpose: 'envio', storeId: null,
    },
  });
  if (!fallback) throw new Error(`Falha na instância da loja (${primaryError.message}) e a instância reserva não pertence mais à conta do administrador.`);
  try {
    if (await whatsapp.getState(fallback) !== 'open') throw new Error('A instância reserva do administrador está desconectada.');
    await whatsapp.sendText(fallback, number, text);
    return true;
  } catch (fallbackError) {
    throw new Error(`Falha no envio pela instância da loja (${primaryError.message}) e pela instância reserva (${fallbackError.message}).`);
  }
}
