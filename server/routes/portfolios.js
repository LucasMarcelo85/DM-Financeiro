import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { config } from '../config.js';
import { limitsFor } from '../plans.js';
import { addDomainToEasypanel, removeDomainFromEasypanel } from '../services/easypanel.js';
import { appHost, checkDomainDns, forgetDomain } from '../services/domains.js';
import { isValidDomain, normalizeDomain } from '../utils/domain.js';
import { KINDS, cleanPortfolioDoc, cleanPortfolioName, emptyPortfolioDoc } from '../utils/portfolio.js';
import { isValidSlug, pickSlug, slugify } from '../utils/slug.js';
import { storeScope } from '../utils/store.js';
import { generatePortfolioPlan, buildPortfolioDocuments } from '../services/ai-portfolio.js';

// Portfólio do usuário logado: páginas públicas personalizáveis.
// Endereço: dominio/<portfolioSlug do usuário> = página principal; dominio/<portfolioSlug>/<slug da página> = as demais.
const router = Router();

// No app da loja (req.shopUser existe) o usuário edita só a página principal da própria loja:
// nada de criar, duplicar, excluir, trocar a principal, mudar o endereço ou o domínio.
router.use(async (req, res, next) => {
  if (!req.shopUser) return next();
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    throw new AppError(403, 'No aplicativo você só pode editar a página principal.', 'FORBIDDEN');
  }
  const storeId = req.forcedStore;
  const findMain = () => prisma.portfolio.findFirst({ where: { userId: req.user.id, storeId, isMain: true }, select: { id: true } });
  if (req.path === '/' && req.method === 'GET') {
    let main = await findMain();
    if (!main) {
      const first = await prisma.portfolio.findFirst({ where: { userId: req.user.id, storeId }, orderBy: { id: 'asc' }, select: { id: true } });
      if (first) main = await prisma.portfolio.update({ where: { id: first.id }, data: { isMain: true }, select: { id: true } });
      else {
        const { page } = await createPage(req.user, { name: (req.shopUser.store.name || 'Minha página').slice(0, 120), data: emptyPortfolioDoc('site'), count: 0, kind: 'site', storeId });
        main = page;
      }
    }
    const row = await prisma.portfolio.findUnique({ where: { id: main.id }, select: summarySelect });
    const { userSlug, owner } = await addressFor(req.user, storeId);
    return res.json({ portfolios: [summaryDTO(row, userSlug, owner)], limit: 1, used: 1, catalogProducts: limitsFor(req.user).catalogProducts, userSlug, domain: domainDTO(owner) });
  }
  const main = await findMain();
  if (!main || req.path !== `/${main.id}`) throw new AppError(403, 'No aplicativo você só pode editar a página principal.', 'FORBIDDEN');
  if (req.method === 'PATCH' && req.body?.slug !== undefined) throw new AppError(403, 'O endereço da página não pode ser alterado no aplicativo.', 'FORBIDDEN');
  next();
});

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
const summarySelect = { id: true, storeId: true, name: true, slug: true, published: true, isMain: true, kind: true, createdAt: true, updatedAt: true };

// Endereço e domínio que valem para uma página: os da loja extra (quando ela é de uma loja) ou os da conta.
async function addressFor(user, storeId) {
  if (!storeId) return { userSlug: user.portfolioSlug || (await suggestUserSlug(user)), owner: user };
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  return { userSlug: store.slug, owner: store };
}

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
  const stores = await prisma.store.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } });
  return pickSlug(base, new Set([...rows.map((r) => r.portfolioSlug), ...stores.map((s) => s.slug)]), { reserved: true });
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
async function assertCanCreate(user, storeId = null) {
  const limit = limitsFor(user).portfolios;
  const total = await prisma.portfolio.count({ where: { userId: user.id } });
  const count = await prisma.portfolio.count({ where: { userId: user.id, storeId } });
  if (total >= limit) {
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

async function createPage(user, { name, data, count, kind = 'site', published = false, storeId = null }) {
  const userSlug = storeId ? (await prisma.store.findUnique({ where: { id: storeId }, select: { slug: true } })).slug : await ensureUserSlug(user);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await freePageSlug(user.id, name);
    try {
      const p = await prisma.portfolio.create({ data: { userId: user.id, storeId, name, slug, data, kind, published, isMain: count === 0 } });
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
  const storeId = await storeScope(req);
  const rows = await prisma.portfolio.findMany({ where: { userId: req.user.id, storeId }, orderBy: [{ isMain: 'desc' }, { updatedAt: 'desc' }], select: summarySelect });
  const { userSlug, owner } = await addressFor(req.user, storeId);
  res.json({ portfolios: rows.map((p) => summaryDTO(p, userSlug, owner)), limit: limitsFor(req.user).portfolios, used: await prisma.portfolio.count({ where: { userId: req.user.id } }), catalogProducts: limitsFor(req.user).catalogProducts, userSlug, domain: domainDTO(owner) });
});

router.post('/ai-build', async (req, res) => {
  const body = req.body || {};
  const providers = new Set(['gemini', 'openai', 'claude']);
  const defaults = { gemini: 'gemini-2.0-flash', openai: 'gpt-4o-mini', claude: 'claude-3-5-haiku-latest' };
  const provider = String(body.provider || '');
  const model = String(body.model || defaults[provider] || '').trim();
  const apiKey = String(body.apiKey || '').trim();
  const siteName = String(body.siteName || '').trim();
  const prompt = String(body.prompt || '').trim();
  const pageCount = Number(body.pageCount);
  if (!providers.has(provider)) throw new AppError(400, 'Escolha Gemini, ChatGPT ou Claude.');
  if (!/^[\w.-]{2,100}$/.test(model)) throw new AppError(400, 'Informe um identificador de modelo válido.');
  if (apiKey.length < 16 || apiKey.length > 1000) throw new AppError(400, 'Informe uma chave de API válida.');
  if (siteName.length > 120 || prompt.length < 20 || prompt.length > 4000) throw new AppError(400, 'Informe o nome do site e uma descrição entre 20 e 4.000 caracteres.');
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 5) throw new AppError(400, 'Escolha de 1 a 5 páginas para o site.');

  const storeId = await storeScope(req);
  const count = await assertCanCreate(req.user, storeId);
  const limit = limitsFor(req.user).portfolios;
  const used = await prisma.portfolio.count({ where: { userId: req.user.id } });
  if (pageCount > limit - used) {
    throw new AppError(403, `Seu plano tem espaço para ${Math.max(0, limit - used)} ${limit - used === 1 ? 'página' : 'páginas'}. Reduza a quantidade ou libere espaço no portfólio.`, 'LIMIT_REACHED');
  }

  const rawAttachments = body.attachments ?? [];
  if (!Array.isArray(rawAttachments) || rawAttachments.length > 4) throw new AppError(400, 'Envie no máximo quatro imagens de referência.');
  let totalBytes = 0;
  const attachments = rawAttachments.map((item, index) => {
    const mime = String(item?.mime || '').toLowerCase();
    const base64 = String(item?.base64 || '');
    const name = String(item?.name || `referencia-${index + 1}`).slice(0, 100);
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime) || base64.length > 2_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new AppError(400, `A imagem ${index + 1} é inválida ou muito grande.`);
    }
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > 1_000_000 || buffer.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) {
      throw new AppError(400, `A imagem ${index + 1} deve ser válida e ter até 1 MB.`);
    }
    totalBytes += buffer.length;
    return { kind: 'image', mime, base64, name, size: buffer.length, dataUrl: `data:${mime};base64,${base64}` };
  });
  if (totalBytes > 2_500_000) throw new AppError(400, 'As imagens juntas ultrapassam o limite de 2,5 MB.');

  const plan = await generatePortfolioPlan({ provider, model, apiKey, request: { siteName, prompt }, pageCount, attachments });
  if (plan.pages.length !== pageCount) throw new AppError(502, 'A IA não criou a quantidade de páginas solicitada. Tente novamente.', 'AI_SITE_INVALID_RESPONSE');

  const created = [];
  try {
    for (let index = 0; index < plan.pages.length; index += 1) {
      const { page, userSlug } = await createPage(req.user, {
        name: plan.pages[index].name,
        data: emptyPortfolioDoc('site'),
        count: count + index,
        kind: 'site',
        storeId,
      });
      created.push({ page, userSlug });
    }
    const paths = created.map(({ page, userSlug }, index) => ({
      name: plan.pages[index].name,
      path: pagePath(userSlug, page),
    }));
    const documents = buildPortfolioDocuments(plan, attachments, paths);
    const { owner } = await addressFor(req.user, storeId);
    const saved = [];
    for (let index = 0; index < created.length; index += 1) {
      const cleanData = cleanPortfolioDoc(documents[index].data, 'site');
      const page = await prisma.portfolio.update({
        where: { id: created[index].page.id },
        data: { data: cleanData },
      });
      saved.push(summaryDTO(page, created[index].userSlug, owner));
    }
    res.status(201).json({ siteName: plan.siteName, portfolios: saved });
  } catch (error) {
    try {
      await prisma.portfolio.deleteMany({ where: { id: { in: created.map(({ page }) => page.id) }, userId: req.user.id } });
    } catch (cleanupError) {
      console.error(`[portfolio] geração IA falhou (${error.message}) e não foi possível limpar páginas parciais: ${cleanupError.message}`);
      throw new AppError(500, 'A geração falhou e páginas parciais permaneceram no portfólio. Atualize a lista antes de tentar novamente.', 'AI_SITE_CLEANUP_FAILED');
    }
    throw error;
  }
});

router.put('/domain', async (req, res) => {
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
  const { userSlug, owner } = await addressFor(req.user, p.storeId);
  res.json({ portfolio: fullDTO(p, userSlug, owner) });
});

router.post('/', async (req, res) => {
  const storeId = await storeScope(req);
  const count = await assertCanCreate(req.user, storeId);
  const kind = KINDS.has(req.body?.kind) ? req.body.kind : 'site';
  assertKindAllowed(req.user, kind);
  const name = cleanPortfolioName(req.body?.name);
  const data = req.body?.data === undefined ? emptyPortfolioDoc(kind) : cleanPortfolioDoc(req.body.data, kind);
  const { page, userSlug } = await createPage(req.user, { name, data, count, kind, storeId });
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
    const { userSlug, owner } = await addressFor(req.user, p.storeId);
    res.json({ portfolio: summaryDTO(p, userSlug, owner) });
  } catch (e) {
    if (e?.code === 'P2002') throw new AppError(409, 'Você já tem outra página com esse endereço. Escolha outro.');
    throw e;
  }
});

router.post('/:id/duplicate', async (req, res) => {
  const current = await owned(req, true);
  const count = await assertCanCreate(req.user, current.storeId ?? null);
  assertKindAllowed(req.user, current.kind);
  const name = `${current.name} (cópia)`.slice(0, 120);
  const { page, userSlug } = await createPage(req.user, { name, data: current.data, count, kind: current.kind, storeId: current.storeId ?? null });
  res.status(201).json({ portfolio: summaryDTO(page, userSlug, req.user) });
});

// A página principal abre direto em dominio/<usuário>.
router.post('/:id/main', async (req, res) => {
  const current = await owned(req);
  await prisma.$transaction([
    prisma.portfolio.updateMany({ where: { userId: req.user.id, storeId: current.storeId ?? null }, data: { isMain: false } }),
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
      const next = await tx.portfolio.findFirst({ where: { userId: req.user.id, storeId: p.storeId ?? null }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (next) await tx.portfolio.update({ where: { id: next.id }, data: { isMain: true } });
    }
  });
  res.json({ ok: true });
});

export default router;
