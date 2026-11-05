import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { readLimits } from './app-access.js';

// Cada app de loja tem uma "área de trabalho" própria: um usuário interno que guarda os WhatsApps, clientes,
// lembretes, contratos, portfólio e IA do app, separados dos do dono. Ele nunca faz login nem aparece no admin.
export const WORKSPACE_EMAIL_SUFFIX = '@workspace.invalid';
const emailFor = (storeId) => `ws-${storeId}${WORKSPACE_EMAIL_SUFFIX}`;
export const workspaceEmailFor = (storeId) => emailFor(storeId);

export async function workspaceFor(store, owner) {
  const email = emailFor(store.id);
  const found = await prisma.user.findUnique({ where: { email } });
  if (found) return found;
  try {
    return await prisma.user.create({
      data: {
        kind: 'PJ',
        name: store.appName || store.name,
        document: `ws-${store.id}`,
        email,
        passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
        plan: owner.plan,
        trialEndsAt: new Date('2999-01-01'), // só para a limpeza de contas vencidas nunca apagar a área do app; o acesso real é o do dono
      },
    });
  } catch (e) {
    if (e.code === 'P2002') return prisma.user.findUniqueOrThrow({ where: { email } });
    throw e;
  }
}

// O que o dono repartiu com este app: nunca passa do limite do plano dele (limitsFor aplica o mínimo).
export function workspaceCaps(store) {
  const limits = readLimits(store);
  return {
    instances: limits.wsInstances || 0,
    contracts: limits.contracts || 0,
    portfolios: limits.portfolios || 0,
    auditInstances: 0,
    catalogProducts: 0,
    stores: 0,
  };
}

// Usuário usado pelas rotas existentes: acesso e plano seguem o dono; os limites seguem o que foi repartido.
export function workspaceUser(ws, store, owner) {
  return {
    ...ws,
    name: store.appName || store.name,
    plan: owner.plan,
    planPriceCents: null,
    trialEndsAt: owner.trialEndsAt,
    accessUntil: owner.accessUntil,
    pinHash: null,
    pinTabs: [],
    limitCaps: workspaceCaps(store),
    appLimits: readLimits(store),
  };
}

export const dropWorkspace = (storeId) => prisma.user.deleteMany({ where: { email: emailFor(storeId) } });
