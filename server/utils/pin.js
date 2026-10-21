import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { AppError } from './helpers.js';

// Abas do menu que o usuário pode proteger com o código PIN (mesmas chaves usadas pela tela: client/src/lib/pin.js).
export const PIN_TABS = ['inicio', 'whatsapp', 'clientes', 'cobrancas', 'lembretes', 'contratos', 'auditoria', 'portfolio', 'plano', 'admin'];
export const PIN_RE = /^\d{4,8}$/;
export const PIN_COOKIE = 'dm_pin';

// "Impressão digital" do PIN atual: se o PIN mudar ou for removido, o desbloqueio antigo deixa de valer.
const fingerprint = (user) => crypto.createHash('sha256').update(user.pinHash || '').digest('hex').slice(0, 16);
const cookieOptions = (maxAge) => ({ httpOnly: true, sameSite: 'lax', secure: config.appUrl.startsWith('https://'), maxAge, path: '/' });

// Depois de digitar o PIN certo, a aba fica liberada por alguns minutos (cookie assinado, só do navegador de quem digitou).
export function setPinCookie(res, user) {
  const ttl = config.pinUnlockMinutes * 60_000;
  const token = jwt.sign({ id: user.id, f: fingerprint(user) }, config.jwtSecret, { expiresIn: Math.floor(ttl / 1000) });
  res.cookie(PIN_COOKIE, token, cookieOptions(ttl));
  return Date.now() + ttl;
}
export const clearPinCookie = (res) => res.clearCookie(PIN_COOKIE, { path: '/' });

// Até quando o PIN está destravado neste navegador (ms) ou null se está travado / não há PIN.
export function pinUnlockedUntil(req, user) {
  if (!user?.pinHash) return null;
  const token = req.cookies?.[PIN_COOKIE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, config.jwtSecret);
    if (p.id === user.id && p.f === fingerprint(user)) return p.exp * 1000;
  } catch { /* expirado ou inválido */ }
  return null;
}

export const isTabLocked = (req, user, tab) => Boolean(user.pinHash) && (user.pinTabs || []).includes(tab) && !pinUnlockedUntil(req, user);

export const hashPin = (pin) => bcrypt.hashSync(pin, 10);

// Limite de tentativas: 5 erradas seguidas travam as tentativas por 15 minutos (por usuário).
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const fails = new Map(); // userId -> { count, until }

export function assertPinAttemptsAllowed(userId) {
  const f = fails.get(userId);
  if (f?.until > Date.now()) {
    throw new AppError(429, `Muitas tentativas erradas. Aguarde ${Math.ceil((f.until - Date.now()) / 60_000)} min para tentar de novo ou use "Esqueci o código PIN".`, 'PIN_LOCKED');
  }
}
export const clearPinFailures = (userId) => fails.delete(userId);
function registerPinFailure(userId) {
  const f = fails.get(userId);
  const count = (f && (!f.until || f.until > Date.now()) ? f.count : 0) + 1;
  fails.set(userId, count >= MAX_FAILS ? { count: 0, until: Date.now() + LOCK_MS } : { count, until: 0 });
}

// Confere o PIN digitado. Lança erro se estiver errado (e conta a tentativa).
export function assertPin(user, pin) {
  if (!user.pinHash) throw new AppError(400, 'Você ainda não criou um código PIN.', 'PIN_NOT_SET');
  assertPinAttemptsAllowed(user.id);
  if (!PIN_RE.test(String(pin ?? '')) || !bcrypt.compareSync(String(pin), user.pinHash)) {
    registerPinFailure(user.id);
    throw new AppError(403, 'Código PIN incorreto.', 'PIN_WRONG');
  }
  clearPinFailures(user.id);
}

// Valida a lista de abas escolhidas para proteger.
export function cleanPinTabs(tabs) {
  const list = [...new Set((Array.isArray(tabs) ? tabs : []).map(String))];
  if (!list.length) throw new AppError(400, 'Escolha pelo menos uma aba para proteger com o PIN.');
  if (list.some((t) => !PIN_TABS.includes(t))) throw new AppError(400, 'Uma das abas escolhidas é inválida.');
  return PIN_TABS.filter((t) => list.includes(t));
}
