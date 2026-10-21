import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { computeAccess } from '../services/access.js';
import { clearPinCookie, isTabLocked } from '../utils/pin.js';

export const COOKIE = 'dm_token';
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function setSession(res, userId) {
  const token = jwt.sign({ id: userId }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.appUrl.startsWith('https://'),
    maxAge: WEEK,
    path: '/',
  });
  clearPinCookie(res); // entrar de novo nunca deixa as abas com PIN destravadas
}

export const clearSession = (res) => {
  res.clearCookie(COOKIE, { path: '/' });
  clearPinCookie(res);
};

// Em que parte do sistema o usuário mexeu (aparece para o administrador).
const AREAS = {
  '/api/contacts': 'Clientes', '/api/schedules': 'Cobranças e lembretes', '/api/messages': 'Mensagens', '/api/instances': 'WhatsApp',
  '/api/contracts': 'Contratos', '/api/portfolios': 'Portfólio', '/api/audit': 'Auditoria', '/api/billing': 'Plano e pagamento', '/api/receipts': 'Faturamento', '/api/auth': 'Conta',
};
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ACTIVITY_EVERY_MS = 30_000;

// Marca "agora" como a última atividade do usuário (login, ou qualquer alteração que ele faça).
export const touchActivity = (userId, area) =>
  prisma.user.update({ where: { id: userId }, data: { lastActivityAt: new Date(), lastActivity: area } }).catch(() => {});

export async function auth(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new AppError(401, 'Faça login para continuar.', 'UNAUTHENTICATED');
  let id;
  try {
    id = jwt.verify(token, config.jwtSecret).id;
  } catch {
    throw new AppError(401, 'Sua sessão expirou. Entre novamente.', 'UNAUTHENTICATED');
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError(401, 'Sua sessão expirou. Entre novamente.', 'UNAUTHENTICATED');
  req.user = user;
  // Só alterações contam como "mexeu em algo" (abrir telas e atualizações automáticas, não). No máximo 1 gravação a cada 30 s.
  if (WRITES.has(req.method) && (!user.lastActivityAt || Date.now() - user.lastActivityAt.getTime() > ACTIVITY_EVERY_MS)) {
    touchActivity(user.id, AREAS[req.baseUrl] || 'Sistema');
  }
  next();
}

export function requireAccess(req, _res, next) {
  if (!computeAccess(req.user).hasAccess) {
    throw new AppError(402, 'Seu teste grátis acabou. Faça o pagamento para continuar usando o sistema.', 'PAYMENT_REQUIRED');
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user.role !== 'admin') throw new AppError(403, 'Acesso restrito ao administrador.', 'FORBIDDEN');
  next();
}

// Protege no servidor as APIs que só uma aba usa (auditoria, contratos, portfólio): se o usuário travou a aba com PIN
// e ainda não digitou o código, a API responde 423 e a tela pede o PIN. (Clientes e WhatsApp são usados por outras telas
// também, então nelas o bloqueio é só na tela.)
export const pinGuard = (tab) => (req, _res, next) => {
  if (isTabLocked(req, req.user, tab)) throw new AppError(423, 'Esta aba está protegida por código PIN. Digite o PIN para continuar.', 'PIN_REQUIRED');
  next();
};
