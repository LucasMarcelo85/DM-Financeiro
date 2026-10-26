import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { addDomainToEasypanel, removeDomainFromEasypanel } from '../services/easypanel.js';
import { appHost, checkDomainDns, forgetDomain } from '../services/domains.js';
import { isValidDomain, normalizeDomain } from '../utils/domain.js';
import { isReservedSlug, isValidSlug, slugify } from '../utils/slug.js';

// Lojas extras da conta. Cada loja tem site, produtos, pedidos e domínio próprios.
const router = Router();

const dto = (s) => ({
  id: s.id, name: s.name, slug: s.slug, path: `/${s.slug}`,
  domain: { name: s.customDomain || '', verified: !!s.customDomainVerifiedAt },
  app: { enabled: s.appEnabled, name: s.appName || '', color: s.appColor || '' },
  createdAt: s.createdAt,
});

const cleanName = (v) => {
  const name = String(v ?? '').trim().slice(0, 80);
  if (!name) throw new AppError(400, 'Informe o nome da loja.');
  return name;
};

async function assertSlugFree(slug, ignoreId) {
  if (!isValidSlug(slug) || isReservedSlug(slug)) throw new AppError(400, 'Endereço inválido ou reservado. Use letras, números e hífen.');
  const [store, user] = await Promise.all([
    prisma.store.findUnique({ where: { slug }, select: { id: true } }),
    prisma.user.findFirst({ where: { portfolioSlug: slug }, select: { id: true } }),
  ]);
  if ((store && store.id !== ignoreId) || user) throw new AppError(409, 'Esse endereço já está em uso. Escolha outro.');
}

async function owned(req) {
  const id = Number(req.params.id);
  const store = Number.isInteger(id) ? await prisma.store.findFirst({ where: { id, userId: req.user.id } }) : null;
  if (!store) throw new AppError(404, 'Loja não encontrada.');
  return store;
}

router.get('/', async (req, res) => {
  const rows = await prisma.store.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'asc' } });
  res.json({ stores: rows.map(dto), limit: limitsFor(req.user).stores });
});

router.post('/', async (req, res) => {
  const limit = limitsFor(req.user).stores;
  const used = await prisma.store.count({ where: { userId: req.user.id } });
  if (used >= limit) {
    throw new AppError(403, limit ? `Seu plano permite ${limit} ${limit === 1 ? 'loja' : 'lojas'}. Adquira mais lojas para criar outra.` : 'Seu plano não inclui lojas. Adquira o recurso para criar.', 'LIMIT_REACHED');
  }
  const name = cleanName(req.body?.name);
  const slug = slugify(String(req.body?.slug || name));
  await assertSlugFree(slug);
  try {
    const store = await prisma.store.create({ data: { userId: req.user.id, name, slug } });
    res.status(201).json({ store: dto(store) });
  } catch (e) {
    if (e?.code === 'P2002') throw new AppError(409, 'Esse endereço já está em uso. Escolha outro.');
    throw e;
  }
});

router.patch('/:id', async (req, res) => {
  const current = await owned(req);
  const data = {};
  if (req.body?.name !== undefined) data.name = cleanName(req.body.name);
  if (req.body?.slug !== undefined) {
    const slug = slugify(String(req.body.slug));
    if (slug !== current.slug) {
      await assertSlugFree(slug, current.id);
      data.slug = slug;
    }
  }
  if (!Object.keys(data).length) throw new AppError(400, 'Nada para atualizar.');
  res.json({ store: dto(await prisma.store.update({ where: { id: current.id }, data })) });
});

// Exclui a loja e tudo o que é dela (páginas, produtos e pedidos).
router.delete('/:id', async (req, res) => {
  const store = await owned(req);
  await prisma.$transaction([
    prisma.order.deleteMany({ where: { userId: req.user.id, storeId: store.id } }),
    prisma.product.deleteMany({ where: { userId: req.user.id, storeId: store.id } }),
    prisma.portfolio.deleteMany({ where: { userId: req.user.id, storeId: store.id } }),
    prisma.store.delete({ where: { id: store.id } }),
  ]);
  if (store.customDomain) {
    forgetDomain(store.customDomain);
    removeDomainFromEasypanel(store.customDomain).catch((e) => console.warn(`[store] não removeu ${store.customDomain}:`, e.message));
  }
  res.json({ ok: true });
});

router.put('/:id/domain', async (req, res) => {
  const store = await owned(req);
  const raw = String(req.body?.domain ?? '').trim();
  const old = store.customDomain;

  if (!raw) {
    if (old) {
      try {
        await removeDomainFromEasypanel(old);
      } catch (e) {
        throw new AppError(502, `Não foi possível remover o domínio do EasyPanel: ${e.message}`, 'EASYPANEL_ERROR');
      }
      forgetDomain(old);
    }
    const saved = await prisma.store.update({ where: { id: store.id }, data: { customDomain: null, customDomainVerifiedAt: null } });
    return res.json({ store: dto(saved), domain: dto(saved).domain });
  }

  const domain = normalizeDomain(raw);
  if (!isValidDomain(domain)) throw new AppError(400, 'Domínio inválido. Use algo como minhaloja.com.br (sem https:// e sem barra).');
  if (domain === appHost || domain.endsWith(`.${appHost}`)) throw new AppError(400, 'Esse endereço é do próprio sistema. Use o seu domínio.');
  if (await prisma.user.findFirst({ where: { customDomain: domain }, select: { id: true } })) throw new AppError(409, 'Esse domínio já está cadastrado em outra conta.');

  const dnsCheck = await checkDomainDns(domain);
  try {
    await addDomainToEasypanel(domain);
  } catch (e) {
    throw new AppError(502, `Não foi possível cadastrar o domínio no EasyPanel: ${e.message}`, 'EASYPANEL_ERROR');
  }
  let saved;
  try {
    saved = await prisma.store.update({ where: { id: store.id }, data: { customDomain: domain, customDomainVerifiedAt: dnsCheck.ok ? new Date() : null } });
  } catch (e) {
    if (e?.code === 'P2002') throw new AppError(409, 'Esse domínio já está cadastrado em outra conta.');
    throw e;
  }
  forgetDomain(domain);
  if (old && old !== domain) {
    forgetDomain(old);
    removeDomainFromEasypanel(old).catch((e) => console.warn(`[store] não removeu o domínio antigo ${old}:`, e.message));
  }
  res.json({ store: dto(saved), domain: dto(saved).domain, dnsIps: dnsCheck.ips || [] });
});

router.post('/:id/domain/check', async (req, res) => {
  const store = await owned(req);
  if (!store.customDomain) throw new AppError(400, 'Cadastre um domínio primeiro.');
  try {
    await addDomainToEasypanel(store.customDomain);
  } catch (e) {
    throw new AppError(502, `Não foi possível cadastrar o domínio no EasyPanel: ${e.message}`, 'EASYPANEL_ERROR');
  }
  const dnsCheck = await checkDomainDns(store.customDomain);
  const saved = await prisma.store.update({
    where: { id: store.id },
    data: { customDomainVerifiedAt: dnsCheck.ok ? store.customDomainVerifiedAt || new Date() : null },
  });
  forgetDomain(store.customDomain);
  res.json({ store: dto(saved), domain: dto(saved).domain, dnsIps: dnsCheck.ips || [] });
});

// ---------- Aplicativo do lojista ----------
const MAX_APP_USERS = 10;
const APP_PERMS = ['produtos', 'pedidos', 'clientes', 'arquivados'];
const cleanPerms = (v) => {
  const list = Array.isArray(v) ? v : [];
  const out = APP_PERMS.filter((p) => list.includes(p));
  if (!out.length) throw new AppError(400, 'Escolha pelo menos uma área que o lojista poderá usar.');
  return out.join(',');
};
const userDTO = (u) => ({ id: u.id, name: u.name, login: u.login, active: u.active, perms: u.perms.split(',').filter(Boolean), createdAt: u.createdAt });
const cleanPassword = (v) => {
  const p = String(v ?? '');
  if (p.length < 6 || p.length > 72) throw new AppError(400, 'A senha precisa ter de 6 a 72 caracteres.');
  return p;
};

router.get('/:id/app', async (req, res) => {
  const store = await owned(req);
  const users = await prisma.storeUser.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'asc' } });
  res.json({ store: dto(store), users: users.map(userDTO) });
});

router.put('/:id/app', async (req, res) => {
  const store = await owned(req);
  const color = String(req.body?.color ?? '').trim();
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new AppError(400, 'Cor inválida. Use o formato #RRGGBB.');
  const saved = await prisma.store.update({
    where: { id: store.id },
    data: { appEnabled: Boolean(req.body?.enabled), appName: String(req.body?.name ?? '').trim().slice(0, 40) || null, appColor: color || null },
  });
  res.json({ store: dto(saved) });
});

router.post('/:id/app/users', async (req, res) => {
  const store = await owned(req);
  const name = String(req.body?.name ?? '').trim().slice(0, 80);
  const login = String(req.body?.login ?? '').trim().toLowerCase().slice(0, 80);
  if (!name || !login) throw new AppError(400, 'Informe o nome e o usuário de acesso.');
  const perms = cleanPerms(req.body?.perms ?? APP_PERMS);
  const passwordHash = await bcrypt.hash(cleanPassword(req.body?.password), 10);
  if ((await prisma.storeUser.count({ where: { storeId: store.id } })) >= MAX_APP_USERS) throw new AppError(403, `Limite de ${MAX_APP_USERS} acessos por loja.`);
  try {
    const u = await prisma.storeUser.create({ data: { storeId: store.id, name, login, passwordHash, perms } });
    res.status(201).json({ user: userDTO(u) });
  } catch (e) {
    if (e?.code === 'P2002') throw new AppError(409, 'Já existe um acesso com esse usuário nesta loja.');
    throw e;
  }
});

router.patch('/:id/app/users/:uid', async (req, res) => {
  const store = await owned(req);
  const data = {};
  if (req.body?.name !== undefined) data.name = String(req.body.name).trim().slice(0, 80) || undefined;
  if (typeof req.body?.active === 'boolean') data.active = req.body.active;
  if (req.body?.perms !== undefined) data.perms = cleanPerms(req.body.perms);
  if (req.body?.password) data.passwordHash = await bcrypt.hash(cleanPassword(req.body.password), 10);
  const r = await prisma.storeUser.updateMany({ where: { id: Number(req.params.uid) || 0, storeId: store.id }, data });
  if (!r.count) throw new AppError(404, 'Acesso não encontrado.');
  res.json({ ok: true });
});

router.delete('/:id/app/users/:uid', async (req, res) => {
  const store = await owned(req);
  const r = await prisma.storeUser.deleteMany({ where: { id: Number(req.params.uid) || 0, storeId: store.id } });
  if (!r.count) throw new AppError(404, 'Acesso não encontrado.');
  res.json({ ok: true });
});

export default router;