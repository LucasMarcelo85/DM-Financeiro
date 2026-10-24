import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { loadPlans } from '../plans.js';
import { DAY } from '../utils/helpers.js';
import { recountUnread, retentionCutoff } from './audit.js';

// Faxina periódica do banco:
//  - mensagens da auditoria com mais de 60 dias são apagadas (junto com as fotos/áudios delas), para o banco não encher;
//  - conversas que ficaram vazias (sem mensagens, sem anotação e sem etiqueta) também saem;
//  - pedidos do catálogo com mais de 10 dias são apagados;
//  - códigos de confirmação vencidos são removidos;
//  - os planos são relidos do banco (caso outra instância do sistema tenha alterado).
const EVERY_MS = 60 * 60 * 1000; // a cada hora
const BATCH = 2000;
let timer = null;
let running = false;

// Apaga, em lotes, as mensagens da auditoria mais velhas que o prazo. Devolve quantas foram apagadas.
export async function purgeOldAuditMessages(now = Date.now()) {
  const cutoff = new Date(retentionCutoff(now));
  const touched = new Set();
  let removed = 0;
  for (;;) {
    const rows = await prisma.auditMessage.findMany({ where: { ts: { lt: cutoff } }, select: { id: true, chatId: true }, take: BATCH });
    if (!rows.length) break;
    await prisma.auditMessage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }); // a mídia sai junto (ON DELETE CASCADE)
    rows.forEach((r) => touched.add(r.chatId));
    removed += rows.length;
    if (rows.length < BATCH) break;
  }
  if (!removed) return 0;

  // Contador de "não lidas" das conversas que perderam mensagens.
  const chats = await prisma.auditChat.findMany({ where: { id: { in: [...touched] }, unread: { gt: 0 } }, select: { id: true } });
  for (const c of chats) await recountUnread(c.id).catch(() => {});

  // Conversas vazias (criadas há mais de 1 hora, para não apagar uma que está sendo criada agora).
  await prisma.auditChat.deleteMany({
    where: { id: { in: [...touched] }, createdAt: { lt: new Date(now - 60 * 60 * 1000) }, messages: { none: {} }, note: '', labels: { none: {} } },
  });
  return removed;
}

// Pedidos do catálogo com mais de 10 dias saem do banco.
export async function purgeOldOrders(now = Date.now()) {
  const r = await prisma.order.deleteMany({ where: { createdAt: { lt: new Date(now - config.orderRetentionDays * DAY) } } });
  return r.count;
}

export async function runMaintenance() {
  if (running) return;
  running = true;
  try {
    const removed = await purgeOldAuditMessages();
    if (removed) console.log(`[manutenção] ${removed} mensagens da auditoria com mais de ${config.auditRetentionDays} dias foram apagadas.`);
    const orders = await purgeOldOrders();
    if (orders) console.log(`[manutenção] ${orders} pedidos com mais de ${config.orderRetentionDays} dias foram apagados.`);
    await prisma.verificationCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await loadPlans();
  } catch (e) {
    console.error('[manutenção] falha no ciclo:', e.message);
  } finally {
    running = false;
  }
}

export function startMaintenance() {
  if (timer) return;
  timer = setInterval(runMaintenance, EVERY_MS);
  timer.unref?.();
  setTimeout(runMaintenance, 20_000).unref?.();
}
export const stopMaintenance = () => clearInterval(timer);
