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

export const createInstance = (name) =>
  evo('POST', '/instance/create', { instanceName: name, qrcode: true, integration: config.evolution.integration });

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
