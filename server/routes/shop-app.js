import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { computeAccess } from '../services/access.js';
import productRoutes from './products.js';
import catalogRoutes from './catalog.js';

// Aplicativo do lojista: acesso restrito a uma loja extra (produtos, pedidos, clientes e arquivados).
// Usa um login próprio (não o da conta do dono) e reaproveita as rotas de produtos e pedidos já escopadas por loja.
const router = Router();
const TOKEN_DAYS = 30;
const DUMMY_HASH = bcrypt.hashSync('dm-shop-app', 10);

const appName = (store) => store.appName || store.name;
const appColor = (store) => store.appColor || '#F2A33A';

async function storeFor(req) {
  const slug = String(req.query.u || req.body?.u || req.customDomain?.slug || '').toLowerCase();
  const store = slug ? await prisma.store.findUnique({ where: { slug }, include: { user: true } }) : null;
  if (!store || !store.appEnabled || !computeAccess(store.user).hasAccess) throw new AppError(404, 'Aplicativo não encontrado.');
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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${appColor(store)}"/><text x="256" y="350" font-size="280" font-weight="700" text-anchor="middle" fill="#0F2238" font-family="sans-serif">${letter}</text></svg>`,
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
  res.json({ token, user: { name: su.name }, app: { name: appName(store), color: appColor(store) } });
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
  if (!su || !su.active || !su.store.appEnabled) throw new AppError(401, 'Acesso desativado. Fale com a loja.', 'UNAUTHENTICATED');
  if (!computeAccess(su.store.user).hasAccess) throw new AppError(402, 'A licença desta loja expirou.', 'PAYMENT_REQUIRED');
  req.user = su.store.user;
  req.forcedStore = su.store.id;
  req.shopUser = su;
  next();
}

const needTab = (tab) => (req, _res, next) => {
  if (!limitsFor(req.user).tabs.includes(tab)) throw new AppError(403, 'Esta área não está disponível no plano da loja.', 'TAB_NOT_IN_PLAN');
  next();
};

router.get('/me', shopAuth, (req, res) => {
  const store = req.shopUser.store;
  res.json({ user: { name: req.shopUser.name }, app: { name: appName(store), color: appColor(store) } });
});

// Lojista cadastra, edita e desativa produtos, mas não exclui nem muda preferências da conta.
router.use('/products', shopAuth, needTab('produtos'), (req, _res, next) => {
  if (req.method === 'DELETE' || req.path.startsWith('/preferences') && req.method !== 'GET') throw new AppError(403, 'O aplicativo não permite esta ação.', 'FORBIDDEN');
  next();
}, productRoutes);

// Pedidos, clientes e arquivados: só consulta.
router.use('/catalog', shopAuth, needTab('pedidos'), (req, _res, next) => {
  const allowed = /^\/(orders|customers)(\/|$)/.test(req.path) && (req.method === 'GET' || (req.method === 'PATCH' && /^\/orders\/\d+$/.test(req.path)));
  if (!allowed) throw new AppError(403, 'O aplicativo só permite consultar pedidos e clientes e marcar pedidos como atendidos.', 'FORBIDDEN');
  next();
}, catalogRoutes);

export default router;
