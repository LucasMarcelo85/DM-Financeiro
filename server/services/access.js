import { db } from '../db.js';
import { DAY } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';

// status: 'admin' | 'paid' | 'trial' | 'expired'
export function computeAccess(user) {
  if (user.role === 'admin') return { status: 'admin', hasAccess: true, endsAt: null, daysLeft: null };
  const now = Date.now();
  const endsAt = Math.max(user.access_until, user.trial_ends_at);
  const hasAccess = endsAt > now;
  const status = user.access_until > now ? 'paid' : user.trial_ends_at > now ? 'trial' : 'expired';
  return { status, hasAccess, endsAt, daysLeft: hasAccess ? Math.ceil((endsAt - now) / DAY) : 0 };
}

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
    createdAt: user.created_at,
    access: computeAccess(user),
    limits: limitsFor(user),
  };
}

// Soma dias a partir do que o usuário ainda tem (teste ou pagamento), sem perder tempo restante.
export function extendAccess(userId, days, plan) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const base = Math.max(Date.now(), user.access_until, user.trial_ends_at);
  const until = base + days * DAY;
  db.prepare('UPDATE users SET access_until = ?, plan = ? WHERE id = ?').run(until, plan || user.plan, userId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}
