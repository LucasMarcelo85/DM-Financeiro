import { prisma } from '../prisma.js';
import { onlyDigits } from '../utils/helpers.js';
import { computeAccess } from './access.js';
import { publish } from './audit-hub.js';
import * as evo from './evolution.js';

// Texto sem acentos e em minúsculas: a busca por palavra-chave ignora maiúsculas e acentos ("olá" acha "ola").
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const TYPE_PREVIEW = { image: 'Foto', video: 'Vídeo', audio: 'Áudio', document: 'Documento', sticker: 'Figurinha', location: 'Localização', contact: 'Contato' };
const preview = (type, body) => (body ? body.replace(/\s+/g, ' ').slice(0, 140) : TYPE_PREVIEW[type] || 'Mensagem');

export const chatDTO = (c, extra = {}) => ({
  id: c.id, instanceId: c.instanceId, jid: c.jid, isGroup: c.isGroup, name: c.name, phone: c.phone,
  lastMessageAt: c.lastMessageAt.getTime(), lastText: c.lastText, lastFromMe: c.lastFromMe, unread: c.unread, ...extra,
});
export const messageDTO = (m) => ({ id: m.id, fromMe: m.fromMe, sender: m.sender, type: m.type, body: m.body, status: m.status, ts: m.ts.getTime() });

// ---------- Gravação ----------
// m: { jid, isGroup, phone, chatName, externalId, fromMe, sender, type, body, ts(ms), status }
// `live`: mensagem nova chegando agora (conta como "não lida"); histórico importado não conta.
export async function recordMessage(inst, m, { live = true } = {}) {
  const user = inst.user || (await prisma.user.findUnique({ where: { id: inst.userId } }));
  if (!user || !computeAccess(user).hasAccess) return null; // sem acesso: não guarda nada

  const ts = new Date(Number.isFinite(m.ts) && m.ts > 0 ? m.ts : Date.now());
  const body = String(m.body || '').slice(0, 20000);
  const key = { instanceId_jid: { instanceId: inst.id, jid: m.jid } };

  let chat = await prisma.auditChat.findUnique({ where: key });
  if (!chat) {
    try {
      chat = await prisma.auditChat.create({
        data: { userId: inst.userId, instanceId: inst.id, jid: m.jid, isGroup: m.isGroup, phone: m.phone || '', name: m.chatName || null, lastMessageAt: ts, lastText: '', lastFromMe: m.fromMe },
      });
    } catch (e) {
      if (e.code !== 'P2002') throw e; // duas mensagens criaram a conversa ao mesmo tempo
      chat = await prisma.auditChat.findUnique({ where: key });
    }
  }

  const created = await prisma.auditMessage.createMany({
    data: [{ chatId: chat.id, externalId: m.externalId, fromMe: m.fromMe, sender: m.sender || null, type: m.type, body, search: norm(body), status: m.status || null, ts }],
    skipDuplicates: true,
  });
  if (created.count === 0) return null; // já tínhamos esta mensagem

  const newest = ts >= chat.lastMessageAt || !chat.lastText;
  const data = {};
  if (newest) Object.assign(data, { lastMessageAt: ts, lastText: preview(m.type, body), lastFromMe: m.fromMe });
  if (live && !m.fromMe) data.unread = { increment: 1 };
  if (m.chatName && !m.isGroup && !m.fromMe && chat.name !== m.chatName) data.name = m.chatName;
  if (m.phone && !chat.phone) data.phone = m.phone;
  const updated = Object.keys(data).length ? await prisma.auditChat.update({ where: { id: chat.id }, data }) : chat;

  const saved = await prisma.auditMessage.findUnique({ where: { chatId_externalId: { chatId: chat.id, externalId: m.externalId } } });
  const result = { chat: chatDTO(updated), message: messageDTO(saved) };
  if (live) publish(inst.userId, { type: 'message', ...result });
  return result;
}

export async function updateStatus(inst, externalId, status) {
  const msg = await prisma.auditMessage.findFirst({ where: { externalId, chat: { instanceId: inst.id } }, select: { id: true, chatId: true, status: true } });
  if (!msg || msg.status === status) return;
  // O status só avança (enviado -> entregue -> lido), nunca volta.
  const order = { sent: 1, delivered: 2, read: 3, failed: 0 };
  if (status !== 'failed' && (order[msg.status] ?? 0) >= order[status]) return;
  await prisma.auditMessage.update({ where: { id: msg.id }, data: { status } });
  publish(inst.userId, { type: 'status', chatId: msg.chatId, messageId: msg.id, status });
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

// Devolve { type, body } ou null para o que não é conteúdo de conversa (reação, protocolo...).
export function evolutionContent(message) {
  const m = unwrap(message);
  if (!m) return null;
  if (typeof m.conversation === 'string') return { type: 'text', body: m.conversation };
  if (m.extendedTextMessage) return { type: 'text', body: m.extendedTextMessage.text || '' };
  if (m.imageMessage) return { type: 'image', body: m.imageMessage.caption || '' };
  if (m.videoMessage) return { type: 'video', body: m.videoMessage.caption || '' };
  if (m.audioMessage) return { type: 'audio', body: '' };
  if (m.documentMessage) return { type: 'document', body: m.documentMessage.caption || m.documentMessage.fileName || '' };
  if (m.stickerMessage) return { type: 'sticker', body: '' };
  if (m.locationMessage) return { type: 'location', body: [m.locationMessage.name, m.locationMessage.address].filter(Boolean).join(' - ') };
  if (m.contactMessage) return { type: 'contact', body: m.contactMessage.displayName || '' };
  if (m.contactsArrayMessage) return { type: 'contact', body: (m.contactsArrayMessage.contacts || []).map((c) => c.displayName).filter(Boolean).join(', ') };
  if (m.pollCreationMessage || m.pollCreationMessageV3) return { type: 'text', body: (m.pollCreationMessage || m.pollCreationMessageV3).name || 'Enquete' };
  if (m.buttonsResponseMessage) return { type: 'text', body: m.buttonsResponseMessage.selectedDisplayText || '' };
  if (m.listResponseMessage) return { type: 'text', body: m.listResponseMessage.title || '' };
  if (m.templateButtonReplyMessage) return { type: 'text', body: m.templateButtonReplyMessage.selectedDisplayText || '' };
  return null;
}

const toMs = (v) => {
  const n = typeof v === 'object' && v !== null ? Number(v.low ?? v.seconds ?? 0) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 1e12 ? n * 1000 : n;
};

// Transforma uma mensagem da Evolution no formato interno (ou null para ignorar).
export function fromEvolution(item) {
  const key = item?.key;
  const jid = key?.remoteJid;
  if (!jid || !key.id || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return null;
  const content = evolutionContent(item.message);
  if (!content) return null;
  const isGroup = jid.endsWith('@g.us');
  const fromMe = Boolean(key.fromMe);
  const phoneJid = jid.endsWith('@s.whatsapp.net') ? jid : key.remoteJidAlt?.endsWith('@s.whatsapp.net') ? key.remoteJidAlt : '';
  return {
    jid, isGroup, fromMe, externalId: key.id, ...content, ts: toMs(item.messageTimestamp),
    phone: isGroup ? '' : onlyDigits(phoneJid.split('@')[0]),
    chatName: !fromMe && !isGroup ? item.pushName || null : null,
    sender: isGroup ? (fromMe ? 'Você' : item.pushName || onlyDigits(String(key.participant || '').split('@')[0]) || null) : null,
    status: fromMe ? 'sent' : null,
  };
}

const STATUS = { SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read', ERROR: 'failed' };

export async function ingestEvolution(inst, event, data) {
  const ev = String(event || '').toLowerCase().replace(/_/g, '.');
  const items = Array.isArray(data) ? data : data?.messages && Array.isArray(data.messages) ? data.messages : data ? [data] : [];

  if (ev === 'messages.upsert' || ev === 'send.message') {
    for (const item of items) {
      const m = fromEvolution(item);
      if (m) await recordMessage(inst, m);
    }
  } else if (ev === 'messages.update') {
    for (const u of items) {
      const status = STATUS[String(u.status || '').toUpperCase()];
      const id = u.keyId || u.key?.id;
      if (id && status) await updateStatus(inst, id, status);
    }
  } else if (ev === 'connection.update') {
    publish(inst.userId, { type: 'connection', instanceId: inst.id, state: data?.state || null });
  } else if (['contacts.upsert', 'contacts.update', 'chats.upsert', 'chats.update'].includes(ev)) {
    // Só atualiza o nome de conversas que já existem.
    for (const c of items) {
      const jid = c.remoteJid || c.id;
      const name = c.pushName || c.name;
      if (!jid || !name || jid.endsWith('@g.us')) continue;
      await prisma.auditChat.updateMany({ where: { instanceId: inst.id, jid, name: null }, data: { name: String(name).slice(0, 120) } });
    }
  }
}

// Busca o que a Evolution já tem guardado (melhor esforço) e importa como histórico.
export async function syncInstance(inst, { chatLimit = 30, perChat = 50 } = {}) {
  const full = inst.user ? inst : { ...inst, user: await prisma.user.findUnique({ where: { id: inst.userId } }) };
  const chats = (await evo.findChats(inst.name)).filter((c) => (c.remoteJid || c.id) && !String(c.remoteJid || c.id).endsWith('@broadcast')).slice(0, chatLimit);
  let imported = 0;
  for (const c of chats) {
    const jid = c.remoteJid || c.id;
    let list = [];
    try { list = await evo.findMessages(inst.name, jid, perChat); } catch { continue; }
    for (const item of list) {
      const m = fromEvolution(item);
      if (!m) continue;
      if (!m.chatName && c.name && !m.isGroup) m.chatName = c.name;
      if (await recordMessage(full, m, { live: false })) imported += 1;
    }
  }
  return { chats: chats.length, imported };
}

// ---------- Meta (API oficial) ----------
export async function ingestMeta(inst, event) {
  for (const m of event.messages) {
    const jid = onlyDigits(m.jid);
    if (jid) await recordMessage(inst, { jid, isGroup: false, phone: jid, chatName: m.pushName, externalId: m.externalId, fromMe: m.fromMe, sender: null, type: m.type, body: m.body, ts: m.ts, status: m.fromMe ? 'sent' : null });
  }
  for (const s of event.statuses) {
    const map = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
    if (map[s.status]) await updateStatus(inst, s.externalId, map[s.status]);
  }
}
