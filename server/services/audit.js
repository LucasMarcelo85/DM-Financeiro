import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { onlyDigits } from '../utils/helpers.js';
import { computeAccess } from './access.js';
import { publish } from './audit-hub.js';
import * as evo from './evolution.js';
import * as meta from './meta.js';

// Texto sem acentos e em minúsculas: a busca ignora maiúsculas e acentos ("olá" acha "ola", "joao" acha "João").
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// "preço orçamento" -> ['preco', 'orcamento']. Texto entre aspas vira uma frase só. Até 6 termos.
export function searchTerms(q) {
  const out = [];
  for (const m of norm(q).matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = (m[1] ?? m[2]).trim();
    if (t) out.push(t.slice(0, 80));
  }
  return out.slice(0, 6);
}

const TYPE_PREVIEW = { image: 'Foto', video: 'Vídeo', audio: 'Áudio', document: 'Documento', sticker: 'Figurinha', location: 'Localização', contact: 'Contato' };
const preview = (type, body) => (body ? body.replace(/\s+/g, ' ').slice(0, 140) : TYPE_PREVIEW[type] || 'Mensagem');
const FUTURE_SLACK = 60_000;
const LIVE_WINDOW = 15 * 60_000; // mensagem recebida há mais que isso por webhook é histórico (não conta como nova)

export const chatDTO = (c, extra = {}) => ({
  id: c.id, instanceId: c.instanceId, jid: c.jid, isGroup: c.isGroup, name: c.name, phone: c.phone,
  lastMessageAt: c.lastMessageAt.getTime(), lastText: c.lastText, lastFromMe: c.lastFromMe, unread: c.unread, ...extra,
});

// `senderName`: nome já resolvido (a tela mostra o nome de quem falou nos grupos).
export function messageDTO(m, senderName) {
  const jid = m.senderJid || '';
  return {
    id: m.id, fromMe: m.fromMe, sender: senderName || m.sender, senderPhone: jid.endsWith('@s.whatsapp.net') ? onlyDigits(jid.split('@')[0]) : '',
    type: m.type, body: m.body, status: m.status, ts: m.ts.getTime(),
    media: m.hasMedia ? { mime: m.mediaMime, name: m.mediaName, seconds: m.mediaSeconds, thumb: Boolean(m.thumb) } : null,
  };
}

// ---------- Lidas / não lidas ----------
// "Não lida" = mensagem RECEBIDA que ninguém viu ainda. Vira lida quando o auditor abre a conversa, quando o dono responde
// (pelo celular ou pela tela) ou quando o WhatsApp avisa que foi lida. O contador da conversa é sempre recalculado.
export async function recountUnread(chatId) {
  const n = await prisma.auditMessage.count({ where: { chatId, fromMe: false, seenAt: null } });
  return prisma.auditChat.update({ where: { id: chatId }, data: { unread: n } });
}

export async function markChatSeen(chat) {
  await prisma.auditMessage.updateMany({ where: { chatId: chat.id, fromMe: false, seenAt: null }, data: { seenAt: new Date() } });
  const updated = await recountUnread(chat.id);
  publish(updated.userId, { type: 'chat', chat: chatDTO(updated) });
  return updated;
}

// ---------- Nomes ----------
const nameCache = new Map(); // "conexão:jid" -> nome (evita gravar a mesma coisa a cada mensagem)

async function applyChatName(inst, jid, name) {
  const chat = await prisma.auditChat.findUnique({ where: { instanceId_jid: { instanceId: inst.id, jid } } });
  if (!chat || chat.name === name) return;
  const updated = await prisma.auditChat.update({ where: { id: chat.id }, data: { name, nameSearch: norm(name) } });
  publish(inst.userId, { type: 'chat', chat: chatDTO(updated) });
}

// Guarda o nome que o WhatsApp mostra para uma pessoa (contato ou participante de grupo).
export async function learnName(inst, jid, rawName) {
  const name = String(rawName || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name || !jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast')) return;
  const key = `${inst.id}:${jid}`;
  if (nameCache.get(key) !== name) {
    await prisma.auditContact.upsert({ where: { instanceId_jid: { instanceId: inst.id, jid } }, create: { instanceId: inst.id, jid, name }, update: { name } });
    nameCache.set(key, name);
    if (nameCache.size > 20000) nameCache.clear();
  }
  await applyChatName(inst, jid, name);
}

// Nome (assunto) de um grupo.
export const learnGroupName = (inst, jid, subject) => {
  const name = String(subject || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return name && jid?.endsWith('@g.us') ? applyChatName(inst, jid, name) : null;
};

// Nomes das pessoas que falaram num grupo (para mostrar "Beto" em vez do número).
export async function senderNames(instanceId, messages) {
  const jids = [...new Set(messages.map((m) => m.senderJid).filter(Boolean))];
  if (!jids.length) return new Map();
  const rows = await prisma.auditContact.findMany({ where: { instanceId, jid: { in: jids } }, select: { jid: true, name: true } });
  return new Map(rows.map((r) => [r.jid, r.name]));
}

// ---------- Mídia (foto, áudio, vídeo) ----------
const MIME_BY_TYPE = { image: 'image/jpeg', audio: 'audio/ogg', video: 'video/mp4', sticker: 'image/webp', document: 'application/octet-stream' };
const SAFE_MIME = /^(image|video|audio)\/[\w.+-]+(;[\w=. +-]*)?$/i;
const cleanMime = (mime, type) => (SAFE_MIME.test(String(mime || '')) ? String(mime).slice(0, 100) : MIME_BY_TYPE[type] || 'application/octet-stream');

const toBuffer = (b64) => Buffer.from(String(b64).replace(/^data:[^,]*,/, ''), 'base64');

async function storeMedia(messageId, buffer, mime) {
  if (!buffer.length || buffer.length > config.auditSync.mediaMaxBytes) return false;
  await prisma.auditMedia.upsert({
    where: { messageId }, create: { messageId, mime, size: buffer.length, data: buffer }, update: { mime, size: buffer.length, data: buffer },
  });
  return true;
}

const downloads = new Map(); // mensagem -> download em andamento (evita baixar duas vezes)

// Baixa e guarda o arquivo (se já está guardado, só devolve). Devolve { mime, data } ou null se não deu.
export function ensureMedia(messageId) {
  if (downloads.has(messageId)) return downloads.get(messageId);
  const job = (async () => {
    const msg = await prisma.auditMessage.findUnique({ where: { id: messageId }, include: { media: true, chat: { include: { instance: { include: { user: true } } } } } });
    if (!msg?.hasMedia) return null;
    if (msg.media) return { mime: msg.media.mime, data: msg.media.data };
    const inst = msg.chat.instance;
    try {
      let buffer;
      let mime;
      if (inst.provider === 'meta') {
        const f = await meta.fetchMedia(inst, msg.mediaRef);
        buffer = f.buffer;
        mime = f.mime;
      } else {
        const f = await evo.getMediaBase64(inst.name, { id: msg.externalId, remoteJid: msg.chat.jid, fromMe: msg.fromMe });
        buffer = toBuffer(f.base64);
        mime = f.mimetype;
      }
      const finalMime = cleanMime(mime || msg.mediaMime, msg.type);
      if (!(await storeMedia(msg.id, buffer, finalMime))) return null;
      publish(inst.userId, { type: 'media', chatId: msg.chatId, messageId: msg.id });
      return { mime: finalMime, data: buffer };
    } catch (e) {
      console.warn(`[auditoria] mídia ${msg.id} indisponível: ${e.message}`);
      return null;
    }
  })().finally(() => downloads.delete(messageId));
  downloads.set(messageId, job);
  return job;
}

// Fotos, áudios e figurinhas são baixados na hora (são pequenos); vídeos e documentos só quando alguém abrir.
const queue = [];
let active = 0;
function pump() {
  while (active < 2 && queue.length) {
    active += 1;
    ensureMedia(queue.shift()).catch(() => {}).finally(() => { active -= 1; pump(); });
  }
}
const queueMedia = (id) => { if (queue.length < 500) { queue.push(id); pump(); } };

// ---------- Gravação ----------
// m: { jid, isGroup, phone, chatName, externalId, fromMe, sender, senderJid, senderName, type, body, ts(ms), status, media? }
// `live`: mensagem nova (conta como não lida). Histórico importado entra como lido.
export async function recordMessage(inst, m, { live = true } = {}) {
  const user = inst.user || (await prisma.user.findUnique({ where: { id: inst.userId } }));
  if (!user || !computeAccess(user).hasAccess) return null; // sem acesso: não guarda nada

  const now = Date.now();
  const tsMs = Number.isFinite(m.ts) && m.ts > 0 ? Math.min(m.ts, now + FUTURE_SLACK) : now; // relógio errado não "gruda" a conversa no topo
  const ts = new Date(tsMs);
  const body = String(m.body || '').slice(0, 20000);
  const key = { instanceId_jid: { instanceId: inst.id, jid: m.jid } };

  let chat = await prisma.auditChat.findUnique({ where: key });
  if (!chat) {
    let known = null;
    if (!m.isGroup) known = (await prisma.auditContact.findUnique({ where: { instanceId_jid: { instanceId: inst.id, jid: m.jid } } }))?.name;
    const name = m.chatName || known || null;
    try {
      chat = await prisma.auditChat.create({
        data: { userId: inst.userId, instanceId: inst.id, jid: m.jid, isGroup: m.isGroup, phone: m.phone || '', name, nameSearch: norm(name), lastMessageAt: ts, lastText: '', lastFromMe: m.fromMe },
      });
    } catch (e) {
      if (e.code !== 'P2002') throw e; // duas mensagens criaram a conversa ao mesmo tempo
      chat = await prisma.auditChat.findUnique({ where: key });
    }
  }

  // Mensagem recebida só é "não lida" se for nova e o dono não respondeu depois dela.
  let seen = !live || m.fromMe;
  if (!seen) seen = Boolean(await prisma.auditMessage.findFirst({ where: { chatId: chat.id, fromMe: true, ts: { gte: ts } }, select: { id: true } }));

  const media = m.media || null;
  const created = await prisma.auditMessage.createMany({
    data: [{
      chatId: chat.id, externalId: m.externalId, fromMe: m.fromMe, sender: m.sender || null, senderJid: m.senderJid || null, type: m.type, body, search: norm(body),
      status: m.status || null, ts, seenAt: seen ? new Date() : null,
      hasMedia: Boolean(media), mediaMime: media ? cleanMime(media.mime, m.type) : null, mediaName: media?.name ? String(media.name).slice(0, 200) : null,
      mediaSeconds: Number.isFinite(media?.seconds) ? Math.round(media.seconds) : null, mediaRef: media?.ref ? String(media.ref).slice(0, 200) : null, thumb: media?.thumb || null,
    }],
    skipDuplicates: true,
  });
  if (created.count === 0) return null; // já tínhamos esta mensagem

  const saved = await prisma.auditMessage.findUnique({ where: { chatId_externalId: { chatId: chat.id, externalId: m.externalId } } });

  if (media) {
    if (media.base64 && (await storeMedia(saved.id, toBuffer(media.base64), cleanMime(media.mime, m.type)))) { /* veio dentro do evento */ }
    else if (['image', 'audio', 'sticker'].includes(m.type)) queueMedia(saved.id);
  }

  // O dono respondeu: o que ele recebeu antes já foi visto.
  if (m.fromMe) await prisma.auditMessage.updateMany({ where: { chatId: chat.id, fromMe: false, seenAt: null, ts: { lte: ts } }, data: { seenAt: new Date() } });

  const data = {};
  if (ts >= chat.lastMessageAt || !chat.lastText) Object.assign(data, { lastMessageAt: ts, lastText: preview(m.type, body), lastFromMe: m.fromMe });
  if (m.chatName && !m.isGroup && !m.fromMe && chat.name !== m.chatName) Object.assign(data, { name: m.chatName, nameSearch: norm(m.chatName) });
  if (m.phone && !chat.phone) data.phone = m.phone;
  if (Object.keys(data).length) await prisma.auditChat.update({ where: { id: chat.id }, data });
  const updated = await recountUnread(chat.id);

  if (m.senderName && m.senderJid && !m.fromMe) learnName(inst, m.senderJid, m.senderName).catch(() => {});
  if (m.chatName && !m.isGroup && !m.fromMe) learnName(inst, m.jid, m.chatName).catch(() => {});

  const result = { chat: chatDTO(updated), message: messageDTO(saved, m.senderName) };
  publish(inst.userId, { type: 'message', ...result });
  return result;
}

// Status de uma mensagem enviada (enviado -> entregue -> lido). Para mensagens RECEBIDAS, "lido" quer dizer que o dono leu no celular.
export async function updateStatus(inst, externalId, status) {
  const msg = await prisma.auditMessage.findFirst({ where: { externalId, chat: { instanceId: inst.id } }, select: { id: true, chatId: true, status: true, fromMe: true, seenAt: true } });
  if (!msg) return;
  if (!msg.fromMe) {
    if (status === 'read' && !msg.seenAt) {
      await prisma.auditMessage.update({ where: { id: msg.id }, data: { seenAt: new Date() } });
      const updated = await recountUnread(msg.chatId);
      publish(inst.userId, { type: 'chat', chat: chatDTO(updated) });
    }
    return;
  }
  const order = { sent: 1, delivered: 2, read: 3, failed: 0 };
  if (msg.status === status || (status !== 'failed' && (order[msg.status] ?? 0) >= order[status])) return; // só avança
  await prisma.auditMessage.update({ where: { id: msg.id }, data: { status } });
  publish(inst.userId, { type: 'status', chatId: msg.chatId, messageId: msg.id, status });
}

// Mensagem editada no WhatsApp: atualiza o texto (e a busca) da original.
async function applyEdit(inst, externalId, text) {
  const msg = await prisma.auditMessage.findFirst({ where: { externalId, chat: { instanceId: inst.id } }, select: { id: true, chatId: true } });
  if (!msg || !text) return;
  await prisma.auditMessage.update({ where: { id: msg.id }, data: { body: text.slice(0, 20000), search: norm(text) } });
  publish(inst.userId, { type: 'edit', chatId: msg.chatId, messageId: msg.id, body: text.slice(0, 20000) });
}

// ---------- Evolution ----------
function unwrap(message) {
  let cur = message;
  for (let i = 0; i < 5 && cur; i++) {
    const inner = cur.ephemeralMessage?.message || cur.viewOnceMessage?.message || cur.viewOnceMessageV2?.message || cur.viewOnceMessageV2Extension?.message || cur.documentWithCaptionMessage?.message;
    if (!inner) break;
    cur = inner;
  }
  return cur;
}

// A miniatura chega como texto base64 ou como lista de bytes, conforme a versão.
function thumbOf(v) {
  let b64 = null;
  if (typeof v === 'string') b64 = v;
  else if (v && typeof v === 'object') {
    const bytes = Array.isArray(v) ? v : Array.isArray(v.data) ? v.data : Object.values(v);
    if (bytes.length && bytes.every((x) => Number.isInteger(x))) b64 = Buffer.from(bytes).toString('base64');
  }
  return b64 && b64.length <= 90_000 ? b64 : null;
}

const MEDIA_NODES = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker', documentMessage: 'document' };

// Devolve { type, body, media? } ou null para o que não é conteúdo de conversa (reação, protocolo...).
export function evolutionContent(message) {
  const m = unwrap(message);
  if (!m) return null;
  if (typeof m.conversation === 'string') return { type: 'text', body: m.conversation };
  if (m.extendedTextMessage) return { type: 'text', body: m.extendedTextMessage.text || '' };
  for (const [node, type] of Object.entries(MEDIA_NODES)) {
    const n = m[node];
    if (!n) continue;
    return {
      type,
      body: type === 'document' ? n.caption || n.fileName || '' : n.caption || '',
      media: { mime: n.mimetype, name: n.fileName || null, seconds: n.seconds, thumb: thumbOf(n.jpegThumbnail), base64: message.base64 || m.base64 || null },
    };
  }
  if (m.locationMessage) return { type: 'location', body: [m.locationMessage.name, m.locationMessage.address].filter(Boolean).join(' - ') };
  if (m.contactMessage) return { type: 'contact', body: m.contactMessage.displayName || '' };
  if (m.contactsArrayMessage) return { type: 'contact', body: (m.contactsArrayMessage.contacts || []).map((c) => c.displayName).filter(Boolean).join(', ') };
  if (m.pollCreationMessage || m.pollCreationMessageV3) return { type: 'text', body: (m.pollCreationMessage || m.pollCreationMessageV3).name || 'Enquete' };
  if (m.buttonsResponseMessage) return { type: 'text', body: m.buttonsResponseMessage.selectedDisplayText || '' };
  if (m.listResponseMessage) return { type: 'text', body: m.listResponseMessage.title || '' };
  if (m.templateButtonReplyMessage) return { type: 'text', body: m.templateButtonReplyMessage.selectedDisplayText || '' };
  return null;
}

export const toMs = (v) => {
  const n = typeof v === 'object' && v !== null ? Number(v.low ?? v.seconds ?? 0) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 1e12 ? n * 1000 : n;
};

const phoneOfJid = (jid) => (jid && jid.endsWith('@s.whatsapp.net') ? onlyDigits(jid.split('@')[0]) : '');

// Transforma uma mensagem da Evolution no formato interno (ou null para ignorar).
export function fromEvolution(item) {
  const key = item?.key;
  const jid = key?.remoteJid;
  if (!jid || !key.id || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return null;
  const content = evolutionContent(item.message);
  if (!content) return null;
  const isGroup = jid.endsWith('@g.us');
  const fromMe = Boolean(key.fromMe);
  const participant = key.participantAlt?.endsWith('@s.whatsapp.net') ? key.participantAlt : key.participant || null;
  return {
    jid, isGroup, fromMe, externalId: key.id, ...content, ts: toMs(item.messageTimestamp),
    phone: isGroup ? '' : phoneOfJid(jid.endsWith('@s.whatsapp.net') ? jid : key.remoteJidAlt),
    chatName: !fromMe && !isGroup ? item.pushName || null : null,
    sender: isGroup ? (fromMe ? 'Você' : item.pushName || null) : null,
    senderJid: isGroup && !fromMe ? participant : null,
    senderName: isGroup && !fromMe ? item.pushName || null : null,
    status: fromMe ? 'sent' : null,
  };
}

const STATUS = { SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read', ERROR: 'failed' };
const isFresh = (ms) => Date.now() - ms < LIVE_WINDOW;

export async function ingestEvolution(inst, event, data) {
  const ev = String(event || '').toLowerCase().replace(/_/g, '.');
  const items = Array.isArray(data) ? data : data?.messages && Array.isArray(data.messages) ? data.messages : data ? [data] : [];

  if (ev === 'messages.upsert' || ev === 'send.message') {
    for (const item of items) {
      const proto = item?.message?.protocolMessage;
      if (proto?.editedMessage && proto.key?.id) { await applyEdit(inst, proto.key.id, evolutionContent(proto.editedMessage)?.body); continue; }
      const m = fromEvolution(item);
      if (m) await recordMessage(inst, m, { live: isFresh(m.ts) });
    }
  } else if (ev === 'messages.update') {
    for (const u of items) {
      const status = STATUS[String(u.status || '').toUpperCase()];
      const id = u.keyId || u.key?.id;
      if (id && status) await updateStatus(inst, id, status);
    }
  } else if (ev === 'messages.edited') {
    for (const u of items) {
      const edited = u.message?.editedMessage?.message || u.message?.protocolMessage?.editedMessage;
      const id = u.message?.protocolMessage?.key?.id || u.message?.editedMessage?.message?.protocolMessage?.key?.id || u.key?.id;
      if (id && edited) await applyEdit(inst, id, evolutionContent(edited)?.body);
    }
  } else if (ev === 'connection.update') {
    publish(inst.userId, { type: 'connection', instanceId: inst.id, state: data?.state || null });
  } else if (['contacts.upsert', 'contacts.update'].includes(ev)) {
    for (const c of items.slice(0, 3000)) {
      const jid = c.remoteJid || c.id;
      if (jid && (c.pushName || c.name || c.notify)) await learnName(inst, jid, c.name || c.pushName || c.notify);
    }
  } else if (['chats.upsert', 'chats.update'].includes(ev)) {
    for (const c of items.slice(0, 3000)) {
      const jid = c.remoteJid || c.id;
      if (jid?.endsWith('@g.us')) await learnGroupName(inst, jid, c.name || c.subject);
      else if (jid && c.name) await learnName(inst, jid, c.name);
    }
  } else if (['groups.upsert', 'group.update', 'groups.update'].includes(ev)) {
    for (const g of items) await learnGroupName(inst, g.id || g.remoteJid, g.subject || g.name);
  }
}

// ---------- Sincronização (backfill + busca automática) ----------
const syncs = new Map(); // conexão -> { running, done, total, imported, error, finishedAt }
export const syncState = (id) => syncs.get(id) || null;

async function refreshSummary(chatId) {
  const last = await prisma.auditMessage.findFirst({ where: { chatId }, orderBy: [{ ts: 'desc' }, { id: 'desc' }], select: { ts: true, type: true, body: true, fromMe: true } });
  if (last) await prisma.auditChat.update({ where: { id: chatId }, data: { lastMessageAt: last.ts, lastText: preview(last.type, last.body), lastFromMe: last.fromMe } });
}

/**
 * Busca as mensagens direto na Evolution (não depende do webhook).
 * `deep`: traz o histórico todo (até 500 por conversa); sem `deep` só as mensagens mais recentes das conversas que mudaram.
 * Na primeira vez (nunca sincronizou) tudo entra como lido; depois, o que chegou desde a última busca entra como não lido.
 */
export async function syncInstance(inst, { deep = false } = {}) {
  if (syncs.get(inst.id)?.running) return { skipped: true };
  const full = inst.user ? inst : { ...inst, user: await prisma.user.findUnique({ where: { id: inst.userId } }) };
  const state = { running: true, done: 0, total: 0, imported: 0, error: null, finishedAt: null };
  syncs.set(inst.id, state);
  const startedAt = Date.now();
  const since = inst.lastSyncAt ? inst.lastSyncAt.getTime() : null;
  const emit = () => publish(inst.userId, { type: 'sync', instanceId: inst.id, running: state.running, done: state.done, total: state.total, imported: state.imported });
  const touched = new Set();
  try {
    const remote = (await evo.findChats(inst.name))
      .map((c) => ({ jid: c.remoteJid || c.id, name: c.name || c.subject || null, updated: Date.parse(c.updatedAt) || (c.lastMessage?.messageTimestamp ? toMs(c.lastMessage.messageTimestamp) : 0), last: c.lastMessage || null }))
      .filter((c) => c.jid && !c.jid.endsWith('@broadcast') && !c.jid.endsWith('@newsletter'))
      .sort((a, b) => b.updated - a.updated)
      .slice(0, 1000);

    // Grupos: busca o assunto antes de importar, para a conversa já aparecer com o nome certo.
    if (remote.some((c) => c.jid.endsWith('@g.us') && !c.name)) {
      try {
        const groups = new Map((await evo.fetchAllGroups(inst.name)).map((g) => [g.id || g.remoteJid, g.subject || g.name]));
        for (const c of remote) if (c.jid.endsWith('@g.us') && !c.name) c.name = groups.get(c.jid) || null;
      } catch { /* Evolution sem esse endpoint: o nome vem pelos eventos */ }
    }

    const local = new Map((await prisma.auditChat.findMany({ where: { instanceId: inst.id }, select: { jid: true, lastMessageAt: true } })).map((c) => [c.jid, c.lastMessageAt.getTime()]));
    const todo = deep ? remote : remote.filter((c) => !local.has(c.jid) || c.updated > local.get(c.jid) + 500);
    state.total = todo.length;
    emit();

    for (const c of todo) {
      try {
        const items = deep || !local.has(c.jid) ? await evo.fetchAllMessages(inst.name, c.jid, { max: deep ? 500 : 100 }) : await evo.fetchRecentMessages(inst.name, c.jid, 50);
        if (c.last?.key && !items.some((i) => i.key?.id === c.last.key.id)) items.push(c.last); // a última mensagem que a Evolution já resumiu na lista de conversas
        for (const item of items.sort((a, b) => toMs(a.messageTimestamp) - toMs(b.messageTimestamp))) {
          const m = fromEvolution(item);
          if (!m) continue;
          if (!m.chatName && c.name) m.chatName = c.name; // só dá nome à conversa nova; nunca renomeia pelo que o dono escreveu
          // Nova de verdade = chegou depois da última busca (a 1ª busca é histórico: tudo lido).
          if (await recordMessage(full, m, { live: since !== null && m.ts > since - 120_000 })) state.imported += 1;
        }
        touched.add(c.jid);
        if (c.name && c.jid.endsWith('@g.us')) await learnGroupName(full, c.jid, c.name);
      } catch (e) {
        console.warn(`[auditoria] conversa ${c.jid} de ${inst.name}: ${e.message}`);
      }
      state.done += 1;
      if (state.done % 10 === 0) emit();
    }

    // Garante a ordem certa da lista mesmo que o histórico tenha chegado fora de ordem.
    const chats = await prisma.auditChat.findMany({ where: { instanceId: inst.id, jid: { in: [...touched] } }, select: { id: true } });
    for (const ch of chats) await refreshSummary(ch.id);

    await completeNames(full, remote);
    await prisma.instance.update({ where: { id: inst.id }, data: { lastSyncAt: new Date(startedAt) } });
    state.error = null;
  } catch (e) {
    state.error = e.message;
    throw e;
  } finally {
    state.running = false;
    state.finishedAt = Date.now();
    emit();
  }
  return { chats: state.total, imported: state.imported };
}

// Descobre nomes que ainda faltam: grupos (assunto) e contatos (nome no WhatsApp).
async function completeNames(inst, remote) {
  const nameless = await prisma.auditChat.findMany({ where: { instanceId: inst.id, name: null }, select: { jid: true, isGroup: true }, take: 200 });
  if (!nameless.length) return;
  if (nameless.some((c) => c.isGroup)) {
    try {
      const groups = new Map((await evo.fetchAllGroups(inst.name)).map((g) => [g.id || g.remoteJid, g.subject || g.name]));
      for (const c of nameless.filter((x) => x.isGroup)) await learnGroupName(inst, c.jid, groups.get(c.jid));
    } catch { /* Evolution sem esse endpoint: os nomes vêm pelos eventos */ }
  }
  for (const c of nameless.filter((x) => !x.isGroup).slice(0, 15)) {
    try {
      const contact = await evo.findContact(inst.name, c.jid);
      const name = contact?.pushName || contact?.name;
      if (name) await learnName(inst, c.jid, name);
    } catch { /* tenta de novo na próxima busca */ }
  }
}

// ---------- Meta (API oficial) ----------
export async function ingestMeta(inst, event) {
  for (const m of event.messages) {
    const jid = onlyDigits(m.jid);
    if (!jid) continue;
    await recordMessage(inst, {
      jid, isGroup: false, phone: jid, chatName: m.pushName, externalId: m.externalId, fromMe: m.fromMe, sender: null, type: m.type, body: m.body, ts: m.ts,
      status: m.fromMe ? 'sent' : null, media: m.media || null,
    }, { live: isFresh(m.ts) });
  }
  for (const s of event.statuses) {
    const map = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
    if (map[s.status]) await updateStatus(inst, s.externalId, map[s.status]);
  }
}
