import crypto from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../utils/helpers.js';
import { decrypt, safeEqual } from '../utils/secret.js';

// API oficial do WhatsApp (Meta Cloud API). Cada conexão guarda: Phone Number ID, WABA ID (opcional),
// token de acesso (criptografado) e, para a auditoria, o App Secret que assina os webhooks.

const FRIENDLY = {
  190: 'O token de acesso é inválido ou expirou. Gere um novo token na Meta e cole aqui.',
  100: 'A Meta não encontrou este Phone Number ID (ou o token não tem acesso a ele). Confira o número do ID.',
  10: 'O token não tem permissão para usar o WhatsApp. Confira as permissões (whatsapp_business_messaging).',
  200: 'O token não tem permissão para usar o WhatsApp. Confira as permissões do token.',
  131047: 'A Meta só permite mensagem livre até 24 horas depois da última mensagem do cliente. Fora desse prazo é preciso usar um modelo (template) aprovado.',
  131030: 'Este número não está na lista de destinatários permitidos (conta de teste da Meta).',
  131026: 'A mensagem não pôde ser entregue a este número.',
  132000: 'Parâmetros do modelo de mensagem incorretos.',
};

async function graph(method, path, token, body) {
  let res;
  try {
    res = await fetch(`${config.meta.graphUrl}/${config.meta.apiVersion}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(502, 'Não foi possível falar com a Meta (API oficial do WhatsApp). Tente novamente em instantes.', 'META_UNREACHABLE');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const code = data?.error?.code;
    const auth = res.status === 401 || code === 190 || code === 100 || code === 10 || code === 200;
    const err = new AppError(auth ? 400 : 502, FRIENDLY[code] || data?.error?.error_user_msg || data?.error?.message || `A Meta respondeu com erro ${res.status}.`, auth ? 'META_AUTH' : 'META_ERROR');
    err.upstreamStatus = res.status;
    throw err;
  }
  return data;
}

export const tokenOf = (inst) => decrypt(inst.metaAccessToken);

// Confere se o token enxerga o número. Devolve { display, name } para mostrar ao usuário.
export async function checkPhone({ phoneNumberId, token }) {
  const d = await graph('GET', `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, token);
  return { display: d?.display_phone_number || null, name: d?.verified_name || null };
}

// Liga o app ao WABA para a Meta enviar os webhooks de mensagens (melhor esforço: o endereço do webhook
// em si é configurado pelo usuário no painel da Meta).
export async function subscribeApp({ businessId, token }) {
  if (!businessId) return false;
  try {
    await graph('POST', `/${encodeURIComponent(businessId)}/subscribed_apps`, token);
    return true;
  } catch {
    return false;
  }
}

const cache = new Map(); // conexão -> { at, state }
export const forget = (id) => cache.delete(id);

// 'open' = token e número funcionando. Cache curto para não chamar a Meta a cada tela aberta.
export async function getState(inst) {
  const token = tokenOf(inst);
  if (!inst.metaPhoneNumberId || !token) return 'close';
  const key = `${inst.id}:${inst.metaAccessToken.slice(-10)}`;
  const hit = cache.get(inst.id);
  if (hit && hit.key === key && Date.now() - hit.at < 45_000) return hit.state;
  let state;
  try {
    await checkPhone({ phoneNumberId: inst.metaPhoneNumberId, token });
    state = 'open';
  } catch (e) {
    if (e.code !== 'META_AUTH') throw e;
    state = 'close';
  }
  cache.set(inst.id, { key, at: Date.now(), state });
  return state;
}

export async function sendText(inst, to, text) {
  const token = tokenOf(inst);
  if (!token) throw new AppError(400, 'O token da API oficial não está disponível. Cadastre o token de novo.', 'META_AUTH');
  const d = await graph('POST', `/${encodeURIComponent(inst.metaPhoneNumberId)}/messages`, token, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to).replace(/\D/g, ''), type: 'text', text: { body: text, preview_url: true },
  });
  return { key: { id: d?.messages?.[0]?.id || null } };
}

// ---------- Webhook ----------
export function verifySignature(rawBody, header, appSecret) {
  if (!rawBody || !header || !appSecret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(expected, header);
}

function content(m) {
  const t = m.type;
  if (t === 'text') return { type: 'text', body: m.text?.body || '' };
  if (['image', 'video', 'audio', 'sticker'].includes(t)) return { type: t, body: m[t]?.caption || '' };
  if (t === 'document') return { type: 'document', body: m.document?.caption || m.document?.filename || '' };
  if (t === 'location') return { type: 'location', body: [m.location?.name, m.location?.address].filter(Boolean).join(' - ') };
  if (t === 'contacts') return { type: 'contact', body: (m.contacts || []).map((c) => c.name?.formatted_name).filter(Boolean).join(', ') };
  if (t === 'button') return { type: 'text', body: m.button?.text || '' };
  if (t === 'interactive') return { type: 'text', body: m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '' };
  return null; // reação, mídia desconhecida etc.: ignora
}

// Transforma o corpo do webhook em eventos simples: { phoneNumberId, messages: [...], statuses: [...] }.
export function parseWebhook(payload) {
  const out = [];
  if (payload?.object !== 'whatsapp_business_account') return out;
  for (const entry of payload.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      const messages = [];
      for (const m of v.messages || []) {
        const c = content(m);
        if (c && m.id && m.from) messages.push({ externalId: m.id, jid: m.from, fromMe: false, ts: Number(m.timestamp) * 1000, ...c, pushName: names[m.from] || null });
      }
      // Mensagens enviadas pelo próprio número em outro aplicativo (eco).
      for (const m of v.message_echoes || []) {
        const c = content(m);
        if (c && m.id && m.to) messages.push({ externalId: m.id, jid: m.to, fromMe: true, ts: Number(m.timestamp) * 1000, ...c, pushName: null });
      }
      const statuses = (v.statuses || []).filter((s) => s.id && s.status).map((s) => ({ externalId: s.id, status: s.status }));
      if (messages.length || statuses.length) out.push({ phoneNumberId, messages, statuses });
    }
  }
  return out;
}
