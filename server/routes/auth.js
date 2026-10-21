import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { AppError, DAY, isValidCNPJ, isValidCPF, normalizePhone, onlyDigits } from '../utils/helpers.js';
import { auth, clearSession, setSession, touchActivity } from '../middleware/auth.js';
import { publicUser } from '../services/access.js';
import { isPlan, listPlans } from '../plans.js';
import { assertPin, cleanPinTabs, clearPinCookie, clearPinFailures, hashPin, PIN_RE, pinUnlockedUntil, setPinCookie } from '../utils/pin.js';
import { checkCode, pickAdminInstance, recoveryUnavailable, sendCode } from '../services/recovery.js';

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
  res.json({ user: publicUser(req.user), pinUnlockedUntil: pinUnlockedUntil(req, req.user) });
});

// Acha a conta pelo e-mail ou CPF/CNPJ (o mesmo critério do login).
async function findByIdentifier(raw) {
  const identifier = String(raw || '').trim().toLowerCase();
  const digits = onlyDigits(identifier);
  if (identifier.includes('@')) return prisma.user.findUnique({ where: { email: identifier } });
  return digits ? prisma.user.findUnique({ where: { document: digits } }) : null;
}

function cleanPassword(v) {
  const password = String(v || '');
  if (password.length < 8 || password.length > 72) throw new AppError(400, 'A senha precisa ter entre 8 e 72 caracteres.');
  return password;
}

// ---------- Perfil: nome, e-mail, WhatsApp e senha ----------
// Trocar e-mail, WhatsApp ou senha exige a senha atual (o WhatsApp é para onde vão os códigos de recuperação).
router.patch('/auth/profile', auth, async (req, res) => {
  const b = req.body || {};
  const user = req.user;
  const data = {};
  let sensitive = false;

  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (name.length < 3 || name.length > 120) throw new AppError(400, user.kind === 'PF' ? 'Informe seu nome completo.' : 'Informe a razão social.');
    if (name !== user.name) data.name = name;
  }
  if (b.email !== undefined) {
    const email = String(b.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AppError(400, 'E-mail inválido.');
    if (email !== user.email) { data.email = email; sensitive = true; }
  }
  if (b.phone !== undefined) {
    const phone = onlyDigits(b.phone);
    if (phone && !normalizePhone(phone)) throw new AppError(400, 'Telefone inválido. Use DDD + número.');
    if (phone !== user.phone) { data.phone = phone; sensitive = true; }
  }
  if (b.newPassword) {
    data.passwordHash = bcrypt.hashSync(cleanPassword(b.newPassword), 10);
    sensitive = true;
  }
  if (!Object.keys(data).length) throw new AppError(400, 'Nada para atualizar.');
  if (sensitive && !bcrypt.compareSync(String(b.currentPassword || ''), user.passwordHash)) {
    throw new AppError(403, 'Senha atual incorreta.', 'PASSWORD_WRONG');
  }

  try {
    const updated = await prisma.user.update({ where: { id: user.id }, data });
    res.json({ user: publicUser(updated) });
  } catch (e) {
    if (e.code === 'P2002') throw new AppError(409, 'Já existe uma conta com este e-mail.');
    throw e;
  }
});

// ---------- Esqueci a senha (login) ----------
// O código chega pelo WhatsApp conectado do administrador, no telefone cadastrado da conta.
// A resposta é sempre a mesma, exista a conta ou não (não revela quem tem cadastro).
router.post('/auth/forgot', async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();
  if (!identifier) throw new AppError(400, 'Informe seu e-mail ou CPF/CNPJ.');
  const inst = await pickAdminInstance();
  if (!inst) throw recoveryUnavailable();
  const user = await findByIdentifier(identifier);
  if (user) await sendCode(user, 'reset_password', inst);
  res.json({ ok: true });
});

router.post('/auth/reset', async (req, res) => {
  const b = req.body || {};
  const password = cleanPassword(b.password);
  const user = await findByIdentifier(b.identifier);
  if (!user) throw new AppError(400, 'Código inválido ou expirado. Peça um novo código.', 'CODE_INVALID');
  await checkCode(user.id, 'reset_password', b.code);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: bcrypt.hashSync(password, 10) } });
  res.json({ ok: true });
});

// ---------- Código PIN ----------
// Criar ou alterar: quando já existe um PIN, é preciso digitar o PIN atual. `pin` pode ser omitido para mudar só as abas.
router.put('/auth/pin', auth, async (req, res) => {
  const user = req.user;
  const b = req.body || {};
  const tabs = cleanPinTabs(b.tabs);
  if (user.pinHash) assertPin(user, b.currentPin);

  let pinHash = user.pinHash;
  if (b.pin !== undefined && b.pin !== null && b.pin !== '') {
    if (!PIN_RE.test(String(b.pin))) throw new AppError(400, 'O código PIN deve ter de 4 a 8 números.');
    pinHash = hashPin(String(b.pin));
  } else if (!user.pinHash) {
    throw new AppError(400, 'Digite o código PIN que você quer usar (de 4 a 8 números).');
  }
  const updated = await prisma.user.update({ where: { id: user.id }, data: { pinHash, pinTabs: tabs } });
  const until = setPinCookie(res, updated); // quem acabou de definir o PIN já fica com as abas liberadas neste navegador
  res.json({ user: publicUser(updated), pinUnlockedUntil: until });
});

router.post('/auth/pin/disable', auth, async (req, res) => {
  assertPin(req.user, req.body?.currentPin);
  const updated = await prisma.user.update({ where: { id: req.user.id }, data: { pinHash: null, pinTabs: [] } });
  clearPinCookie(res);
  res.json({ user: publicUser(updated), pinUnlockedUntil: null });
});

router.post('/auth/pin/verify', auth, (req, res) => {
  assertPin(req.user, req.body?.pin);
  res.json({ ok: true, pinUnlockedUntil: setPinCookie(res, req.user) });
});

// Trava as abas de novo agora (sem esperar o tempo acabar).
router.post('/auth/pin/lock', auth, (_req, res) => {
  clearPinCookie(res);
  res.json({ ok: true, pinUnlockedUntil: null });
});

// Esqueci o código PIN: confirma que é a própria conta (e-mail ou CPF/CNPJ) e manda um código pelo WhatsApp do administrador.
router.post('/auth/pin/forgot', auth, async (req, res) => {
  const user = req.user;
  if (!user.pinHash) throw new AppError(400, 'Você ainda não criou um código PIN.', 'PIN_NOT_SET');
  const identifier = String(req.body?.identifier || '').trim().toLowerCase();
  const digits = onlyDigits(identifier);
  const same = identifier.includes('@') ? identifier === user.email : Boolean(digits) && digits === user.document;
  if (!same) throw new AppError(400, 'Os dados informados não conferem com a sua conta.');
  const number = normalizePhone(user.phone);
  if (!number) throw new AppError(400, 'Sua conta não tem WhatsApp cadastrado. Cadastre o número em Perfil > Configurar para receber o código.', 'NO_PHONE');
  const inst = await pickAdminInstance();
  if (!inst) throw recoveryUnavailable();
  const r = await sendCode(user, 'reset_pin', inst);
  if (!r.sent) throw new AppError(429, 'Um código já foi enviado há pouco. Aguarde 1 minuto para pedir outro.', 'CODE_WAIT');
  res.json({ ok: true, phoneHint: `final ${number.slice(-4)}` });
});

// Com o código certo, define um PIN novo (se `pin` vier) ou remove o PIN.
router.post('/auth/pin/reset', auth, async (req, res) => {
  const user = req.user;
  if (!user.pinHash) throw new AppError(400, 'Você ainda não criou um código PIN.', 'PIN_NOT_SET');
  const pin = req.body?.pin;
  const wantsNew = pin !== undefined && pin !== null && pin !== '';
  if (wantsNew && !PIN_RE.test(String(pin))) throw new AppError(400, 'O código PIN deve ter de 4 a 8 números.');
  await checkCode(user.id, 'reset_pin', req.body?.code);
  clearPinFailures(user.id);
  if (wantsNew) {
    const updated = await prisma.user.update({ where: { id: user.id }, data: { pinHash: hashPin(String(pin)) } });
    return res.json({ user: publicUser(updated), pinUnlockedUntil: setPinCookie(res, updated) });
  }
  const updated = await prisma.user.update({ where: { id: user.id }, data: { pinHash: null, pinTabs: [] } });
  clearPinCookie(res);
  res.json({ user: publicUser(updated), pinUnlockedUntil: null });
});

export default router;
