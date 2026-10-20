import { config, evolutionConfigured } from '../config.js';
import { AppError } from '../utils/helpers.js';

const enc = encodeURIComponent;

function upstreamMessage(data) {
  const m = data?.response?.message ?? data?.message ?? data?.error;
  if (Array.isArray(m)) return m.join(', ');
  return typeof m === 'string' ? m : null;
}

async function evo(method, path, body) {
  if (!evolutionConfigured()) {
    throw new AppError(503, 'A integração com o WhatsApp ainda não foi configurada pelo administrador.', 'EVOLUTION_NOT_CONFIGURED');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let res;
  try {
    res = await fetch(`${config.evolution.url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', apikey: config.evolution.apiKey },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new AppError(502, 'Não foi possível se comunicar com o servidor do WhatsApp. Tente novamente em instantes.', 'EVOLUTION_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new AppError(502, upstreamMessage(data) || `O servidor do WhatsApp respondeu com erro ${res.status}.`, 'EVOLUTION_ERROR');
    err.upstreamStatus = res.status;
    throw err;
  }
  return data;
}

export function normalizeQr(data) {
  let qr = data?.base64 || data?.qrcode?.base64 || null;
  if (qr && !qr.startsWith('data:')) qr = `data:image/png;base64,${qr}`;
  return { qr, pairingCode: data?.pairingCode || data?.qrcode?.pairingCode || null };
}

// Eventos que a auditoria precisa receber da Evolution (por webhook, em tempo real).
export const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_EDITED', 'SEND_MESSAGE', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT', 'CONTACTS_UPDATE', 'CHATS_UPSERT', 'CHATS_UPDATE', 'GROUPS_UPSERT', 'GROUP_UPDATE'];
// base64: true faz o webhook já trazer foto/áudio/vídeo dentro do evento (não depende da Evolution guardar o arquivo).
const webhookBody = (url) => ({ enabled: true, url, byEvents: false, base64: true, events: WEBHOOK_EVENTS });

// Auditoria só LÊ: nunca marcar como lido no celular, incluir grupos e pedir o histórico completo ao conectar.
const AUDIT_SETTINGS = { rejectCall: false, msgCall: '', groupsIgnore: false, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: true };

// `webhookUrl` (opcional): a conexão já nasce enviando as mensagens para a auditoria.
export const createInstance = (name, { webhookUrl } = {}) =>
  evo('POST', '/instance/create', {
    instanceName: name,
    qrcode: true,
    integration: config.evolution.integration,
    ...(webhookUrl ? { ...AUDIT_SETTINGS, webhook: { url: webhookUrl, byEvents: false, base64: true, events: WEBHOOK_EVENTS } } : {}),
  });

// Liga/atualiza o webhook de uma conexão que já existe. Tenta o formato da v2 e, se a Evolution recusar, o formato antigo.
export async function setWebhook(name, url) {
  try {
    return await evo('POST', `/webhook/set/${enc(name)}`, { webhook: webhookBody(url) });
  } catch (e) {
    if (e.upstreamStatus !== 400 && e.upstreamStatus !== 422) throw e;
    return evo('POST', `/webhook/set/${enc(name)}`, { enabled: true, url, webhook_by_events: false, webhook_base64: true, events: WEBHOOK_EVENTS });
  }
}

// Configurações de auditoria em conexões que já existem (melhor esforço: depende da versão da Evolution).
export const setAuditSettings = (name) => evo('POST', `/settings/set/${enc(name)}`, AUDIT_SETTINGS);

// A Evolution devolve listas em formatos diferentes conforme a versão/endpoint.
const asList = (d) => (Array.isArray(d) ? d : d?.messages?.records || d?.records || (Array.isArray(d?.messages) ? d.messages : null) || d?.chats || d?.contacts || d?.groups || []);
export const findChats = async (name) => asList(await evo('POST', `/chat/findChats/${enc(name)}`, {}));

// Uma página de mensagens de uma conversa. Devolve { records, pages, total }.
export async function findMessagesPage(name, remoteJid, { page = 1, limit = 50 } = {}) {
  const d = await evo('POST', `/chat/findMessages/${enc(name)}`, { where: { key: { remoteJid } }, page, offset: limit });
  const m = d?.messages && !Array.isArray(d.messages) ? d.messages : d;
  const records = asList(d);
  return { records, pages: Number(m?.pages) || 1, total: Number(m?.total) || records.length };
}

const tsOf = (r) => {
  const v = r?.messageTimestamp;
  const n = typeof v === 'object' && v !== null ? Number(v.low ?? v.seconds ?? 0) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// As mensagens MAIS NOVAS de uma conversa, não importa se a Evolution devolve da mais antiga ou da mais nova.
export async function fetchRecentMessages(name, remoteJid, limit = 50) {
  const first = await findMessagesPage(name, remoteJid, { page: 1, limit });
  const r = first.records;
  const ascending = r.length > 1 && tsOf(r[0]) < tsOf(r[r.length - 1]);
  if (ascending && first.pages > 1) return (await findMessagesPage(name, remoteJid, { page: first.pages, limit })).records;
  return r;
}

// Todas as páginas (até `max` mensagens): usado ao importar o histórico.
export async function fetchAllMessages(name, remoteJid, { max = 500, limit = 100 } = {}) {
  const out = [];
  const first = await findMessagesPage(name, remoteJid, { page: 1, limit });
  out.push(...first.records);
  for (let page = 2; page <= first.pages && out.length < max; page++) out.push(...(await findMessagesPage(name, remoteJid, { page, limit })).records);
  return out.slice(0, max);
}

// Baixa o arquivo de uma mensagem com mídia. Devolve { base64, mimetype, fileName } ou lança erro.
export async function getMediaBase64(name, { id, remoteJid, fromMe }) {
  const d = await evo('POST', `/chat/getBase64FromMediaMessage/${enc(name)}`, { message: { key: { id, remoteJid, fromMe: Boolean(fromMe) } }, convertToMp4: false });
  const base64 = d?.base64 || d?.data?.base64;
  if (!base64) throw new Error('A Evolution não devolveu o arquivo.');
  return { base64, mimetype: d?.mimetype || d?.data?.mimetype || null, fileName: d?.fileName || null };
}

// Nomes: contatos (pushName) e grupos (assunto).
export async function findContact(name, remoteJid) {
  const list = asList(await evo('POST', `/chat/findContacts/${enc(name)}`, { where: { remoteJid } }));
  return list.find((c) => (c.remoteJid || c.id) === remoteJid) || list[0] || null;
}
export const fetchAllGroups = async (name) => asList(await evo('GET', `/group/fetchAllGroups/${enc(name)}?getParticipants=false`));

export const connectInstance = (name) => evo('GET', `/instance/connect/${enc(name)}`);

// Retorna: 'open' | 'connecting' | 'close' | 'missing'
export async function getState(name) {
  try {
    const data = await evo('GET', `/instance/connectionState/${enc(name)}`);
    return data?.instance?.state || data?.state || 'close';
  } catch (e) {
    if (e.upstreamStatus === 404) return 'missing';
    throw e;
  }
}

export const logoutInstance = (name) => evo('DELETE', `/instance/logout/${enc(name)}`);

export async function deleteInstance(name) {
  try {
    await evo('DELETE', `/instance/delete/${enc(name)}`);
  } catch (e) {
    if (e.upstreamStatus !== 404) throw e;
  }
}

export const sendText = (name, number, text) => evo('POST', `/message/sendText/${enc(name)}`, { number, text });
