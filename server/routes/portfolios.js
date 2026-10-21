import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { cleanPortfolioDoc, cleanPortfolioName, emptyPortfolioDoc } from '../utils/portfolio.js';
import { isValidSlug, pickSlug, slugify } from '../utils/slug.js';

// Portfólio do usuário logado: páginas públicas personalizáveis.
// Endereço: dominio/<portfolioSlug do usuário> = página principal; dominio/<portfolioSlug>/<slug da página> = as demais.
const router = Router();

const ms = (d) => (d ? d.getTime() : null);
const pagePath = (userSlug, p) => (p.isMain ? `/${userSlug}` : `/${userSlug}/${p.slug}`);
const summaryDTO = (p, userSlug) => ({
  id: p.id, name: p.name, slug: p.slug, published: p.published, isMain: p.isMain,
  path: pagePath(userSlug, p), createdAt: ms(p.createdAt), updatedAt: ms(p.updatedAt),
});
const fullDTO = (p, userSlug) => ({ ...summaryDTO(p, userSlug), data: p.data });
const summarySelect = { id: true, name: true, slug: true, published: true, isMain: true, createdAt: true, updatedAt: true };

async function owned(req, withData = false) {
  const id = Number(req.params.id);
  const p = Number.isInteger(id)
    ? await prisma.portfolio.findFirst({ where: { id, userId: req.user.id }, ...(withData ? {} : { select: summarySelect }) })
    : null;
  if (!p) throw new AppError(404, 'Página não encontrada.');
  return p;
}

// ---------- Endereços ----------
// Endereço do usuário: feito do nome completo / razão social. Se já existir igual, vira "nome-2", "nome-3"...
async function suggestUserSlug(user) {
  const base = slugify(user.name) || `usuario-${user.id}`;
  const rows = await prisma.user.findMany({ where: { portfolioSlug: { startsWith: base } }, select: { portfolioSlug: true } });
  return pickSlug(base, new Set(rows.map((r) => r.portfolioSlug)), { reserved: true });
}

// Cria o endereço do usuário na primeira página e o mantém para sempre (links já enviados não quebram).
async function ensureUserSlug(user) {
  if (user.portfolioSlug) return user.portfolioSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const slug = await suggestUserSlug(user);
      const r = await prisma.user.updateMany({ where: { id: user.id, portfolioSlug: null }, data: { portfolioSlug: slug } });
      if (r.count === 1) return slug;
      const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { portfolioSlug: true } });
      if (fresh?.portfolioSlug) return fresh.portfolioSlug;
    } catch (e) {
      if (e?.code !== 'P2002') throw e; // outro usuário pegou o mesmo endereço agora: tenta o próximo
    }
  }
  throw new AppError(500, 'Não foi possível criar o seu endereço. Tente novamente.');
}

async function freePageSlug(userId, base) {
  const root = slugify(base) || 'pagina';
  const rows = await prisma.portfolio.findMany({ where: { userId, slug: { startsWith: root } }, select: { slug: true } });
  return pickSlug(root, new Set(rows.map((r) => r.slug)));
}

// Cada plano tem um número máximo de páginas. Devolve quantas o usuário já tem.
async function assertCanCreate(user) {
  const limit = limitsFor(user).portfolios;
  const count = await prisma.portfolio.count({ where: { userId: user.id } });
  if (count >= limit) {
    throw new AppError(403, `Seu plano permite ${limit} ${limit === 1 ? 'página de portfólio' : 'páginas de portfólio'}. Exclua uma página ou mude de plano para criar mais.`, 'LIMIT_REACHED');
  }
  return count;
}

async function createPage(user, { name, data, count, published = false }) {
  const userSlug = await ensureUserSlug(user);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await freePageSlug(user.id, name);
    try {
      const p = await prisma.portfolio.create({ data: { userId: user.id, name, slug, data, published, isMain: count === 0 } });
      return { page: p, userSlug };
    } catch (e) {
      if (e?.code !== 'P2002' || attempt === 2) throw e; // outro salvamento pegou o mesmo endereço: tenta de novo
    }
  }
  return null;
}

// ---------- Rotas ----------
// A lista não traz o conteúdo (pode ter imagens pesadas): só o resumo de cada página.
router.get('/', async (req, res) => {
  const rows = await prisma.portfolio.findMany({ where: { userId: req.user.id }, orderBy: [{ isMain: 'desc' }, { updatedAt: 'desc' }], select: summarySelect });
  const userSlug = req.user.portfolioSlug || (await suggestUserSlug(req.user));
  res.json({ portfolios: rows.map((p) => summaryDTO(p, userSlug)), limit: limitsFor(req.user).portfolios, userSlug });
});

router.get('/:id', async (req, res) => {
  const p = await owned(req, true);
  res.json({ portfolio: fullDTO(p, req.user.portfolioSlug) });
});

router.post('/', async (req, res) => {
  const count = await assertCanCreate(req.user);
  const name = cleanPortfolioName(req.body?.name);
  const data = req.body?.data === undefined ? emptyPortfolioDoc() : cleanPortfolioDoc(req.body.data);
  const { page, userSlug } = await createPage(req.user, { name, data, count });
  res.status(201).json({ portfolio: fullDTO(page, userSlug) });
});

router.patch('/:id', async (req, res) => {
  const current = await owned(req);
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) patch.name = cleanPortfolioName(body.name);
  if (body.data !== undefined) patch.data = cleanPortfolioDoc(body.data);
  if (body.published !== undefined) {
    if (typeof body.published !== 'boolean') throw new AppError(400, 'Valor inválido para publicar.');
    patch.published = body.published;
  }
  if (body.slug !== undefined) {
    const slug = slugify(String(body.slug));
    if (!isValidSlug(slug)) throw new AppError(400, 'Endereço inválido. Use letras, números e hífen.');
    patch.slug = slug;
  }
  if (!Object.keys(patch).length) throw new AppError(400, 'Nada para atualizar.');
  try {
    const p = await prisma.portfolio.update({ where: { id: current.id }, data: patch, select: summarySelect });
    res.json({ portfolio: summaryDTO(p, req.user.portfolioSlug) });
  } catch (e) {
    if (e?.code === 'P2002') throw new AppError(409, 'Você já tem outra página com esse endereço. Escolha outro.');
    throw e;
  }
});

router.post('/:id/duplicate', async (req, res) => {
  const current = await owned(req, true);
  const count = await assertCanCreate(req.user);
  const name = `${current.name} (cópia)`.slice(0, 120);
  const { page, userSlug } = await createPage(req.user, { name, data: current.data, count });
  res.status(201).json({ portfolio: summaryDTO(page, userSlug) });
});

// A página principal abre direto em dominio/<usuário>.
router.post('/:id/main', async (req, res) => {
  const current = await owned(req);
  await prisma.$transaction([
    prisma.portfolio.updateMany({ where: { userId: req.user.id }, data: { isMain: false } }),
    prisma.portfolio.update({ where: { id: current.id }, data: { isMain: true } }),
  ]);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const p = await owned(req);
  await prisma.$transaction(async (tx) => {
    await tx.portfolio.delete({ where: { id: p.id } });
    if (p.isMain) {
      // Sobrou alguma página? A mais antiga vira a principal.
      const next = await tx.portfolio.findFirst({ where: { userId: req.user.id }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (next) await tx.portfolio.update({ where: { id: next.id }, data: { isMain: true } });
    }
  });
  res.json({ ok: true });
});

export default router;
