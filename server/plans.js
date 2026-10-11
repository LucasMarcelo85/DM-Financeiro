import { config } from './config.js';

// Limites de cada tipo de usuário.
const LIMITS = {
  bronze: { instances: 1, contracts: 1 },
  prata: { instances: 1, contracts: 3 },
  ouro: { instances: 3, contracts: 4 },
  admin: { instances: 3, contracts: 4 },
};

export const PLAN_IDS = ['bronze', 'prata', 'ouro'];
export const isPlan = (p) => PLAN_IDS.includes(p);

export const planName = (id) => id.charAt(0).toUpperCase() + id.slice(1);
export const priceCents = (id) => Math.round(config.prices[id] * 100);

export function limitsFor(user) {
  return user.role === 'admin' ? LIMITS.admin : LIMITS[user.plan] || LIMITS.bronze;
}

export function listPlans() {
  return PLAN_IDS.map((id) => ({
    id,
    name: planName(id),
    priceCents: priceCents(id),
    ...LIMITS[id],
  }));
}
