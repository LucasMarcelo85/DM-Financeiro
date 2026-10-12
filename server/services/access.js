import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { DAY } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';

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
    createdAt: ms(user.createdAt),
    access: computeAccess(user),
    limits: limitsFor(user),
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
