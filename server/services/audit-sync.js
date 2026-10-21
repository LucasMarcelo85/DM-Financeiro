import { prisma } from '../prisma.js';
import { config, evolutionConfigured } from '../config.js';
import { computeAccess } from './access.js';
import { listenerCount } from './audit-hub.js';
import * as evo from './evolution.js';
import { syncInstance } from './audit.js';
import { evolutionWebhookUrl } from '../utils/webhooks.js';

// A auditoria não depende só do webhook: o servidor também busca as mensagens na Evolution sozinho.
// Com alguém olhando a tela a busca é frequente (AUDIT_SYNC_SECONDS); sem ninguém, espaçada (AUDIT_SYNC_IDLE_SECONDS).
// A primeira busca de uma conexão traz o histórico todo, sem precisar clicar em nada.
const lastRun = new Map(); // conexão -> quando buscou pela última vez
const healed = new Set(); // conexões cujo webhook/configuração já foi reafirmado neste processo
let timer = null;
let ticking = false;

export async function auditSyncTick() {
  if (ticking || !evolutionConfigured()) return;
  ticking = true;
  try {
    const instances = await prisma.instance.findMany({ where: { purpose: 'auditoria', provider: 'evolution' }, include: { user: true } });
    const now = Date.now();
    for (const inst of instances) {
      if (!computeAccess(inst.user).hasAccess) continue;
      const every = listenerCount(inst.userId) > 0 ? config.auditSync.intervalMs : config.auditSync.idleMs;
      if (now - (lastRun.get(inst.id) || 0) < every) continue;
      lastRun.set(inst.id, now);
      // Cada conexão roda por conta própria: um histórico grande de uma não atrasa a tela ao vivo das outras.
      (async () => {
        try {
          if ((await evo.getState(inst.name)) !== 'open') return;
          if (!healed.has(inst.id)) {
            healed.add(inst.id); // reafirma o webhook e as configurações de auditoria (cura conexões criadas antes ou em outra versão da Evolution)
            await evo.setWebhook(inst.name, evolutionWebhookUrl(inst.name)).catch(() => {});
            await evo.setAuditSettings(inst.name).catch(() => {});
          }
          await syncInstance(inst, { deep: !inst.lastSyncAt });
        } catch (e) {
          console.warn(`[auditoria] busca automática de ${inst.name}: ${e.message}`);
        }
      })();
    }
  } catch (e) {
    console.error('[auditoria] erro na busca automática:', e);
  } finally {
    ticking = false;
  }
}

export function startAuditSync() {
  if (!config.auditSync.intervalMs) return;
  timer = setInterval(auditSyncTick, Math.min(config.auditSync.intervalMs, 5000));
  setTimeout(auditSyncTick, 2000);
}
export const stopAuditSync = () => clearInterval(timer);
