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
  app: { enabled: s.appEnabled, name: s.appName || '', color: s.appColor || '', userLimit: s.appUserLimit },
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
  const planLimits = limitsFor(req.user);
  const limit = planLimits.stores;
  const used = await prisma.store.count({ where: { userId: req.user.id } });
  if (used >= limit) {
    throw new AppError(403, limit ? `Seu plano permite ${limit} ${limit === 1 ? 'loja' : 'lojas'}. Adquira mais lojas para criar outra.` : 'Seu plano não inclui lojas. Adquira o recurso para criar.', 'LIMIT_REACHED');
  }
  const name = cleanName(req.body?.name);
  const slug = slugify(String(req.body?.slug || name));
  await assertSlugFree(slug);
  try {
    const store = await prisma.store.create({
      data: { userId: req.user.id, name, slug, appUserLimit: Math.max(1, Math.min(10, planLimits.appUsers)) },
    });
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
const APP_PERMS = ['produtos', 'pedidos', 'clientes', 'arquivados', 'estrategia', 'pdv', 'api', 'entregas', 'auditoria'];
const availablePerms = (user) => {
  const limits = limitsFor(user);
  const tabs = limits.tabs;
  return APP_PERMS.filter((perm) => {
    if (perm === 'produtos') return tabs.includes('produtos') && limits.catalogProducts > 0;
    if (perm === 'pdv') return tabs.includes('pedidos') && limits.catalogProducts > 0;
    if (perm === 'pedidos' || perm === 'clientes' || perm === 'arquivados' || perm === 'estrategia') return tabs.includes('pedidos');
    if (perm === 'api') return tabs.includes('api');
    if (perm === 'entregas') return tabs.includes('pedidos') && limits.catalogProducts > 0;
    return tabs.includes('auditoria') && limits.auditInstances > 0;
  });
};
const cleanPerms = (v, user) => {
  const list = Array.isArray(v) ? v : [];
  const available = availablePerms(user);
  if (list.some((p) => APP_PERMS.includes(p) && !available.includes(p))) {
    throw new AppError(403, 'Uma ou mais áreas selecionadas não estão disponíveis no plano desta loja.', 'TAB_NOT_IN_PLAN');
  }
  const out = available.filter((p) => list.includes(p));
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
  const [users, limits] = await Promise.all([
    prisma.storeUser.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'asc' } }),
    Promise.resolve(limitsFor(req.user)),
  ]);
  res.json({
    store: dto(store),
    users: users.map(userDTO),
    availablePerms: availablePerms(req.user),
    maxAppUsers: limits.appUsers,
    appAvailable: limits.stores > 0 && limits.appUsers > 0 && availablePerms(req.user).length > 0,
  });
});

router.put('/:id/app', async (req, res) => {
  const store = await owned(req);
  const limits = limitsFor(req.user);
  if (req.body?.enabled && (limits.stores < 1 || limits.appUsers < 1 || availablePerms(req.user).length < 1)) {
    throw new AppError(403, 'O aplicativo por loja não está disponível no plano atual.', 'LIMIT_REACHED');
  }
  const color = String(req.body?.color ?? '').trim();
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new AppError(400, 'Cor inválida. Use o formato #RRGGBB.');
  const userLimit = Number(req.body?.userLimit);
  const unchangedOverPlanLimit = userLimit === store.appUserLimit && userLimit > limits.appUsers;
  if (!Number.isInteger(userLimit) || userLimit < 1 || (userLimit > limits.appUsers && !unchangedOverPlanLimit)) {
    throw new AppError(400, `A quantidade de acessos precisa ser um número entre 1 e ${limits.appUsers}.`);
  }
  let saved;
  try {
    saved = await prisma.$transaction(async (tx) => {
      const existingUsers = await tx.storeUser.count({ where: { storeId: store.id } });
      if (existingUsers > userLimit && userLimit !== store.appUserLimit) {
        throw new AppError(400, `Esta loja já possui ${existingUsers} acessos. Exclua acessos antes de reduzir a quantidade para ${userLimit}.`);
      }
      return tx.store.update({
        where: { id: store.id },
        data: { appEnabled: Boolean(req.body?.enabled), appName: String(req.body?.name ?? '').trim().slice(0, 40) || null, appColor: color || null, appUserLimit: userLimit },
      });
    }, { isolationLevel: 'Serializable' });
  } catch (e) {
    if (e?.code === 'P2034') throw new AppError(409, 'Os acessos da loja foram alterados ao mesmo tempo. Atualize a tela e tente novamente.', 'CONCURRENT_UPDATE');
    throw e;
  }
  res.json({ store: dto(saved) });
});

router.post('/:id/app/users', async (req, res) => {
  const store = await owned(req);
  const name = String(req.body?.name ?? '').trim().slice(0, 80);
  const login = String(req.body?.login ?? '').trim().toLowerCase().slice(0, 80);
  if (!name || !login) throw new AppError(400, 'Informe o nome e o usuário de acesso.');
  const limits = limitsFor(req.user);
  if (limits.appUsers < 1 || limits.stores < 1) throw new AppError(403, 'O plano atual não inclui acessos ao aplicativo da loja.', 'LIMIT_REACHED');
  const maxUsers = Math.min(store.appUserLimit, limits.appUsers);
  const perms = cleanPerms(req.body?.perms ?? availablePerms(req.user), req.user);
  const passwordHash = await bcrypt.hash(cleanPassword(req.body?.password), 10);
  try {
    const u = await prisma.$transaction(async (tx) => {
      const userCount = await tx.storeUser.count({ where: { storeId: store.id } });
      if (userCount >= maxUsers) throw new AppError(403, `Esta loja atingiu o limite de ${maxUsers} acessos.`, 'LIMIT_REACHED');
      return tx.storeUser.create({ data: { storeId: store.id, name, login, passwordHash, perms } });
    }, { isolationLevel: 'Serializable' });
    res.status(201).json({ user: userDTO(u) });
  } catch (e) {
    if (e?.code === 'P2002') throw new AppError(409, 'Já existe um acesso com esse usuário nesta loja.');
    if (e?.code === 'P2034') throw new AppError(409, 'Os acessos da loja foram alterados ao mesmo tempo. Atualize a tela e tente novamente.', 'CONCURRENT_UPDATE');
    throw e;
  }
});

router.patch('/:id/app/users/:uid', async (req, res) => {
  const store = await owned(req);
  const data = {};
  if (req.body?.name !== undefined) data.name = String(req.body.name).trim().slice(0, 80) || undefined;
  if (typeof req.body?.active === 'boolean') data.active = req.body.active;
  if (req.body?.perms !== undefined) data.perms = cleanPerms(req.body.perms, req.user);
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