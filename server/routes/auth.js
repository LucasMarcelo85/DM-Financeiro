import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { db } from '../db.js';
import { AppError, DAY, isValidCNPJ, isValidCPF, normalizePhone, onlyDigits } from '../utils/helpers.js';
import { auth, clearSession, setSession } from '../middleware/auth.js';
import { publicUser } from '../services/access.js';
import { isPlan, listPlans } from '../plans.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.get('/plans', (_req, res) => {
  res.json({ trialDays: config.trialDays, accessDays: config.accessDays, plans: listPlans() });
});

router.post('/auth/register', (req, res) => {
  const b = req.body || {};
  const kind = b.kind === 'PJ' ? 'PJ' : b.kind === 'PF' ? 'PF' : null;
  if (!kind) throw new AppError(400, 'Escolha se você é pessoa física ou jurídica.');

  const name = String(b.name || '').trim();
  const document = onlyDigits(b.document);
  const email = String(b.email || '').trim().toLowerCase();
  const phone = onlyDigits(b.phone);
  const password = String(b.password || '');
  const plan = isPlan(b.plan) ? b.plan : 'bronze';

  if (name.length < 3 || name.length > 120) throw new AppError(400, kind === 'PF' ? 'Informe seu nome completo.' : 'Informe a razão social.');
  if (kind === 'PF' && !isValidCPF(document)) throw new AppError(400, 'CPF inválido. Confira os números.');
  if (kind === 'PJ' && !isValidCNPJ(document)) throw new AppError(400, 'CNPJ inválido. Confira os números.');
  if (!EMAIL_RE.test(email)) throw new AppError(400, 'E-mail inválido.');
  if (phone && !normalizePhone(phone)) throw new AppError(400, 'Telefone inválido. Use DDD + número.');
  if (password.length < 8 || password.length > 72) throw new AppError(400, 'A senha precisa ter entre 8 e 72 caracteres.');

  const exists = db.prepare('SELECT document, email FROM users WHERE document = ? OR email = ?').get(document, email);
  if (exists) {
    throw new AppError(409, exists.document === document ? 'Já existe uma conta com este CPF/CNPJ.' : 'Já existe uma conta com este e-mail.');
  }

  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO users (kind, name, document, email, phone, password_hash, role, plan, trial_ends_at, access_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'usuario', ?, ?, 0, ?)`
    )
    .run(kind, name, document, email, phone, bcrypt.hashSync(password, 10), plan, now + config.trialDays * DAY, now);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  setSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/auth/login', (req, res) => {
  const identifier = String(req.body?.identifier || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const digits = onlyDigits(identifier);

  const user = identifier.includes('@')
    ? db.prepare('SELECT * FROM users WHERE email = ?').get(identifier)
    : digits
      ? db.prepare('SELECT * FROM users WHERE document = ?').get(digits)
      : null;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw new AppError(401, 'E-mail, CPF/CNPJ ou senha incorretos.');
  }
  setSession(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/auth/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
