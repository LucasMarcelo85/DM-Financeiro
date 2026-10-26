import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { DAY } from '../utils/helpers.js';
import { limitsFor, planColor, planName, trialSettings } from '../plans.js';

const ms = (d) => (d ? d.getTime() : 0);

// status: 'admin' | 'paid' | 'trial' | 'expired'
export function computeAccess(user) {
  if (user.role === 'admin') return { status: 'admin', hasAccess: true, endsAt: null, daysLeft: null };
  const now = Date.now();
  const endsAt = Math.max(ms(user.accessUntil), ms(user.trialEndsAt));
  const hasAccess = endsAt > now;
  const status = ms(user.accessUntil) > now ? 'paid' : ms(user.trialEndsAt) > now ? 'trial' : 'expired';
  return { status, hasAccess, endsAt, daysLeft: hasAccess ? Math.ceil((endsAt - now) / DAY) : 0 };
}

// Filtro Prisma: usuários que ainda podem usar o sistema (usado pelo agendador).
export const accessibleUserFilter = (now = new Date()) => ({
  OR: [{ role: 'admin' }, { trialEndsAt: { gt: now } }, { accessUntil: { gt: now } }],
});

export function publicUser(user) {
  return {
    id: user.id,
    kind: user.kind,
    name: user.name,
    document: user.document,
    email: user.email,
    phone: user.phone,
    role: user.role,
    plan: user.plan,
    planName: user.role === 'admin' ? 'Admin' : planName(user.plan),
    planColor: user.role === 'admin' ? '' : planColor(user.plan),
    createdAt: ms(user.createdAt),
    access: computeAccess(user),
    limits: limitsFor(user),
    // Só diz SE existe PIN e quais abas ele protege (o hash nunca sai do servidor).
    pin: { enabled: Boolean(user.pinHash), tabs: user.pinHash ? user.pinTabs || [] : [] },
    timezone: config.timezone,
  };
}

// Soma dias a partir do que o usuário ainda tem (teste ou pagamento), sem perder tempo restante.
export async function extendAccess(userId, days, plan, db = prisma) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const base = Math.max(Date.now(), ms(user.accessUntil), ms(user.trialEndsAt));
  return db.user.update({
    where: { id: userId },
    data: { accessUntil: new Date(base + days * DAY), ...(plan ? { plan } : {}) },
  });
}

// ---------- Liberações do administrador (com histórico, para poder retroceder) ----------
export const eventDTO = (e) => ({
  id: e.id, kind: e.kind, days: e.days, adminName: e.adminName, createdAt: ms(e.createdAt), revertedAt: e.revertedAt ? ms(e.revertedAt) : null,
});

// kind 'mensal': soma 30 dias de acesso pago · kind 'teste': soma os dias configurados para o teste grátis.
export async function grantAccess(userId, kind, admin) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    const now = Date.now();
    const days = kind === 'teste' ? trialSettings().days : config.accessDays;
    const data = kind === 'teste'
      ? { trialEndsAt: new Date(Math.max(now, ms(user.trialEndsAt)) + days * DAY) }
      : { accessUntil: new Date(Math.max(now, ms(user.accessUntil), ms(user.trialEndsAt)) + days * DAY) };
    const updated = await tx.user.update({ where: { id: userId }, data });
    const event = await tx.accessEvent.create({
      data: {
        userId, adminId: admin.id, adminName: admin.name, kind, days,
        prevAccessUntil: user.accessUntil, prevTrialEndsAt: user.trialEndsAt,
        newAccessUntil: updated.accessUntil, newTrialEndsAt: updated.trialEndsAt,
      },
    });
    return { user: updated, event };
  });
}

// Desfaz a liberação mais recente que ainda não foi desfeita. Devolve null se não houver nenhuma.
// Se o usuário pagou depois da liberação, o que ele pagou é preservado: só saem os dias liberados pelo admin.
export async function undoLastGrant(userId) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.accessEvent.findFirst({ where: { userId, revertedAt: null }, orderBy: { id: 'desc' } });
    if (!event) return null;
    const user = await tx.user.findUnique({ where: { id: userId } });
    let data;
    if (event.kind === 'teste') {
      data = { trialEndsAt: event.prevTrialEndsAt };
    } else {
      const untouched = ms(user.accessUntil) === ms(event.newAccessUntil);
      let next = untouched ? event.prevAccessUntil : new Date(Math.max(ms(user.accessUntil) - event.days * DAY, ms(event.prevAccessUntil)));
      if (next && !event.prevAccessUntil && next.getTime() <= Date.now()) next = null;
      data = { accessUntil: next };
    }
    const updated = await tx.user.update({ where: { id: userId }, data });
    const done = await tx.accessEvent.update({ where: { id: event.id }, data: { revertedAt: new Date() } });
    return { user: updated, event: done };
  });
}
