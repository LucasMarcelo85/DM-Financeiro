import { prisma } from '../prisma.js';
import { AppError } from './helpers.js';
import { accessibleUserFilter } from '../services/access.js';

// Escopo de loja nas rotas do painel: `?store=<id>` escolhe uma loja extra; sem o parâmetro vale a loja principal (a conta).
// Devolve o id da loja (ou null) depois de conferir que ela é do usuário.
export async function storeScope(req) {
  if (req.forcedStore !== undefined) return req.forcedStore; // app do lojista: a loja vem do login, não da URL
  const raw = req.query?.store;
  if (raw === undefined || raw === '' || raw === '0' || raw === 'main') return null;
  const id = Number(raw);
  const store = Number.isInteger(id) ? await prisma.store.findFirst({ where: { id, userId: req.user.id }, select: { id: true } }) : null;
  if (!store) throw new AppError(404, 'Loja não encontrada.');
  return store.id;
}

// Endereço público (`u`): é o endereço de uma loja extra ou o endereço da conta. Só devolve donos com acesso ativo.
export async function resolvePublicOwner(slug, select) {
  const s = String(slug || '').toLowerCase();
  const store = await prisma.store.findUnique({ where: { slug: s }, include: { user: { select } } });
  if (store) {
    const active = await prisma.user.findFirst({ where: { id: store.userId, ...accessibleUserFilter() }, select: { id: true } });
    return active ? { owner: store.user, store } : null;
  }
  const owner = await prisma.user.findFirst({ where: { portfolioSlug: s, ...accessibleUserFilter() }, select });
  return owner ? { owner, store: null } : null;
}
