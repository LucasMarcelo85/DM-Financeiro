import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { AppError, DAY, isValidCNPJ, isValidCPF, normalizePhone, onlyDigits } from '../utils/helpers.js';
import { auth, clearSession, setSession, touchActivity } from '../middleware/auth.js';
import { publicUser } from '../services/access.js';
import { isPlan, listPlans } from '../plans.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.get('/plans', (_req, res) => {
  res.json({ trialDays: config.trialDays, accessDays: config.accessDays, plans: listPlans() });
});

router.post('/auth/register', async (req, res) => {
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

  const exists = await prisma.user.findFirst({ where: { OR: [{ document }, { email }] }, select: { document: true } });
  if (exists) throw new AppError(409, exists.document === document ? 'Já existe uma conta com este CPF/CNPJ.' : 'Já existe uma conta com este e-mail.');

  let user;
  try {
    user = await prisma.user.create({
      data: { kind, name, document, email, phone, passwordHash: bcrypt.hashSync(password, 10), plan, trialEndsAt: new Date(Date.now() + config.trialDays * DAY) },
    });
  } catch (e) {
    if (e.code === 'P2002') throw new AppError(409, 'Já existe uma conta com este CPF/CNPJ ou e-mail.');
    throw e;
  }
  setSession(res, user.id);
  touchActivity(user.id, 'Cadastro');
  res.status(201).json({ user: publicUser(user) });
});

router.post('/auth/login', async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const digits = onlyDigits(identifier);

  const user = identifier.includes('@')
    ? await prisma.user.findUnique({ where: { email: identifier } })
    : digits
      ? await prisma.user.findUnique({ where: { document: digits } })
      : null;

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    throw new AppError(401, 'E-mail, CPF/CNPJ ou senha incorretos.');
  }
  setSession(res, user.id);
  touchActivity(user.id, 'Login');
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
