import crypto from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { decrypt, encrypt } from '../utils/secret.js';

const API_ROOT = 'https://graph.instagram.com';
const LOGIN_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
];

const apiVersion = () => {
  const version = config.instagram.apiVersion;
  return version.startsWith('v') ? version : `v${version}`;
};
const oauthRedirectUri = () => `${config.appUrl}/api/ai/instagram/callback`;
const publicAccount = (account) => ({
  id: account.id,
  username: account.username,
  instagramUserId: account.instagramUserId,
  permissions: account.permissions,
  expiresAt: account.expiresAt?.getTime() || null,
  webhookSubscribed: account.webhookSubscribed,
  canReceiveMessages: account.permissions.includes('instagram_business_manage_messages'),
  canReplyToComments: account.permissions.includes('instagram_business_manage_comments'),
});

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function graphRequest(method, path, token, body) {
  let response;
  try {
    response = await fetch(`${API_ROOT}/${apiVersion()}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(502, 'Não foi possível conectar ao Instagram. Tente novamente.', 'INSTAGRAM_UNAVAILABLE');
  }
  const data = await responseJson(response);
  if (!response.ok) {
    const authError = response.status === 401 || response.status === 403 || data?.error?.code === 190;
    throw new AppError(
      authError ? 400 : 502,
      authError
        ? 'A conexão com o Instagram expirou ou perdeu permissões. Reconecte a conta.'
        : data?.error?.error_user_msg || data?.error?.message || 'O Instagram recusou a solicitação.',
      authError ? 'INSTAGRAM_AUTH' : 'INSTAGRAM_ERROR',
    );
  }
  return data;
}

async function accountToken(account) {
  const token = decrypt(account.accessToken);
  if (!token) throw new AppError(400, 'A conexão com o Instagram expirou. Reconecte a conta.', 'INSTAGRAM_AUTH');
  if (!account.expiresAt || account.expiresAt.getTime() > Date.now() + 7 * 24 * 60 * 60 * 1000) return token;
  if (account.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, 'A conexão com o Instagram expirou. Reconecte a conta.', 'INSTAGRAM_AUTH');
  }

  const url = new URL(`${API_ROOT}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new AppError(502, 'Não foi possível renovar a conexão com o Instagram.', 'INSTAGRAM_UNAVAILABLE');
  }
  const data = await responseJson(response);
  if (!response.ok || !data.access_token) {
    throw new AppError(400, 'A conexão com o Instagram expirou. Reconecte a conta.', 'INSTAGRAM_AUTH');
  }
  const expiresAt = new Date(Date.now() + (Number(data.expires_in) || 60 * 24 * 60 * 60) * 1000);
  const updated = await prisma.aiInstagramAccount.update({
    where: { id: account.id },
    data: { accessToken: encrypt(data.access_token), expiresAt },
  });
  account.accessToken = updated.accessToken;
  account.expiresAt = updated.expiresAt;
  return data.access_token;
}

export async function beginInstagramOAuth({ userId, storeId, returnPath }) {
  if (!config.instagram.appId || !config.instagram.appSecret) {
    throw new AppError(503, 'A integração Instagram ainda não foi configurada pelo administrador.', 'INSTAGRAM_NOT_CONFIGURED');
  }
  await prisma.aiInstagramOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const state = crypto.randomBytes(32).toString('hex');
  await prisma.aiInstagramOAuthState.create({
    data: {
      state,
      userId,
      storeId,
      returnPath,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id', config.instagram.appId);
  url.searchParams.set('redirect_uri', oauthRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', LOGIN_SCOPES.join(','));
  url.searchParams.set('enable_fb_login', 'false');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function claimInstagramOAuthState(state) {
  if (!state || state.length > 200) return null;
  const pending = await prisma.aiInstagramOAuthState.findFirst({
    where: { state, expiresAt: { gt: new Date() } },
  });
  if (!pending) return null;
  const claimed = await prisma.aiInstagramOAuthState.deleteMany({
    where: { state, expiresAt: { gt: new Date() } },
  });
  return claimed.count === 1 ? pending : null;
}

async function exchangeInstagramCode(code) {
  const form = new FormData();
  form.set('client_id', config.instagram.appId);
  form.set('client_secret', config.instagram.appSecret);
  form.set('grant_type', 'authorization_code');
  form.set('redirect_uri', oauthRedirectUri());
  form.set('code', code);
  let response;
  try {
    response = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(502, 'Não foi possível conectar ao Instagram. Tente novamente.', 'INSTAGRAM_UNAVAILABLE');
  }
  const data = await responseJson(response);
  const tokenData = Array.isArray(data.data) ? data.data[0] : data;
  if (!response.ok || !tokenData?.access_token || !tokenData?.user_id) {
    throw new AppError(400, 'O Instagram não autorizou a conexão. Confira a conta profissional e as permissões do aplicativo.', 'INSTAGRAM_OAUTH_FAILED');
  }
  return tokenData;
}

async function exchangeLongLivedToken(shortLivedToken) {
  const url = new URL(`${API_ROOT}/${apiVersion()}/access_token`);
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', config.instagram.appSecret);
  url.searchParams.set('access_token', shortLivedToken);
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new AppError(502, 'Não foi possível concluir a conexão com o Instagram.', 'INSTAGRAM_UNAVAILABLE');
  }
  const data = await responseJson(response);
  if (!response.ok || !data.access_token) {
    throw new AppError(502, 'O Instagram não forneceu uma conexão de longa duração.', 'INSTAGRAM_OAUTH_FAILED');
  }
  return data;
}

export async function finishInstagramOAuth(code, pending) {
  if (!code || code.length > 2000) throw new AppError(400, 'O código de autorização do Instagram é inválido.');
  const shortToken = await exchangeInstagramCode(code);
  const longToken = await exchangeLongLivedToken(shortToken.access_token);
  const profile = await graphRequest('GET', 'me?fields=user_id,username', longToken.access_token);
  const instagramUserId = String(profile.user_id || profile.id || shortToken.user_id);
  const username = String(profile.username || 'Conta profissional').slice(0, 100);
  let permissionsValue = shortToken.permissions || '';
  try {
    const granted = await graphRequest('GET', 'me/permissions', longToken.access_token);
    if (Array.isArray(granted.data)) {
      permissionsValue = granted.data
        .filter((item) => item.status === 'granted')
        .map((item) => item.permission);
    }
  } catch {
    if (!permissionsValue) permissionsValue = LOGIN_SCOPES;
  }
  const permissions = [...new Set((Array.isArray(permissionsValue)
    ? permissionsValue
    : String(permissionsValue).split(',')).map((value) => String(value).trim()).filter(Boolean))];
  const existing = await prisma.aiInstagramAccount.findUnique({ where: { instagramUserId } });
  const scopeKey = `${pending.userId}:${pending.storeId ?? 'main'}`;
  if (existing && existing.scopeKey !== scopeKey) {
    throw new AppError(409, 'Esta conta do Instagram já está conectada a outro espaço de atendimento.', 'INSTAGRAM_ACCOUNT_IN_USE');
  }
  const expiresAt = new Date(Date.now() + (Number(longToken.expires_in) || 60 * 24 * 60 * 60) * 1000);
  const account = await prisma.aiInstagramAccount.upsert({
    where: { scopeKey },
    create: {
      userId: pending.userId,
      storeId: pending.storeId,
      scopeKey,
      instagramUserId,
      username,
      accessToken: encrypt(longToken.access_token),
      permissions,
      expiresAt,
    },
    update: {
      instagramUserId,
      username,
      accessToken: encrypt(longToken.access_token),
      permissions,
      expiresAt,
      webhookSubscribed: false,
    },
  });
  let webhookSubscribed = false;
  try {
    webhookSubscribed = await subscribeInstagramWebhooks(account);
  } catch (error) {
    console.warn(`[instagram] webhook não foi ativado para ${account.username} (${error.code || 'error'}).`);
  }
  const saved = await prisma.aiInstagramAccount.update({
    where: { id: account.id },
    data: { webhookSubscribed },
  });
  return publicAccount(saved);
}

export async function subscribeInstagramWebhooks(account) {
  const fields = [];
  if (account.permissions.includes('instagram_business_manage_messages')) fields.push('messages');
  if (account.permissions.includes('instagram_business_manage_comments')) fields.push('comments');
  if (!fields.length) throw new AppError(403, 'A conta não concedeu permissões para mensagens ou comentários.', 'INSTAGRAM_PERMISSION');
  const token = await accountToken(account);
  const params = new URLSearchParams({ subscribed_fields: fields.join(',') });
  await graphRequest('POST', `${encodeURIComponent(account.instagramUserId)}/subscribed_apps?${params}`, token);
  await prisma.aiInstagramAccount.update({ where: { id: account.id }, data: { webhookSubscribed: true } });
  return true;
}

export async function disconnectInstagramAccount(userId, storeId, accountId) {
  if (!Number.isInteger(accountId) || accountId < 1) throw new AppError(400, 'Conta do Instagram inválida.');
  const account = await prisma.aiInstagramAccount.findFirst({
    where: { id: accountId, userId, storeId },
    select: { id: true },
  });
  if (!account) throw new AppError(404, 'Conta do Instagram não encontrada.');
  await prisma.$transaction([
    prisma.aiAgent.updateMany({
      where: { userId, storeId, instagramAccountId: account.id },
      data: { instagramAccountId: null, respondInstagramDirect: false, respondInstagramComments: false },
    }),
    prisma.aiInstagramAccount.delete({ where: { id: account.id } }),
  ]);
}

export async function sendInstagramDirectMessage(account, recipientId, text) {
  const token = await accountToken(account);
  const chunks = [];
  let current = '';
  for (const character of String(text || '')) {
    if (Buffer.byteLength(current + character, 'utf8') > 950) {
      if (current) chunks.push(current);
      current = character;
    } else current += character;
  }
  if (current) chunks.push(current);
  if (!chunks.length) throw new AppError(400, 'A mensagem do Instagram não pode ficar vazia.');
  let result;
  for (const chunk of chunks) {
    result = await graphRequest('POST', `${encodeURIComponent(account.instagramUserId)}/messages`, token, {
      recipient: { id: recipientId },
      message: { text: chunk },
    });
  }
  return result;
}

export async function replyToInstagramComment(account, commentId, text) {
  const token = await accountToken(account);
  return graphRequest('POST', `${encodeURIComponent(commentId)}/replies`, token, { message: String(text || '').slice(0, 2000) });
}

export async function fetchInstagramAttachment(account, attachment) {
  const allowedUrl = (value) => {
    const url = value instanceof URL ? value : new URL(value);
    const allowedHost = ['cdninstagram.com', 'fbcdn.net', 'fbsbx.com'].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || !allowedHost || url.username || url.password) {
      throw new AppError(400, 'O Instagram forneceu um endereço de mídia inválido.', 'INSTAGRAM_MEDIA_INVALID');
    }
    return url;
  };
  let url;
  try {
    url = allowedUrl(attachment.url);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'O Instagram forneceu um endereço de mídia inválido.', 'INSTAGRAM_MEDIA_INVALID');
  }
  const token = await accountToken(account);
  const maxBytes = attachment.kind === 'audio' ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
  let response = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new AppError(502, 'Não foi possível baixar a mídia enviada pelo Instagram.', 'INSTAGRAM_MEDIA_UNAVAILABLE');
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location || attempt === 3) throw new AppError(502, 'O Instagram redirecionou a mídia para um endereço inválido.', 'INSTAGRAM_MEDIA_INVALID');
    try {
      url = allowedUrl(new URL(location, url));
    } catch {
      throw new AppError(502, 'O Instagram redirecionou a mídia para um endereço inválido.', 'INSTAGRAM_MEDIA_INVALID');
    }
  }
  if (!response?.ok || !response.body) throw new AppError(502, 'O Instagram não permitiu acessar esta mídia.', 'INSTAGRAM_MEDIA_UNAVAILABLE');
  const advertised = Number(response.headers.get('content-length')) || 0;
  if (advertised > maxBytes) throw new AppError(413, 'A mídia enviada excede o limite aceito pelo atendimento.');
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of response.body) {
    byteLength += chunk.length;
    if (byteLength > maxBytes) {
      throw new AppError(413, 'A mídia enviada excede o limite aceito pelo atendimento.');
    }
    chunks.push(Buffer.from(chunk));
  }
  if (!byteLength) throw new AppError(502, 'O Instagram enviou um arquivo vazio.', 'INSTAGRAM_MEDIA_UNAVAILABLE');
  const buffer = Buffer.concat(chunks, byteLength);
  const mime = String(attachment.mime || response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  return {
    kind: attachment.kind,
    mime: mime || (attachment.kind === 'image' ? 'image/jpeg' : 'audio/ogg'),
    name: attachment.name || '',
    size: buffer.length,
    base64: buffer.toString('base64'),
  };
}

function normalizedAttachments(message) {
  return (Array.isArray(message.attachments) ? message.attachments : []).flatMap((attachment) => {
    const type = String(attachment.type || '').toLowerCase();
    const payload = attachment.payload || {};
    const mime = String(payload.mime_type || attachment.mime_type || '').toLowerCase();
    const kind = type === 'audio' || mime.startsWith('audio/')
      ? 'audio'
      : type === 'image' || mime.startsWith('image/')
        ? 'image'
        : type === 'file' || mime === 'application/pdf'
          ? 'document'
          : null;
    const url = payload.url || payload.media_url;
    return kind && url ? [{ kind, mime, name: payload.name || '', url: String(url) }] : [];
  });
}

export function parseInstagramWebhook(payload) {
  if (payload?.object !== 'instagram') return [];
  const events = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    const accountId = String(entry.id || '');
    if (!accountId) continue;
    const messages = [];
    for (const event of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const message = event.message;
      if (!message?.mid || message.is_self || message.is_unsupported) continue;
      const isEcho = Boolean(message.is_echo);
      const senderId = String(event.sender?.id || '');
      const recipientId = String(event.recipient?.id || '');
      const userId = isEcho ? recipientId : senderId;
      if (!userId || userId === accountId) continue;
      const attachments = normalizedAttachments(message);
      const text = String(message.text || '').trim();
      if (!text && !attachments.length) continue;
      messages.push({
        id: String(message.mid),
        userId,
        username: String((isEcho ? event.recipient?.username : event.sender?.username) || ''),
        isEcho,
        text,
        attachments,
      });
    }
    const comments = [];
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (!['comments', 'live_comments'].includes(change.field)) continue;
      const values = Array.isArray(change.value) ? change.value : [change.value];
      for (const value of values) {
        if (value?.verb && value.verb !== 'add') continue;
        if (!value?.id || !value?.from?.id || !value?.text) continue;
        if (String(value.from.id) === accountId) continue;
        comments.push({
          id: String(value.id),
          userId: String(value.from.id),
          username: String(value.from.username || ''),
          text: String(value.text).trim(),
          mediaId: String(value.media?.id || ''),
        });
      }
    }
    if (messages.length || comments.length) events.push({ accountId, messages, comments });
  }
  return events;
}

export const safeInstagramAccount = publicAccount;
