import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { computeAccess } from '../services/access.js';
import { instanceRouter } from './instances.js';
import { tokenRoutes } from './api-tokens.js';
import { catalogPaymentsRouter } from './catalog-payments.js';
import productRoutes from './products.js';
import catalogRoutes from './catalog.js';
import auditRoutes from './audit.js';
import inventoryRoutes from './inventory.js';

// Aplicativo do lojista: permissões e dados ficam restritos à loja/site associado ao acesso.
const router = Router();
const TOKEN_DAYS = 30;
const DUMMY_HASH = bcrypt.hashSync('dm-shop-app', 10);

const appName = (store) => store.appName || store.name;
const appColor = (store) => store.appColor || '#F2A33A';
const appForeground = (store) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(appColor(store))?.[1] || 'F2A33A';
  const channel = (offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = channel(0) * 0.2126 + channel(2) * 0.7152 + channel(4) * 0.0722;
  const darkContrast = (luminance + 0.05) / 0.017;
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast ? '#14202E' : '#FFFFFF';
};
const allowedPerms = (user, permissions, store) => {
  const limits = limitsFor(user);
  const tabs = limits.tabs;
  return permissions.filter((perm) => {
    if (perm === 'produtos') return tabs.includes('produtos') && limits.catalogProducts > 0;
    if (perm === 'pdv') return tabs.includes('pedidos') && limits.catalogProducts > 0;
    if (perm === 'pedidos' || perm === 'clientes' || perm === 'arquivados' || perm === 'estrategia') return tabs.includes('pedidos');
    if (perm === 'api') return tabs.includes('api');
    if (perm === 'entregas') return tabs.includes('pedidos') && limits.catalogProducts > 0;
    if (perm === 'estoque') return tabs.includes('produtos') && limits.catalogProducts > 0;
    if (perm === 'auditoria') return Boolean(store?.appAuditEnabled && store.appAuditInstanceLimit > 0) && tabs.includes('auditoria') && limits.auditInstances > 0;
    return false;
  });
};

async function storeFor(req) {
  const slug = String(req.query.u || req.body?.u || req.customDomain?.slug || '').toLowerCase();
  const store = slug ? await prisma.store.findUnique({ where: { slug }, include: { user: true } }) : null;
  if (!store || !store.appEnabled || limitsFor(store.user).stores < 1 || !computeAccess(store.user).hasAccess) throw new AppError(404, 'Aplicativo não encontrado.');
  return store;
}

router.get('/info', async (req, res) => {
  const store = await storeFor(req);
  res.json({ name: appName(store), color: appColor(store), slug: store.slug });
});

router.get('/manifest', async (req, res) => {
  const store = await storeFor(req);
  const start = req.customDomain ? '/app' : `/app/${store.slug}`;
  res.type('application/manifest+json').json({
    name: appName(store), short_name: appName(store).slice(0, 12), start_url: start, scope: start,
    display: 'standalone', background_color: '#ffffff', theme_color: appColor(store),
    icons: [{ src: `/api/shop-app/icon?u=${store.slug}`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  });
});

router.get('/icon', async (req, res) => {
  const store = await storeFor(req);
  const letter = appName(store).trim().charAt(0).toUpperCase().replace(/[<>&"']/g, '') || 'L';
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${appColor(store)}"/><text x="256" y="350" font-size="280" font-weight="700" text-anchor="middle" fill="${appForeground(store)}" font-family="sans-serif">${letter}</text></svg>`,
  );
});

router.post('/login', async (req, res) => {
  const store = await storeFor(req);
  const login = String(req.body?.login ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const su = login ? await prisma.storeUser.findUnique({ where: { storeId_login: { storeId: store.id, login } } }) : null;
  const ok = await bcrypt.compare(password, su?.passwordHash || DUMMY_HASH);
  if (!su || !ok || !su.active) throw new AppError(401, 'Usuário ou senha incorretos.', 'UNAUTHENTICATED');
  const token = jwt.sign({ su: su.id, k: 'shop' }, config.jwtSecret, { expiresIn: `${TOKEN_DAYS}d` });
  res.json({ token, ...meDTO(su, store) });
});

async function shopAuth(req, _res, next) {
  const m = /^Bearer\s+(.+)$/.exec(req.get('authorization') || '');
  let id;
  try {
    const payload = jwt.verify(m?.[1] || '', config.jwtSecret);
    if (payload.k !== 'shop') throw new Error('tipo');
    id = payload.su;
  } catch {
    throw new AppError(401, 'Entre novamente no aplicativo.', 'UNAUTHENTICATED');
  }
  const su = await prisma.storeUser.findUnique({ where: { id }, include: { store: { include: { user: true } } } });
  if (!su || !su.active || !su.store.appEnabled || limitsFor(su.store.user).stores < 1) throw new AppError(401, 'Acesso desativado. Fale com a loja.', 'UNAUTHENTICATED');
  if (!computeAccess(su.store.user).hasAccess) throw new AppError(402, 'A licença desta loja expirou.', 'PAYMENT_REQUIRED');
  if (su.mustChangePassword
    && !((req.method === 'GET' && req.path === '/me') || (req.method === 'POST' && req.path === '/password'))) {
    throw new AppError(403, 'Cadastre uma nova senha para continuar.', 'PASSWORD_CHANGE_REQUIRED');
  }
  req.user = su.store.user;
  req.forcedStore = su.store.id;
  req.forcedAuditScope = `store:${su.store.id}`;
  req.shopUser = su;
  req.shopPerms = allowedPerms(su.store.user, su.perms.split(',').filter(Boolean), su.store);
  next();
}

const needPerm = (...any) => (req, _res, next) => {
  if (!any.some((p) => req.shopPerms.includes(p))) throw new AppError(403, 'Seu acesso não libera esta área.', 'FORBIDDEN');
  next();
};

const needTab = (tab) => (req, _res, next) => {
  if (!limitsFor(req.user).tabs.includes(tab)) throw new AppError(403, 'Esta área não está disponível no plano da loja.', 'TAB_NOT_IN_PLAN');
  next();
};

const meDTO = (su, store) => ({
  user: {
    name: su.name, login: su.login,
    perms: allowedPerms(store.user, su.perms.split(',').filter(Boolean), store),
    isPrimary: su.isPrimary, mustChangePassword: su.mustChangePassword,
  },
  app: {
    id: store.id, name: appName(store), color: appColor(store),
    whatsapp: String(store.config?.whatsapp || '').replace(/\D/g, ''),
    auditSend: Boolean(store.appAuditEnabled && store.appAuditInstanceLimit > 0 && limitsFor(store.user).auditSend),
  },
});

router.get('/me', shopAuth, (req, res) => {
  res.json(meDTO(req.shopUser, req.shopUser.store));
});

router.post('/password', shopAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const password = String(req.body?.newPassword ?? '');
  if (password.length < 6 || password.length > 72) {
    throw new AppError(400, 'A nova senha precisa ter de 6 a 72 caracteres.');
  }
  if (!req.shopUser.mustChangePassword
    && !await bcrypt.compare(currentPassword, req.shopUser.passwordHash)) {
    throw new AppError(400, 'A senha atual está incorreta.');
  }
  const updated = await prisma.storeUser.update({
    where: { id: req.shopUser.id },
    data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false },
  });
  res.json({ ...meDTO(updated, req.shopUser.store) });
});

const needPrimary = (req, _res, next) => {
  if (!req.shopUser.isPrimary) throw new AppError(403, 'Somente o usuário principal pode administrar os acessos do aplicativo.', 'FORBIDDEN');
  next();
};

router.get('/team', shopAuth, needPrimary, async (req, res) => {
  const [users, flows] = await Promise.all([
    prisma.storeUser.findMany({ where: { storeId: req.forcedStore, isPrimary: false }, orderBy: { createdAt: 'asc' } }),
    prisma.stockFlow.findMany({ where: { userId: req.user.id, storeId: req.forcedStore }, select: { id: true, name: true, isDefault: true } }),
  ]);
  const permittedFlows = req.shopUser.stockFlowIds;
  const visibleFlows = flows.filter((flow) => permittedFlows.includes(flow.id));
  res.json({
    users: users.map((user) => ({
      id: user.id, name: user.name, login: user.login, active: user.active,
      perms: allowedPerms(req.user, user.perms.split(',').filter(Boolean), req.shopUser.store),
      stockFlowIds: user.stockFlowIds,
    })),
    availablePerms: req.shopPerms,
    flows: visibleFlows,
    permittedFlowIds: permittedFlows,
  });
});

router.patch('/team/users/:uid', shopAuth, needPrimary, async (req, res) => {
  const id = Number(req.params.uid);
  const user = Number.isSafeInteger(id)
    ? await prisma.storeUser.findFirst({ where: { id, storeId: req.forcedStore, isPrimary: false } })
    : null;
  if (!user) throw new AppError(404, 'Acesso não encontrado.');

  const data = {};
  if (req.body?.perms !== undefined) {
    if (!Array.isArray(req.body.perms) || !req.body.perms.length
      || req.body.perms.some((perm) => !req.shopPerms.includes(perm))) {
      throw new AppError(403, 'Você só pode liberar áreas que também estão disponíveis no seu acesso.', 'FORBIDDEN');
    }
    data.perms = [...new Set(req.body.perms)].join(',');
  }
  if (req.body?.stockFlowIds !== undefined) {
    const allowedFlowIds = req.shopUser.stockFlowIds;
    if (!Array.isArray(req.body.stockFlowIds) || req.body.stockFlowIds.some((flowId) =>
      !Number.isSafeInteger(Number(flowId)) || !allowedFlowIds.includes(Number(flowId)))) {
      throw new AppError(403, 'Você só pode liberar fluxos de estoque que estão no seu próprio acesso.', 'FORBIDDEN');
    }
    data.stockFlowIds = [...new Set(req.body.stockFlowIds.map(Number))];
  }
  if (typeof req.body?.active === 'boolean') data.active = req.body.active;
  if (!Object.keys(data).length) throw new AppError(400, 'Nada para atualizar.');
  await prisma.storeUser.update({ where: { id }, data });
  res.json({ ok: true });
});

router.use('/inventory', shopAuth, needPerm('estoque'), inventoryRoutes);

// Lojista cadastra, edita e desativa produtos, mas não exclui nem muda preferências da conta.
router.use('/products', shopAuth, needPerm('produtos', 'pdv', 'estoque'), (req, _res, next) => {
  if (!req.shopPerms.includes('produtos')) {
    if (req.method !== 'GET' || req.path !== '/') throw new AppError(403, 'Seu acesso só libera a consulta de produtos para o PDV.', 'FORBIDDEN');
    return needTab(req.shopPerms.includes('estoque') ? 'produtos' : 'pedidos')(req, _res, next);
  }
  return needTab('produtos')(req, _res, next);
}, (req, _res, next) => {
  if (req.method === 'DELETE' || req.path.startsWith('/preferences') && req.method !== 'GET') throw new AppError(403, 'O aplicativo não permite esta ação.', 'FORBIDDEN');
  next();
}, productRoutes);

// Pedidos, clientes e configurações do catálogo usam sempre o escopo forçado da loja.
router.use('/catalog', shopAuth, needTab('pedidos'), (req, _res, next) => {
  if (req.path.startsWith('/payments')) return next();
  if (/^\/settings(?:\/test-shipping)?$/.test(req.path)) {
    const allowed = req.method === 'GET' || req.method === 'PUT' || (req.method === 'POST' && req.path.endsWith('/test-shipping'));
    if (!allowed) throw new AppError(403, 'A ação não está liberada para o aplicativo.', 'FORBIDDEN');
    return needPerm('entregas')(req, _res, next);
  }
  const isCustomers = /^\/customers(?:\/|$)/.test(req.path);
  const isOrders = /^\/orders(?:\/|$)/.test(req.path);
  const isPOS = /^\/pos(?:\/|$)/.test(req.path);
  const isStrategy = req.path === '/strategy';
  const isCustomerTransfer = /^\/customers\/(?:export|import)$/.test(req.path);
  const isOrderTransfer = /^\/orders\/(?:export|import)$/.test(req.path);
  const isRestore = req.method === 'POST' && /^\/orders\/\d+\/restore$/.test(req.path);
  const isArchive = req.method === 'POST' && req.path === '/orders/bulk-delete';
  const allowed = (isPOS && (req.method === 'GET' || req.method === 'POST' || req.method === 'PUT'))
    || (isCustomers && (req.method === 'GET' || req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE' || isCustomerTransfer && (req.method === 'GET' || req.method === 'POST')))
    || (isOrders && (req.method === 'GET' || (req.method === 'PATCH' && /^\/orders\/\d+$/.test(req.path)) || isOrderTransfer && (req.method === 'GET' || req.method === 'POST')))
    || (isStrategy && req.method === 'GET')
    || isRestore || isArchive;
  if (!allowed) throw new AppError(403, 'A ação não está liberada para o aplicativo.', 'FORBIDDEN');
  const archivedArea = isRestore || (req.path === '/orders' && req.query.view === 'log');
  const area = isPOS ? 'pdv' : isStrategy ? 'estrategia' : isCustomers ? 'clientes' : archivedArea ? 'arquivados' : 'pedidos';
  needPerm(area)(req, _res, next);
}, catalogRoutes);

router.use('/instances', shopAuth, needPerm('entregas'), needTab('pedidos'), instanceRouter('envio'));
router.use('/catalog/payments', shopAuth, needPerm('entregas'), needTab('pedidos'), catalogPaymentsRouter);
router.use('/tokens', shopAuth, needPerm('api'), needTab('api'), tokenRoutes);
router.use('/audit/instances', shopAuth, needPerm('auditoria'), needTab('auditoria'), instanceRouter('auditoria'));
router.use('/audit', shopAuth, needPerm('auditoria'), needTab('auditoria'), auditRoutes);

export default router;
