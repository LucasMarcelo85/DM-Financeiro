import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { loadPlans } from '../plans.js';
import { loadAddons } from '../addons.js';
import * as evo from './evolution.js';
import { DAY } from '../utils/helpers.js';
import { recountUnread, retentionCutoff } from './audit.js';

// Faxina periódica do banco:
//  - mensagens da auditoria com mais de 60 dias são apagadas (junto com as fotos/áudios delas), para o banco não encher;
//  - conversas que ficaram vazias (sem mensagens, sem anotação e sem etiqueta) também saem;
//  - pedidos arquivados há mais de 20 dias são apagados;
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

// Pedidos do catálogo, inclusive os arquivados, saem do banco após 20 dias.
export async function purgeOldOrders(now = Date.now()) {
  const cutoff = new Date(now - config.orderRetentionDays * DAY);
  const r = await prisma.order.deleteMany({ where: { deletedAt: { lt: cutoff } } });
  return r.count;
}

// Só roda se EXPIRED_ACCOUNT_DAYS > 0: apaga contas cuja licença venceu há mais que isso (e remove as instâncias na Evolution).
export async function purgeExpiredAccounts(now = Date.now()) {
  if (!config.expiredAccountDays) return 0;
  const cutoff = new Date(now - config.expiredAccountDays * DAY);
  const users = await prisma.user.findMany({
    where: { role: 'usuario', trialEndsAt: { lt: cutoff }, OR: [{ accessUntil: null }, { accessUntil: { lt: cutoff } }] },
    select: { id: true },
  });
  for (const u of users) {
    const instances = await prisma.instance.findMany({ where: { userId: u.id, provider: 'evolution' }, select: { name: true } });
    await Promise.all(instances.map((i) => evo.deleteInstance(i.name).catch(() => {})));
    await prisma.user.delete({ where: { id: u.id } });
  }
  if (users.length) console.log(`[manutenção] ${users.length} contas com licença vencida há mais de ${config.expiredAccountDays} dias foram apagadas.`);
  return users.length;
}

export async function runMaintenance() {
  if (running) return;
  running = true;
  try {
    const removed = await purgeOldAuditMessages();
    if (removed) console.log(`[manutenção] ${removed} mensagens da auditoria com mais de ${config.auditRetentionDays} dias foram apagadas.`);
    const orders = await purgeOldOrders();
    if (orders) console.log(`[manutenção] ${orders} pedidos arquivados há mais de ${config.orderRetentionDays} dias foram apagados.`);
    await prisma.verificationCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await prisma.userAddon.deleteMany({ where: { paidUntil: { lt: new Date(Date.now() - 30 * DAY) } } }); // limite extra vencido há mais de 30 dias é perdido
    await loadPlans();
    await loadAddons();
    await purgeExpiredAccounts();
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
