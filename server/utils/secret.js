import crypto from 'node:crypto';
import { config } from '../config.js';

// Criptografia (AES-256-GCM) para guardar tokens de terceiros no banco sem deixá-los em texto puro.
// Formato: v1.<iv>.<tag>.<dados> (base64url). Quem ler só o banco não consegue usar o token.
const b64 = (buf) => buf.toString('base64url');

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.secretKey, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', b64(iv), b64(cipher.getAuthTag()), b64(data)].join('.');
}

// Devolve null se o valor não existir ou não puder ser aberto (ex.: chave de criptografia trocada).
export function decrypt(stored) {
  if (!stored) return null;
  const [v, iv, tag, data] = String(stored).split('.');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', config.secretKey, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// Assinatura estável derivada da chave do sistema (ex.: o segredo do webhook de cada conexão).
export const hmac = (label, value) => crypto.createHmac('sha256', config.secretKey).update(`${label}:${value}`).digest('hex').slice(0, 40);

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
