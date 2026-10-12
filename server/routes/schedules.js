import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError, normalizePhone } from '../utils/helpers.js';
import { TIME_RE, firstOccurrence, parseISODate } from '../utils/schedule.js';
import { scheduleDTO } from '../utils/serialize.js';
import { deliver, instanceCandidates, logMessage, pickOpenInstance, renderFor } from '../services/dispatcher.js';

const router = Router();
const KINDS = ['cobranca', 'lembrete'];
const NAMES = { cobranca: 'cobrança', lembrete: 'lembrete' };
const PAST_MSG = 'Esse dia e horário de envio já passaram. Escolha uma data futura ou use "Enviar agora".';
const include = { contact: true };

async function getOwned(req) {
  const id = Number(req.params.id);
  const s = Number.isInteger(id) ? await prisma.schedule.findFirst({ where: { id, userId: req.user.id }, include }) : null;
  if (!s) throw new AppError(404, 'Item não encontrado.');
  return s;
}

function parseFields(body, kind) {
  const recurrence = body.recurrence === 'mensal' ? 'mensal' : body.recurrence === 'avulsa' ? 'avulsa' : null;
  if (!recurrence) throw new AppError(400, 'Escolha se é avulso ou mensal.');

  const dueDate = parseISODate(body.dueDate);
  if (!dueDate) throw new AppError(400, 'Informe a data do vencimento.');

  const daysBefore = Number(body.daysBefore ?? 0);
  if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 30) throw new AppError(400, 'Os dias de antecedência devem ficar entre 0 e 30.');

  const sendTime = String(body.sendTime || '09:00');
  if (!TIME_RE.test(sendTime)) throw new AppError(400, 'Horário inválido. Use o formato 09:00.');

  const text = String(body.text || '').trim();
  if (!text) throw new AppError(400, 'Escreva o texto da mensagem.');
  if (text.length > 4000) throw new AppError(400, 'O texto é muito longo (máximo de 4.000 caracteres).');

  const extra = String(body.extra || '').trim() || null;
  if (extra && extra.length > 1000) throw new AppError(400, 'O link ou chave Pix é muito longo.');

  let amountCents = null;
  if (kind === 'cobranca') {
    amountCents = Number(body.amountCents);
    if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 100_000_000) throw new AppError(400, 'Informe o valor da cobrança.');
  }

  const sendNow = body.sendMode === 'agora';
  if (sendNow && recurrence === 'mensal') throw new AppError(400, 'Enviar agora só vale para envio avulso.');

  return { recurrence, dueDate, daysBefore, sendTime, text, extra, amountCents, sendNow };
}

async function resolveInstanceId(userId, value) {
  if (value == null || value === '') return null;
  const id = Number(value);
  const inst = Number.isInteger(id) ? await prisma.instance.findFirst({ where: { id, userId } }) : null;
  if (!inst) throw new AppError(400, 'WhatsApp inválido.');
  return inst.id;
}

async function resolveContact(userId, body) {
  if (body.contactId != null && body.contactId !== '') {
    const c = await prisma.contact.findFirst({ where: { id: Number(body.contactId) || 0, userId } });
    if (!c) throw new AppError(400, 'Cliente não encontrado. Escolha outro.');
    return c;
  }
  const nc = body.newContact;
  if (nc && typeof nc === 'object') {
    const name = String(nc.name || '').trim();
    const phone = normalizePhone(nc.phone);
    if (name.length < 2 || name.length > 120) throw new AppError(400, 'Informe o nome do cliente.');
    if (!phone) throw new AppError(400, 'Número do cliente inválido. Use DDD + número.');
    // Já salva o cliente para as próximas vezes (se o número já existir, reaproveita).
    return prisma.contact.upsert({ where: { userId_phone: { userId, phone } }, update: {}, create: { userId, name, phone } });
  }
  throw new AppError(400, 'Escolha o cliente.');
}

router.get('/', async (req, res) => {
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : undefined;
  const q = String(req.query.q || '').trim();
  const rows = await prisma.schedule.findMany({
    where: { userId: req.user.id, ...(kind ? { kind } : {}), ...(q ? { contact: { name: { contains: q, mode: 'insensitive' } } } : {}) },
    include,
    orderBy: [{ status: 'asc' }, { nextRunAt: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
    take: 500,
  });
  res.json({ schedules: rows.map(scheduleDTO) });
});

router.get('/:id', async (req, res) => {
  res.json({ schedule: scheduleDTO(await getOwned(req)) });
});

router.post('/', async (req, res) => {
  const kind = req.body?.kind;
  if (!KINDS.includes(kind)) throw new AppError(400, 'Tipo inválido.');
  const f = parseFields(req.body, kind);
  const instanceId = await resolveInstanceId(req.user.id, req.body.instanceId);

  let occ = null;
  if (!f.sendNow) {
    occ = firstOccurrence(f);
    if (!occ) throw new AppError(400, PAST_MSG);
  }
  const contact = await resolveContact(req.user.id, req.body);

  const base = {
    userId: req.user.id, contactId: contact.id, instanceId, kind, recurrence: f.recurrence, amountCents: f.amountCents,
    text: f.text, extra: f.extra, dueDate: f.dueDate, daysBefore: f.daysBefore, sendTime: f.sendTime,
  };

  if (!f.sendNow) {
    const s = await prisma.schedule.create({ data: { ...base, nextDueDate: occ.nextDueDate, nextRunAt: occ.nextRunAt, status: 'ativa' }, include });
    return res.status(201).json({ schedule: scheduleDTO(s) });
  }

  // Enviar agora: confere o WhatsApp, envia e guarda o registro como concluído.
  const instances = await prisma.instance.findMany({ where: { userId: req.user.id }, orderBy: { id: 'asc' } });
  const { instance } = await pickOpenInstance(instanceCandidates({ instanceId }, instances));
  if (!instance) throw new AppError(409, 'Nenhum WhatsApp conectado. Conecte seu WhatsApp e tente de novo.', 'WHATSAPP_DISCONNECTED');

  const created = await prisma.schedule.create({ data: { ...base, nextDueDate: f.dueDate, status: 'concluida' }, include });
  const { text, extra } = renderFor(created, contact, f.dueDate);
  let result;
  try {
    result = await deliver(instance.name, contact.phone, text, extra);
  } catch (e) {
    await logMessage({ schedule: created, contact, instanceName: instance.name, status: 'failed', error: e.message, automatic: false });
    await prisma.schedule.delete({ where: { id: created.id } });
    throw e;
  }
  await logMessage({ schedule: created, contact, instanceName: instance.name, status: result.status, error: result.error, automatic: false });
  const done = await prisma.schedule.update({
    where: { id: created.id },
    data: { lastRunAt: new Date(), lastStatus: result.status, lastError: result.error, sentCount: 1 },
    include,
  });
  res.status(201).json({ schedule: scheduleDTO(done), partial: result.status === 'partial', warning: result.error });
});

router.patch('/:id', async (req, res) => {
  const current = await getOwned(req);
  const f = parseFields({ ...req.body, sendMode: 'agendar' }, current.kind);
  const instanceId = await resolveInstanceId(req.user.id, req.body.instanceId);
  const occ = firstOccurrence(f);
  const paused = current.status === 'pausada';
  if (!occ && !paused) throw new AppError(400, PAST_MSG);

  const hasContact = (req.body.contactId != null && req.body.contactId !== '') || req.body.newContact;
  const contact = hasContact ? await resolveContact(req.user.id, req.body) : null;

  const s = await prisma.schedule.update({
    where: { id: current.id },
    data: {
      ...(contact ? { contactId: contact.id } : {}),
      instanceId, recurrence: f.recurrence, amountCents: f.amountCents, text: f.text, extra: f.extra,
      dueDate: f.dueDate, daysBefore: f.daysBefore, sendTime: f.sendTime,
      nextDueDate: occ?.nextDueDate ?? null, nextRunAt: occ?.nextRunAt ?? null,
      status: paused ? 'pausada' : 'ativa', attempts: 0, lastError: null,
    },
    include,
  });
  res.json({ schedule: scheduleDTO(s) });
});

router.post('/:id/pause', async (req, res) => {
  const s = await getOwned(req);
  if (s.status !== 'ativa') throw new AppError(409, 'Só dá para pausar um envio ativo.');
  res.json({ schedule: scheduleDTO(await prisma.schedule.update({ where: { id: s.id }, data: { status: 'pausada' }, include })) });
});

router.post('/:id/resume', async (req, res) => {
  const s = await getOwned(req);
  if (s.status !== 'pausada') throw new AppError(409, 'Este envio não está pausado.');
  const occ = firstOccurrence(s);
  if (!occ) throw new AppError(409, `A data deste envio já passou. Edite a ${NAMES[s.kind]} e escolha uma nova data.`);
  const updated = await prisma.schedule.update({
    where: { id: s.id },
    data: { status: 'ativa', nextDueDate: occ.nextDueDate, nextRunAt: occ.nextRunAt, attempts: 0, lastError: null },
    include,
  });
  res.json({ schedule: scheduleDTO(updated) });
});

router.post('/:id/send-now', async (req, res) => {
  const s = await getOwned(req);
  const instances = await prisma.instance.findMany({ where: { userId: req.user.id }, orderBy: { id: 'asc' } });
  const { instance } = await pickOpenInstance(instanceCandidates(s, instances));
  if (!instance) throw new AppError(409, 'Nenhum WhatsApp conectado. Conecte seu WhatsApp e tente de novo.', 'WHATSAPP_DISCONNECTED');

  const { text, extra } = renderFor(s, s.contact, s.nextDueDate ?? s.dueDate);
  let result;
  try {
    result = await deliver(instance.name, s.contact.phone, text, extra);
  } catch (e) {
    await logMessage({ schedule: s, contact: s.contact, instanceName: instance.name, status: 'failed', error: e.message, automatic: false });
    throw e;
  }
  await logMessage({ schedule: s, contact: s.contact, instanceName: instance.name, status: result.status, error: result.error, automatic: false });

  // Envio avulso enviado agora não deve ser enviado de novo no horário agendado.
  const closes = s.recurrence === 'avulsa' && s.status === 'ativa';
  const updated = await prisma.schedule.update({
    where: { id: s.id },
    data: { lastRunAt: new Date(), lastStatus: result.status, lastError: result.error, sentCount: { increment: 1 }, ...(closes ? { status: 'concluida', nextRunAt: null } : {}) },
    include,
  });
  res.json({ schedule: scheduleDTO(updated), partial: result.status === 'partial', warning: result.error });
});

router.delete('/:id', async (req, res) => {
  const s = await getOwned(req);
  await prisma.schedule.delete({ where: { id: s.id } });
  res.json({ ok: true });
});

export default router;
