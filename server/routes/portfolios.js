import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { config } from '../config.js';
import { isTrialUser, limitsFor } from '../plans.js';
import { addDomainToEasypanel, removeDomainFromEasypanel } from '../services/easypanel.js';
import { appHost, checkDomainDns, forgetDomain } from '../services/domains.js';
import { isValidDomain, normalizeDomain } from '../utils/domain.js';
import { KINDS, cleanPortfolioDoc, cleanPortfolioName, emptyPortfolioDoc } from '../utils/portfolio.js';
import { isValidSlug, pickSlug, slugify } from '../utils/slug.js';

// Portfólio do usuário logado: páginas públicas personalizáveis.
// Endereço: dominio/<portfolioSlug do usuário> = página principal; dominio/<portfolioSlug>/<slug da página> = as demais.
const router = Router();

const ms = (d) => (d ? d.getTime() : null);
const pagePath = (userSlug, p) => (p.isMain ? `/${userSlug}` : `/${userSlug}/${p.slug}`);
const customBase = (user) => (user?.customDomain && user.customDomainVerifiedAt ? `https://${user.customDomain}` : '');
const summaryDTO = (p, userSlug, user) => {
  const base = customBase(user);
  return {
    id: p.id, name: p.name, slug: p.slug, published: p.published, isMain: p.isMain, kind: p.kind,
    path: pagePath(userSlug, p), customUrl: base ? `${base}${p.isMain ? '' : `/${p.slug}`}` : null,
    createdAt: ms(p.createdAt), updatedAt: ms(p.updatedAt),
  };
};
const fullDTO = (p, userSlug, user) => ({ ...summaryDTO(p, userSlug, user), data: p.data });
const domainDTO = (user) => ({
  name: user.customDomain || '',
  verified: Boolean(user.customDomain && user.customDomainVerifiedAt),
  serverIp: config.serverIp,
  appHost,
});
const summarySelect = { id: true, name: true, slug: true, published: true, isMain: true, kind: true, createdAt: true, updatedAt: true };

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

// O catálogo digital depende do plano (limite de produtos acima de zero).
function assertKindAllowed(user, kind) {
  if (kind === 'catalog' && limitsFor(user).catalogProducts < 1) {
    throw new AppError(403, 'O seu plano não inclui o catálogo digital. Mude para um plano com catálogo para criar esta página.', 'LIMIT_REACHED');
  }
}

async function createPage(user, { name, data, count, kind = 'site', published = false }) {
  const userSlug = await ensureUserSlug(user);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await freePageSlug(user.id, name);
    try {
      const p = await prisma.portfolio.create({ data: { userId: user.id, name, slug, data, kind, published, isMain: count === 0 } });
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
  res.json({ portfolios: rows.map((p) => summaryDTO(p, userSlug, req.user)), limit: limitsFor(req.user).portfolios, catalogProducts: limitsFor(req.user).catalogProducts, userSlug, domain: domainDTO(req.user) });
});

router.put('/domain', async (req, res) => {
  if (isTrialUser(req.user)) throw new AppError(403, 'Domínio próprio está bloqueado no teste grátis. Adquira um plano para liberar este recurso.', 'TRIAL_FEATURE_LOCKED');
  const raw = String(req.body?.domain ?? '').trim();
  const old = req.user.customDomain;

  if (!raw) {
    if (old) {
      try {
        await removeDomainFromEasypanel(old);
      } catch (e) {
        console.error(`[portfolio] não removeu ${old} do EasyPanel:`, e.message);
        throw new AppError(502, `Não foi possível remover o domínio do EasyPanel: ${e.message}`, 'EASYPANEL_ERROR');
      }
    }
    const saved = await prisma.user.update({ where: { id: req.user.id }, data: { customDomain: null, customDomainVerifiedAt: null } });
    if (old) forgetDomain(old);
    return res.json({ domain: domainDTO(saved) });
  }

  const domain = normalizeDomain(raw);
  if (!isValidDomain(domain)) throw new AppError(400, 'Domínio inválido. Use algo como meusite.com.br (sem https:// e sem barra).');
  if (domain === appHost || domain.endsWith(`.${appHost}`)) throw new AppError(400, 'Esse endereço é do próprio sistema. Use o seu domínio.');

  await ensureUserSlug(req.user);
  const dnsCheck = await checkDomainDns(domain);
  const data = { customDomain: domain, customDomainVerifiedAt: dnsCheck.ok ? new Date() : null };
  try {
    await addDomainToEasypanel(domain);
  } catch (e) {
    console.error(`[portfolio] não cadastrou ${domain} no EasyPanel:`, e.message);
    throw new AppError(502, `Não foi possível cadastrar o domínio no EasyPanel: ${e.message}`, 'EASYPANEL_ERROR');
  }

  let saved;
  for (let attempt = 0; attempt < 2 && !saved; attempt++) {
    try {
      saved = await prisma.user.update({ where: { id: req.user.id }, data });
    } catch (e) {
      if (e?.code !== 'P2002') throw e;
      if (!dnsCheck.ok) throw new AppError(409, 'Esse domínio já está cadastrado em outra conta.');
      const freed = await prisma.user.updateMany({
        where: { customDomain: domain, customDomainVerifiedAt: null, id: { not: req.user.id } },
        data: { customDomain: null },
      });
      if (!freed.count) throw new AppError(409, 'Esse domínio já está cadastrado em outra conta.');
    }
  }
  if (!saved) throw new AppError(409, 'Esse domínio já está cadastrado em outra conta.');
  forgetDomain(domain);
  if (old) {
    forgetDomain(old);
    if (old !== domain) {
      try {
        await removeDomainFromEasypanel(old);
      } catch (e) {
        console.warn(`[portfolio] não removeu o domínio antigo ${old} do EasyPanel:`, e.message);
      }
    }
  }
  res.json({ domain: domainDTO(saved), dnsIps: dnsCheck.ips || [] });
});

router.post('/domain/check', async (req, res) => {
  if (isTrialUser(req.user)) throw new AppError(403, 'Domínio próprio está bloqueado no teste grátis. Adquira um plano para liberar este recurso.', 'TRIAL_FEATURE_LOCKED');
  const domain = req.user.customDomain;
  if (!domain) throw new AppError(400, 'Cadastre um domínio primeiro.');
  try {
    await addDomainToEasypanel(domain);
  } catch (e) {
    console.error(`[portfolio] não cadastrou ${domain} no EasyPanel:`, e.message);
    throw new AppError(502, `Não foi possível cadastrar o domínio no EasyPanel: ${e.message}`, 'EASYPANEL_ERROR');
  }
  const dnsCheck = await checkDomainDns(domain);
  const saved = await prisma.user.update({
    where: { id: req.user.id },
    data: { customDomainVerifiedAt: dnsCheck.ok ? req.user.customDomainVerifiedAt || new Date() : null },
  });
  forgetDomain(domain);
  res.json({ domain: domainDTO(saved), dnsIps: dnsCheck.ips || [] });
});

router.get('/:id', async (req, res) => {
  const p = await owned(req, true);
  res.json({ portfolio: fullDTO(p, req.user.portfolioSlug, req.user) });
});

router.post('/', async (req, res) => {
  const count = await assertCanCreate(req.user);
  const kind = KINDS.has(req.body?.kind) ? req.body.kind : 'site';
  assertKindAllowed(req.user, kind);
  const name = cleanPortfolioName(req.body?.name);
  const data = req.body?.data === undefined ? emptyPortfolioDoc(kind) : cleanPortfolioDoc(req.body.data, kind);
  const { page, userSlug } = await createPage(req.user, { name, data, count, kind });
  res.status(201).json({ portfolio: fullDTO(page, userSlug, req.user) });
});

router.patch('/:id', async (req, res) => {
  const current = await owned(req);
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) patch.name = cleanPortfolioName(body.name);
  if (body.data !== undefined) patch.data = cleanPortfolioDoc(body.data, current.kind); // o tipo da página não muda depois de criada
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
    res.json({ portfolio: summaryDTO(p, req.user.portfolioSlug, req.user) });
  } catch (e) {
    if (e?.code === 'P2002') throw new AppError(409, 'Você já tem outra página com esse endereço. Escolha outro.');
    throw e;
  }
});

router.post('/:id/duplicate', async (req, res) => {
  const current = await owned(req, true);
  const count = await assertCanCreate(req.user);
  assertKindAllowed(req.user, current.kind);
  const name = `${current.name} (cópia)`.slice(0, 120);
  const { page, userSlug } = await createPage(req.user, { name, data: current.data, count, kind: current.kind });
  res.status(201).json({ portfolio: summaryDTO(page, userSlug, req.user) });
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
