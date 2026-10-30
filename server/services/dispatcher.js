import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { sleep } from '../utils/helpers.js';
import { occurrenceAfter } from '../utils/schedule.js';
import { renderTemplate } from '../utils/template.js';
import { accessibleUserFilter } from './access.js';
import { isTrialUser } from '../plans.js';
import * as wa from './whatsapp.js';

const MAX_LATE_MS = 6 * 60 * 60 * 1000; // passou de 6h do horário: não envia cobrança "velha"
const RETRY_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const LEASE_MS = 10 * 60 * 1000;
const deliveryQueues = new Map();

// Escolhe o primeiro WhatsApp conectado (o preferido do agendamento vem primeiro).
export async function pickOpenInstance(candidates) {
  let lastError = null;
  for (const inst of candidates) {
    try {
      if ((await wa.getState(inst)) === 'open') return { instance: inst, error: null };
    } catch (e) {
      lastError = e.message;
    }
  }
  return { instance: null, error: lastError };
}

export const instanceCandidates = (schedule, userInstances) => {
  const preferred = userInstances.find((i) => i.id === schedule.instanceId);
  return preferred ? [preferred, ...userInstances.filter((i) => i.id !== preferred.id)] : userInstances;
};

// Envia o texto e, se houver, o link/Pix em uma segunda mensagem.
// Lança erro se o texto falhar; devolve 'partial' se só o link/Pix falhar.
export async function deliver(instance, number, text, extra) {
  const key = String(instance.id || instance.name);
  const queue = deliveryQueues.get(key) || { tail: Promise.resolve(), lastSentAt: 0 };
  const current = queue.tail.then(async () => {
    const textWait = queue.lastSentAt + config.evolution.messageDelayMs - Date.now();
    if (textWait > 0) await sleep(textWait);
    try {
      await wa.sendText(instance, number, text);
    } finally {
      queue.lastSentAt = Date.now();
    }
    if (!extra) return { status: 'sent', error: null };
    try {
      const extraWait = queue.lastSentAt + config.evolution.messageDelayMs - Date.now();
      if (extraWait > 0) await sleep(extraWait);
      try {
        await wa.sendText(instance, number, extra);
      } finally {
        queue.lastSentAt = Date.now();
      }
      return { status: 'sent', error: null };
    } catch (e) {
      return { status: 'partial', error: `O texto foi enviado, mas o link/Pix não: ${e.message}` };
    }
  })();
  queue.tail = current.then(() => undefined, () => undefined);
  deliveryQueues.set(key, queue);
  return current;
}

const TRIAL_NOTICE = 'Mensagem de teste DM Digital.\nAdquira um plano para remover esta mensagem automática.';
const withTrialNotice = (text, user) => (isTrialUser(user) ? `${TRIAL_NOTICE}\n\n${text}` : text);

export const renderFor = (schedule, contact, dueDate, user) => ({
  text: withTrialNotice(renderTemplate(schedule.text, { name: contact.name, amountCents: schedule.amountCents, dueDate }), user),
  extra: schedule.extra ? withTrialNotice(renderTemplate(schedule.extra, { name: contact.name, amountCents: schedule.amountCents, dueDate }), user) : null,
});

export function logMessage({ schedule, contact, instanceName, status, error, automatic }) {
  return prisma.message.create({
    data: {
      userId: schedule.userId,
      contactId: contact.id,
      scheduleId: schedule.id,
      contactName: contact.name,
      instanceName,
      kind: schedule.kind,
      number: contact.phone,
      hasExtra: Boolean(schedule.extra),
      status,
      error,
      automatic,
    },
  });
}

// Atualiza o agendamento depois de uma tentativa final (enviada ou não).
async function finalize(schedule, status, error, now) {
  const data = {
    lastRunAt: now,
    lastStatus: status,
    lastError: error,
    attempts: 0,
    sentCount: schedule.sentCount + (status === 'failed' ? 0 : 1),
  };
  if (schedule.recurrence === 'mensal') {
    const next = occurrenceAfter(schedule, now);
    Object.assign(data, next ? { nextDueDate: next.nextDueDate, nextRunAt: next.nextRunAt } : { nextRunAt: null, status: 'concluida' });
  } else {
    Object.assign(data, { status: 'concluida', nextRunAt: null });
  }
  await prisma.schedule.update({ where: { id: schedule.id }, data });
}

// Cobrança cujo vencimento já foi marcado como pago: não cobra de novo, só passa para a próxima data.
async function skipPaid(schedule, now) {
  const data = { attempts: 0 };
  if (schedule.recurrence === 'mensal') {
    const next = occurrenceAfter(schedule, now);
    Object.assign(data, next ? { nextDueDate: next.nextDueDate, nextRunAt: next.nextRunAt } : { nextRunAt: null, status: 'concluida' });
  } else {
    Object.assign(data, { status: 'concluida', nextRunAt: null });
  }
  await prisma.schedule.update({ where: { id: schedule.id }, data });
}

async function processOne(s, originalRunAt) {
  const now = new Date();
  const contact = s.contact;
  const dueDate = s.nextDueDate ?? s.dueDate;

  if (s.kind === 'cobranca' && (await prisma.billingPayment.findFirst({ where: { scheduleId: s.id, dueDate }, select: { id: true } }))) {
    return skipPaid(s, now);
  }

  if (now - originalRunAt > MAX_LATE_MS) {
    const error = 'O horário do envio passou (o sistema ficou parado ou o acesso estava bloqueado) e a mensagem não foi enviada.';
    await logMessage({ schedule: s, contact, instanceName: '-', status: 'failed', error, automatic: true });
    return finalize(s, 'failed', error, now);
  }

  const { instance, error: stateError } = await pickOpenInstance(instanceCandidates(s, s.user.instances));
  let failure = instance ? null : stateError || 'Nenhum WhatsApp conectado no momento do envio.';
  let result = null;

  if (instance) {
    const { text, extra } = renderFor(s, contact, dueDate, s.user);
    try {
      result = await deliver(instance, contact.phone, text, extra);
    } catch (e) {
      failure = e.message;
    }
  }

  if (result) {
    await logMessage({ schedule: s, contact, instanceName: instance.name, status: result.status, error: result.error, automatic: true });
    return finalize(s, result.status, result.error, now);
  }

  // Falhou: tenta de novo em 15 min, até 4 vezes; depois desiste e registra.
  const attempts = s.attempts + 1;
  if (attempts < MAX_ATTEMPTS) {
    await prisma.schedule.update({
      where: { id: s.id },
      data: { attempts, lastError: failure, nextRunAt: new Date(now.getTime() + RETRY_MS) },
    });
    return;
  }
  await logMessage({ schedule: s, contact, instanceName: instance?.name ?? '-', status: 'failed', error: failure, automatic: true });
  return finalize(s, 'failed', failure, now);
}

// Roda um ciclo: envia tudo que já está no horário.
export async function runDueSchedules() {
  const now = new Date();
  const due = await prisma.schedule.findMany({
    where: { status: 'ativa', nextRunAt: { lte: now }, user: accessibleUserFilter(now) },
    orderBy: { nextRunAt: 'asc' },
    take: 25,
    include: { contact: true, user: { include: { instances: { where: { purpose: 'envio' }, orderBy: { id: 'asc' } } } } },
  });

  for (const s of due) {
    // "Reserva" o item: se outro processo pegou primeiro, este pula (evita envio duplicado).
    const claimed = await prisma.schedule.updateMany({
      where: { id: s.id, status: 'ativa', nextRunAt: s.nextRunAt },
      data: { nextRunAt: new Date(Date.now() + LEASE_MS) },
    });
    if (claimed.count !== 1) continue;
    try {
      await processOne(s, s.nextRunAt);
    } catch (e) {
      console.error(`[agenda] erro no agendamento ${s.id}:`, e);
    }
  }
  return due.length;
}
