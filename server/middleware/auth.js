import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db.js';
import { AppError } from '../utils/helpers.js';
import { computeAccess } from '../services/access.js';

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
}

export const clearSession = (res) => res.clearCookie(COOKIE, { path: '/' });

export function auth(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new AppError(401, 'Faça login para continuar.', 'UNAUTHENTICATED');
  let id;
  try {
    id = jwt.verify(token, config.jwtSecret).id;
  } catch {
    throw new AppError(401, 'Sua sessão expirou. Entre novamente.', 'UNAUTHENTICATED');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new AppError(401, 'Sua sessão expirou. Entre novamente.', 'UNAUTHENTICATED');
  req.user = user;
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
