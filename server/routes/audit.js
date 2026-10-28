import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError, DAY, onlyDigits } from '../utils/helpers.js';
import { config } from '../config.js';
import { limitsFor } from '../plans.js';
import * as wa from '../services/whatsapp.js';
import { subscribe } from '../services/audit-hub.js';
import { chatDTO, ensureMedia, markChatSeen, messageDTO, recordMessage, searchTerms, senderNames } from '../services/audit.js';

const router = Router();
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_LABELS = 40;
const MAX_NOTE = 20000;
const MAX_SEND = 4000;

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const int = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : null);
const scopeOf = (req) => req.forcedAuditScope || (/^store:\d+$/.test(String(req.query.scope || '')) ? String(req.query.scope) : 'main');

router.use(async (req, _res, next) => {
  const scope = scopeOf(req);
  if (scope.startsWith('store:')) {
    const storeId = Number(scope.slice('store:'.length));
    if (!Number.isInteger(storeId) || limitsFor(req.user).stores < 1) {
      throw new AppError(403, 'A Auditoria do app não está incluída no plano desta loja.', 'SCOPE_NOT_IN_PLAN');
    }
    const store = await prisma.store.findFirst({ where: { id: storeId, userId: req.user.id, appEnabled: true }, select: { id: true } });
    if (!store || (req.forcedAuditScope && req.forcedAuditScope !== scope)) {
      throw new AppError(404, 'Aplicativo da loja não encontrado.');
    }
  }
  req.validatedAuditScope = scope;
  next();
});

function assertScopeAccess(req) {
  return req.validatedAuditScope || 'main';
}

// Filtro de período da auditoria: 7, 30 ou 60 dias (60 = tudo que fica guardado; o que passa disso é apagado sozinho).
const RANGES = [7, 30, 60];
const sinceOf = (v) => {
  const n = int(v);
  const days = RANGES.includes(n) ? n : config.auditRetentionDays;
  return new Date(Date.now() - days * DAY);
};

async function ownChat(req, id = req.params.id) {
  const n = int(id);
  const auditScope = assertScopeAccess(req);
  const chat = n ? await prisma.auditChat.findFirst({ where: { id: n, userId: req.user.id, instance: { auditScope } }, include: { labels: { select: { labelId: true } }, instance: { select: { id: true, name: true, label: true, provider: true, metaPhoneDisplay: true, auditScope: true } } } }) : null;
  if (!chat) throw new AppError(404, 'Conversa não encontrada.');
  return chat;
}

const listDTO = (c, extra = {}) => chatDTO(c, { labelIds: c.labels.map((l) => l.labelId), instanceLabel: c.instance?.label || c.instance?.metaPhoneDisplay || null, ...extra });

// Cursor das mensagens: "<ms>_<id>" (ordem por horário e depois id).
const cursorWhere = (ts, id, dir) => (dir === 'lt' ? { OR: [{ ts: { lt: ts } }, { ts, id: { lt: id } }] } : { OR: [{ ts: { gt: ts } }, { ts, id: { gt: id } }] });

// ---------- Tempo real ----------
router.get('/stream', (req, res) => {
  const scope = assertScopeAccess(req);
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const unsubscribe = subscribe(req.user.id, scope, res);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  const done = () => { clearInterval(beat); unsubscribe(); };
  req.on('close', done);
  res.on('error', done);
});

// ---------- Conversas ----------
const INST_SELECT = { select: { id: true, name: true, label: true, metaPhoneDisplay: true } };

router.get('/chats', async (req, res) => {
  const userId = req.user.id;
  const auditScope = assertScopeAccess(req);
  const limit = clamp(int(req.query.limit) || 40, 1, 100);
  const since = sinceOf(req.query.days);
  const where = { userId, instance: { auditScope }, lastMessageAt: { gte: since } };
  if (int(req.query.instanceId)) where.instanceId = int(req.query.instanceId);
  if (int(req.query.labelId)) where.labels = { some: { labelId: int(req.query.labelId) } };
  if (req.query.unread === '1') where.unread = { gt: 0 };
  if (req.query.kind === 'groups') where.isGroup = true;
  if (req.query.kind === 'direct') where.isGroup = false;
  if (int(req.query.before)) where.lastMessageAt = { gte: since, lt: new Date(int(req.query.before)) };

  // Busca: cada palavra precisa aparecer no nome, no número ou em alguma mensagem da conversa (sem acento, sem maiúscula).
  const terms = searchTerms(req.query.q);
  if (terms.length) {
    where.AND = terms.map((t) => {
      const digits = onlyDigits(t);
      return { OR: [{ nameSearch: { contains: t } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []), { messages: { some: { search: { contains: t }, ts: { gte: since } } } }] };
    });
  }

  const rows = await prisma.auditChat.findMany({
    where, orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    include: { labels: { select: { labelId: true } }, instance: INST_SELECT },
  });
  const more = rows.length > limit;
  const page = rows.slice(0, limit);

  // Com busca: mostra o trecho da última mensagem que contém a palavra.
  let snippets = new Map();
  if (terms.length && page.length) {
    const hits = await prisma.auditMessage.findMany({
      where: { chatId: { in: page.map((c) => c.id) }, search: { contains: terms[0] }, ts: { gte: since } },
      orderBy: { ts: 'desc' }, distinct: ['chatId'], select: { chatId: true, body: true },
    });
    snippets = new Map(hits.map((h) => [h.chatId, h.body.replace(/\s+/g, ' ').slice(0, 160)]));
  }

  const [unread, newest] = await Promise.all([
    prisma.auditChat.aggregate({ where: { userId, instance: { auditScope } }, _sum: { unread: true }, _count: { _all: true } }),
    prisma.auditMessage.aggregate({ where: { chat: { userId, instance: { auditScope } } }, _max: { id: true } }),
  ]);
  const unreadChats = await prisma.auditChat.count({ where: { userId, instance: { auditScope }, unread: { gt: 0 } } });
  res.json({
    chats: page.map((c) => listDTO(c, snippets.has(c.id) ? { match: snippets.get(c.id) } : {})),
    nextBefore: more ? page.at(-1).lastMessageAt.getTime() : null,
    unreadTotal: unread._sum.unread || 0, unreadChats, totalChats: unread._count._all,
    cursor: newest._max.id || 0, // ponto de partida do canal de atualização de segurança (/updates)
  });
});

// Canal de segurança do "ao vivo": tudo que chegou depois de `after`. A tela pergunta a cada poucos segundos,
// então mesmo que o tempo real (SSE) seja barrado por um proxy, nada deixa de aparecer.
router.get('/updates', async (req, res) => {
  const auditScope = assertScopeAccess(req);
  const after = int(req.query.after) || 0;
  const rows = await prisma.auditMessage.findMany({
    where: { id: { gt: after }, chat: { userId: req.user.id, instance: { auditScope } } }, orderBy: { id: 'asc' }, take: 200,
    include: { chat: { include: { labels: { select: { labelId: true } }, instance: INST_SELECT } } },
  });
  const chats = new Map(rows.map((r) => [r.chatId, r.chat]));
  res.json({
    messages: rows.map((r) => ({ chatId: r.chatId, ...messageDTO(r) })),
    chats: [...chats.values()].map((c) => listDTO(c)),
    cursor: rows.length ? rows.at(-1).id : after, more: rows.length === 200,
  });
});

router.get('/chats/:id', async (req, res) => {
  const c = await ownChat(req);
  res.json({ chat: listDTO(c, { note: c.note, noteUpdatedAt: c.noteUpdatedAt ? c.noteUpdatedAt.getTime() : null, provider: c.instance.provider }) });
});

router.get('/chats/:id/messages', async (req, res) => {
  const chat = await ownChat(req);
  const limit = clamp(int(req.query.limit) || 50, 1, 100);
  const order = [{ ts: 'desc' }, { id: 'desc' }];
  const since = sinceOf(req.query.days);

  if (int(req.query.around)) {
    const target = await prisma.auditMessage.findFirst({ where: { id: int(req.query.around), chatId: chat.id, ts: { gte: since } } });
    if (!target) throw new AppError(404, 'Mensagem não encontrada.');
    const half = 25;
    const older = await prisma.auditMessage.findMany({ where: { chatId: chat.id, AND: [cursorWhere(target.ts, target.id, 'lt'), { ts: { gte: since } }] }, orderBy: order, take: half + 1 });
    const newer = await prisma.auditMessage.findMany({ where: { chatId: chat.id, ...cursorWhere(target.ts, target.id, 'gt') }, orderBy: [{ ts: 'asc' }, { id: 'asc' }], take: half + 1 });
    const around = [...older.slice(0, half).reverse(), target, ...newer.slice(0, half)];
    const names = await senderNames(chat.instanceId, around);
    return res.json({ messages: around.map((m) => messageDTO(m, names.get(m.senderJid))), hasOlder: older.length > half, hasNewer: newer.length > half });
  }

  let where = { chatId: chat.id, ts: { gte: since } };
  const m = /^(\d+)_(\d+)$/.exec(String(req.query.before || ''));
  if (m) where = { chatId: chat.id, AND: [cursorWhere(new Date(Number(m[1])), Number(m[2]), 'lt'), { ts: { gte: since } }] };
  const rows = await prisma.auditMessage.findMany({ where, orderBy: order, take: limit + 1 });
  const shown = rows.slice(0, limit).reverse();
  const names = await senderNames(chat.instanceId, shown);
  res.json({ messages: shown.map((m) => messageDTO(m, names.get(m.senderJid))), hasOlder: rows.length > limit, hasNewer: false });
});

// Busca por palavra-chave dentro de UMA conversa: mensagens que têm TODAS as palavras (ignora maiúsculas e acentos).
router.get('/chats/:id/search', async (req, res) => {
  const chat = await ownChat(req);
  const terms = searchTerms(req.query.q);
  if (!terms.length || terms.every((t) => t.length < 2)) throw new AppError(400, 'Digite pelo menos 2 letras para buscar.');
  const where = { chatId: chat.id, ts: { gte: sinceOf(req.query.days) }, AND: terms.map((t) => ({ search: { contains: t } })) };
  const [total, rows] = await Promise.all([
    prisma.auditMessage.count({ where }),
    prisma.auditMessage.findMany({ where, orderBy: [{ ts: 'desc' }, { id: 'desc' }], take: 500, select: { id: true, ts: true, fromMe: true, body: true, search: true } }),
  ]);
  res.json({
    total,
    matches: rows.map((r) => {
      const at = Math.max(0, r.search.indexOf(terms[0]));
      const from = Math.max(0, at - 40);
      return { id: r.id, ts: r.ts.getTime(), fromMe: r.fromMe, snippet: `${from > 0 ? '…' : ''}${r.body.slice(from, at + terms[0].length + 60).replace(/\s+/g, ' ')}` };
    }),
  });
});

// Abrir a conversa marca tudo que foi recebido como lido (e avisa as outras abas).
router.post('/chats/:id/read', async (req, res) => {
  const chat = await ownChat(req);
  const updated = await markChatSeen(chat);
  res.json({ ok: true, unread: updated.unread });
});

// Foto, áudio, vídeo ou documento de uma mensagem. Baixa da Evolution/Meta na primeira vez e guarda.
// Aceita "avançar" no vídeo/áudio (Range). ?thumb=1 devolve só a miniatura; ?download=1 força o download.
router.get('/messages/:id/media', async (req, res) => {
  const auditScope = assertScopeAccess(req);
  const id = int(req.params.id);
  const msg = id ? await prisma.auditMessage.findFirst({ where: { id, chat: { userId: req.user.id, instance: { auditScope } } }, select: { id: true, hasMedia: true, thumb: true, mediaName: true, type: true } }) : null;
  if (!msg?.hasMedia) throw new AppError(404, 'Mídia não encontrada.');

  let file = req.query.thumb ? null : await ensureMedia(msg.id);
  if (!file && msg.thumb) file = { mime: 'image/jpeg', data: Buffer.from(msg.thumb, 'base64'), thumb: true };
  if (!file) throw new AppError(404, 'Não foi possível baixar esta mídia agora. O WhatsApp pode ter apagado o arquivo.');

  const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
  const inline = /^(image\/(?!svg)|video\/|audio\/)/i.test(file.mime) && !req.query.download;
  const name = (msg.mediaName || `arquivo-${msg.id}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  res.set({
    'Content-Type': inline ? file.mime : 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`, 'Content-Security-Policy': "sandbox; default-src 'none'",
  });
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    if (start > end || start >= data.length) return res.status(416).set('Content-Range', `bytes */${data.length}`).end();
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
    return res.end(data.subarray(start, end + 1));
  }
  res.set('Content-Length', data.length);
  return res.end(data);
});

// Bloco de anotações da conversa (um texto livre por conversa).
router.put('/chats/:id/note', async (req, res) => {
  const chat = await ownChat(req);
  const note = String(req.body?.note ?? '');
  if (note.length > MAX_NOTE) throw new AppError(400, `A anotação pode ter até ${MAX_NOTE} caracteres.`);
  const u = await prisma.auditChat.update({ where: { id: chat.id }, data: { note, noteUpdatedAt: note ? new Date() : null } });
  res.json({ note: u.note, noteUpdatedAt: u.noteUpdatedAt ? u.noteUpdatedAt.getTime() : null });
});

router.put('/chats/:id/labels', async (req, res) => {
  const chat = await ownChat(req);
  const auditScope = assertScopeAccess(req);
  const ids = [...new Set((Array.isArray(req.body?.labelIds) ? req.body.labelIds : []).map(Number).filter(Number.isInteger))];
  const valid = ids.length ? await prisma.auditLabel.findMany({ where: { userId: req.user.id, auditScope, id: { in: ids } }, select: { id: true } }) : [];
  await prisma.$transaction([
    prisma.auditChatLabel.deleteMany({ where: { chatId: chat.id } }),
    prisma.auditChatLabel.createMany({ data: valid.map((l) => ({ chatId: chat.id, labelId: l.id })) }),
  ]);
  res.json({ labelIds: valid.map((l) => l.id) });
});

// Responder a conversa: só no plano que permite (Ouro).
router.post('/chats/:id/send', async (req, res) => {
  if (!limitsFor(req.user).auditSend) {
    throw new AppError(403, 'Responder conversas pela auditoria é um recurso do plano Ouro. No seu plano você só visualiza as conversas.', 'PLAN_NO_SEND');
  }
  const chat = await ownChat(req);
  const text = String(req.body?.text ?? '').trim();
  if (!text) throw new AppError(400, 'Escreva a mensagem.');
  if (text.length > MAX_SEND) throw new AppError(400, `A mensagem pode ter até ${MAX_SEND} caracteres.`);

  const inst = await prisma.instance.findFirst({ where: { id: chat.instanceId, userId: req.user.id, purpose: 'auditoria' }, include: { user: true } });
  if (!inst) throw new AppError(404, 'A conexão desta conversa não existe mais.');
  if ((await wa.getState(inst)) !== 'open') throw new AppError(409, 'Este número está desconectado. Reconecte para enviar.', 'WHATSAPP_DISCONNECTED');

  const to = chat.isGroup ? chat.jid : chat.phone || chat.jid;
  const sent = await wa.sendText(inst, to, text);
  const externalId = sent?.key?.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const saved = await recordMessage(inst, {
    jid: chat.jid, isGroup: chat.isGroup, phone: chat.phone, chatName: null, externalId, fromMe: true, sender: chat.isGroup ? 'Você' : null, type: 'text', body: text, ts: Date.now(), status: 'sent',
  }, { live: true });
  // Se o webhook entregou a mesma mensagem antes, ela já existe: devolve a existente.
  const message = saved?.message || messageDTO(await prisma.auditMessage.findFirst({ where: { chatId: chat.id, externalId } }));
  res.status(201).json({ message });
});

// ---------- Etiquetas ----------
const labelDTO = (l) => ({ id: l.id, name: l.name, color: l.color });

function cleanLabelInput(b, { partial = false } = {}) {
  const out = {};
  if (!partial || b.name !== undefined) {
    const name = String(b.name ?? '').replace(/\s+/g, ' ').trim();
    if (name.length < 1 || name.length > 30) throw new AppError(400, 'O nome da etiqueta deve ter de 1 a 30 caracteres.');
    out.name = name;
  }
  if (b.color !== undefined) {
    if (!HEX.test(String(b.color))) throw new AppError(400, 'Cor inválida.');
    out.color = String(b.color).toLowerCase();
  }
  return out;
}

router.get('/labels', async (req, res) => {
  const auditScope = assertScopeAccess(req);
  const rows = await prisma.auditLabel.findMany({ where: { userId: req.user.id, auditScope }, orderBy: { name: 'asc' }, include: { _count: { select: { chats: true } } } });
  res.json({ labels: rows.map((l) => ({ ...labelDTO(l), count: l._count.chats })) });
});

router.post('/labels', async (req, res) => {
  const auditScope = assertScopeAccess(req);
  const data = cleanLabelInput(req.body || {});
  if ((await prisma.auditLabel.count({ where: { userId: req.user.id, auditScope } })) >= MAX_LABELS) throw new AppError(400, `Você pode ter até ${MAX_LABELS} etiquetas.`);
  try {
    const l = await prisma.auditLabel.create({ data: { userId: req.user.id, auditScope, ...data } });
    res.status(201).json({ label: labelDTO(l) });
  } catch (e) {
    if (e.code === 'P2002') throw new AppError(409, 'Você já tem uma etiqueta com esse nome.');
    throw e;
  }
});

async function ownLabel(req) {
  const id = int(req.params.id);
  const auditScope = assertScopeAccess(req);
  const l = id ? await prisma.auditLabel.findFirst({ where: { id, userId: req.user.id, auditScope } }) : null;
  if (!l) throw new AppError(404, 'Etiqueta não encontrada.');
  return l;
}

router.patch('/labels/:id', async (req, res) => {
  const l = await ownLabel(req);
  const data = cleanLabelInput(req.body || {}, { partial: true });
  if (!Object.keys(data).length) throw new AppError(400, 'Nada para atualizar.');
  try {
    res.json({ label: labelDTO(await prisma.auditLabel.update({ where: { id: l.id }, data })) });
  } catch (e) {
    if (e.code === 'P2002') throw new AppError(409, 'Você já tem uma etiqueta com esse nome.');
    throw e;
  }
});

router.delete('/labels/:id', async (req, res) => {
  const l = await ownLabel(req);
  await prisma.auditLabel.delete({ where: { id: l.id } });
  res.json({ ok: true });
});

export default router;
