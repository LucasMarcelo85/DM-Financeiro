import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { cleanCatalogConfig, defaultCatalogConfig } from '../utils/catalog.js';
import { config } from '../config.js';
import { decrypt, encrypt } from '../utils/secret.js';
import { orderDTO, quoteShipping } from '../services/orders.js';

// Catálogo digital do usuário: configuração de entregas/frete e a lista de pedidos.
const router = Router();

async function loadSettings(userId) {
  const row = await prisma.catalogSettings.findUnique({ where: { userId } });
  return { cfg: { ...defaultCatalogConfig(), ...(row?.config || {}) }, token: decrypt(row?.superfrete) };
}

// O token nunca volta para a tela: só se existe e os 4 últimos caracteres.
const tokenInfo = (token) => ({ hasSuperfreteToken: Boolean(token), superfreteHint: token ? `…${token.slice(-4)}` : '' });

router.get('/settings', async (req, res) => {
  const { cfg, token } = await loadSettings(req.user.id);
  res.json({ config: cfg, ...tokenInfo(token) });
});

router.put('/settings', async (req, res) => {
  const b = req.body || {};
  const current = await loadSettings(req.user.id);
  let token = current.token;
  if (b.clearSuperfreteToken === true) token = null;
  if (typeof b.superfreteToken === 'string' && b.superfreteToken.trim()) {
    const t = b.superfreteToken.trim();
    if (t.length < 20 || t.length > 4000 || /\s/.test(t)) throw new AppError(400, 'O token do SuperFrete parece inválido. Copie o token completo da sua conta SuperFrete.');
    token = t;
  }
  const cfg = cleanCatalogConfig(b.config, { hasToken: Boolean(token) });
  const superfrete = token ? encrypt(token) : null;
  await prisma.catalogSettings.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, config: cfg, superfrete }, update: { config: cfg, superfrete } });
  res.json({ config: cfg, ...tokenInfo(token) });
});

// "Testar frete": simula com a configuração salva para um CEP de exemplo.
router.post('/settings/test-shipping', async (req, res) => {
  const { cfg, token } = await loadSettings(req.user.id);
  if (!cfg.correios.enabled) throw new AppError(400, 'Ative e salve as configurações dos Correios antes de testar.');
  const q = await quoteShipping({ cfg, token }, 'correios', { zip: req.body?.zip }, 0);
  res.json({ options: q.options, provider: 'SuperFrete' });
});

// ---------- Pedidos ----------
router.get('/orders', async (req, res) => {
  const where = { userId: req.user.id };
  if (req.query.status === 'novo' || req.query.status === 'atendido') where.status = req.query.status;
  const q = String(req.query.q || '').trim();
  if (q) where.OR = [{ customerName: { contains: q, mode: 'insensitive' } }, { customerPhone: { contains: q.replace(/\D/g, '') || '§' } }, { code: { contains: q.toUpperCase() } }];
  const [rows, total, fresh] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 }),
    prisma.order.count({ where: { userId: req.user.id } }),
    prisma.order.count({ where: { userId: req.user.id, status: 'novo' } }),
  ]);
  res.json({ orders: rows.map(orderDTO), total, fresh, retentionDays: config.orderRetentionDays });
});

async function ownedOrder(req) {
  const id = Number(req.params.id);
  const o = Number.isInteger(id) ? await prisma.order.findFirst({ where: { id, userId: req.user.id } }) : null;
  if (!o) throw new AppError(404, 'Pedido não encontrado.');
  return o;
}

router.patch('/orders/:id', async (req, res) => {
  const o = await ownedOrder(req);
  const status = req.body?.status;
  if (status !== 'novo' && status !== 'atendido') throw new AppError(400, 'Situação inválida.');
  res.json({ order: orderDTO(await prisma.order.update({ where: { id: o.id }, data: { status } })) });
});

router.delete('/orders/:id', async (req, res) => {
  const o = await ownedOrder(req);
  await prisma.order.delete({ where: { id: o.id } });
  res.json({ ok: true });
});

// Exclui vários de uma vez (`ids`) ou todos (`all: true`).
router.post('/orders/bulk-delete', async (req, res) => {
  const b = req.body || {};
  let where;
  if (b.all === true) where = { userId: req.user.id };
  else {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
    if (!ids.length) throw new AppError(400, 'Escolha os pedidos para excluir.');
    where = { userId: req.user.id, id: { in: ids } };
  }
  const r = await prisma.order.deleteMany({ where });
  res.json({ ok: true, removed: r.count });
});

export default router;
