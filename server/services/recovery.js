import crypto from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { AppError, normalizePhone } from '../utils/helpers.js';
import * as wa from './whatsapp.js';

// Códigos de confirmação (recuperar senha / código PIN) enviados pelo WhatsApp conectado do ADMINISTRADOR
// para o telefone cadastrado do usuário.
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const RESEND_GAP_MS = 60_000;

const PURPOSE_TEXT = { reset_password: 'redefinir a sua senha', reset_pin: 'redefinir o seu código PIN' };

// Só o hash do código fica no banco.
const hashCode = (userId, purpose, code) => crypto.createHmac('sha256', config.secretKey).update(`${userId}:${purpose}:${code}`).digest('hex');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Primeira conexão do administrador que está aberta (prefere a de envio; se não houver, usa a de auditoria).
export async function pickAdminInstance() {
  const insts = await prisma.instance.findMany({ where: { user: { role: 'admin' } }, orderBy: [{ purpose: 'asc' }, { id: 'asc' }], include: { user: true } });
  for (const inst of insts) {
    try {
      if ((await wa.getState(inst)) === 'open') return inst;
    } catch { /* tenta a próxima */ }
  }
  return null;
}

export const recoveryUnavailable = () =>
  new AppError(503, 'O envio do código está indisponível no momento. Fale com o administrador do sistema.', 'RECOVERY_UNAVAILABLE');

/**
 * Cria um código de 6 dígitos e envia pelo WhatsApp do admin (`inst`) para o telefone do usuário.
 * Devolve { sent: true } ou { sent: false, reason: 'no_phone' | 'wait' }. Falha no envio lança erro.
 */
export async function sendCode(user, purpose, inst) {
  const number = normalizePhone(user.phone);
  if (!number) return { sent: false, reason: 'no_phone' };

  const last = await prisma.verificationCode.findFirst({ where: { userId: user.id, purpose }, orderBy: { id: 'desc' } });
  if (last && Date.now() - last.createdAt.getTime() < RESEND_GAP_MS) return { sent: false, reason: 'wait' };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.verificationCode.deleteMany({ where: { userId: user.id, purpose } });
  const row = await prisma.verificationCode.create({
    data: { userId: user.id, purpose, codeHash: hashCode(user.id, purpose, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  const text = `*DM Financeiro*\nSeu código para ${PURPOSE_TEXT[purpose]} é: *${code}*\n\nEle vale por ${CODE_TTL_MS / 60_000} minutos. Se não foi você, ignore esta mensagem e não passe o código para ninguém.`;
  try {
    await wa.sendText(inst, number, text);
  } catch (e) {
    await prisma.verificationCode.delete({ where: { id: row.id } }).catch(() => {});
    console.warn(`[recuperação] não foi possível enviar o código: ${e.message}`);
    throw new AppError(502, 'Não foi possível enviar o código pelo WhatsApp agora. Tente novamente em instantes.', 'RECOVERY_SEND_FAILED');
  }
  return { sent: true };
}

// Confere o código digitado. Se estiver certo, ele é apagado (só vale uma vez).
export async function checkCode(userId, purpose, code) {
  const typed = String(code ?? '').replace(/\D/g, '');
  const row = await prisma.verificationCode.findFirst({ where: { userId, purpose }, orderBy: { id: 'desc' } });
  if (!row || row.expiresAt.getTime() < Date.now() || row.attempts >= MAX_ATTEMPTS) {
    if (row) await prisma.verificationCode.deleteMany({ where: { userId, purpose } });
    throw new AppError(400, 'Código inválido ou expirado. Peça um novo código.', 'CODE_INVALID');
  }
  if (typed.length !== 6 || !safeEqual(hashCode(userId, purpose, typed), row.codeHash)) {
    await prisma.verificationCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new AppError(400, 'Código incorreto. Confira o número recebido no WhatsApp.', 'CODE_WRONG');
  }
  await prisma.verificationCode.deleteMany({ where: { userId, purpose } });
}
