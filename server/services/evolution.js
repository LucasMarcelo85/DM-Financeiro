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
export const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT', 'CONTACTS_UPDATE', 'CHATS_UPSERT', 'CHATS_UPDATE'];
const webhookBody = (url) => ({ enabled: true, url, byEvents: false, base64: false, events: WEBHOOK_EVENTS });

// `webhookUrl` (opcional): a conexão já nasce enviando as mensagens para a auditoria.
export const createInstance = (name, { webhookUrl } = {}) =>
  evo('POST', '/instance/create', {
    instanceName: name,
    qrcode: true,
    integration: config.evolution.integration,
    ...(webhookUrl ? { webhook: { url: webhookUrl, byEvents: false, base64: false, events: WEBHOOK_EVENTS } } : {}),
  });

// Liga/atualiza o webhook de uma conexão que já existe (Evolution v2).
export const setWebhook = (name, url) => evo('POST', `/webhook/set/${enc(name)}`, { webhook: webhookBody(url) });

const asList = (d) => (Array.isArray(d) ? d : d?.messages?.records || d?.records || d?.messages || d?.chats || []);
export const findChats = async (name) => asList(await evo('POST', `/chat/findChats/${enc(name)}`, {}));
export const findMessages = async (name, remoteJid, limit = 50) =>
  asList(await evo('POST', `/chat/findMessages/${enc(name)}`, { where: { key: { remoteJid } }, page: 1, offset: limit }));

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
