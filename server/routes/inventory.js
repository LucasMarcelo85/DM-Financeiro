import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { storeScope } from '../utils/store.js';
import { ensureDefaultStockFlow, mirrorStockLevel, resolveStockFlow, syncProductStock } from '../services/inventory.js';

const router = Router();
const FLOW_LIMIT = 50;

async function selectedFlows(req) {
  const storeId = await storeScope(req);
  const flowIds = req.shopUser?.stockFlowIds || [];
  return { storeId, flowIds };
}

function assertFlowAccess(flow, req) {
  if (req.shopUser && !req.shopUser.stockFlowIds.includes(flow.id)) {
    throw new AppError(403, 'Seu acesso não permite usar este fluxo de estoque.', 'FORBIDDEN');
  }
}

router.get('/flows', async (req, res) => {
  const { storeId, flowIds } = await selectedFlows(req);
  await prisma.$transaction(async (tx) => {
    await ensureDefaultStockFlow(tx, req.user.id, storeId);
    const products = await tx.product.findMany({
      where: { userId: req.user.id, storeId },
      include: { images: { select: { id: true, isPrimary: true, stockQuantity: true } } },
    });
    for (const product of products) await syncProductStock(tx, product);
  });
  const rows = await prisma.stockFlow.findMany({
    where: { userId: req.user.id, storeId, ...(req.shopUser ? { id: { in: flowIds } } : {}) },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    include: { levels: { include: { product: { select: { id: true, name: true, kind: true, stockEnabled: true, images: { select: { id: true, label: true, size: true, color: true } } } } } } },
  });
  res.json({ flows: rows.map((flow) => ({
    id: flow.id, name: flow.name, isDefault: flow.isDefault,
    levels: flow.levels.map((level) => {
      const imageId = level.variantKey.startsWith('image:') ? Number(level.variantKey.slice('image:'.length)) : null;
      const image = imageId ? level.product.images.find((row) => row.id === imageId) : null;
      return {
        productId: level.productId, productName: level.product.name, kind: level.product.kind,
        stockEnabled: level.product.stockEnabled, variantKey: level.variantKey, quantity: level.quantity,
        variantLabel: image ? [image.label, image.size, image.color].filter(Boolean).join(' · ') || `Variação ${image.id}` : null,
      };
    }),
  })) });
});

router.post('/flows', async (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (name.length < 2) throw new AppError(400, 'Informe um nome com pelo menos 2 caracteres para o fluxo.');
  const { storeId } = await selectedFlows(req);
  const flow = await prisma.$transaction(async (tx) => {
    await ensureDefaultStockFlow(tx, req.user.id, storeId);
    const count = await tx.stockFlow.count({ where: { userId: req.user.id, storeId } });
    if (count >= FLOW_LIMIT) throw new AppError(403, `Cada loja pode ter até ${FLOW_LIMIT} fluxos de estoque.`, 'LIMIT_REACHED');
    const created = await tx.stockFlow.create({ data: { userId: req.user.id, storeId, name } });
    const products = await tx.product.findMany({
      where: { userId: req.user.id, storeId },
      include: { images: { select: { id: true, isPrimary: true } } },
    });
    const levels = products.flatMap((product) => [
      { flowId: created.id, productId: product.id, variantKey: 'product', quantity: 0 },
      ...product.images.filter((image) => !image.isPrimary).map((image) => ({ flowId: created.id, productId: product.id, variantKey: `image:${image.id}`, quantity: 0 })),
    ]);
    if (levels.length) await tx.stockLevel.createMany({ data: levels, skipDuplicates: true });
    return created;
  });
  if (req.shopUser) {
    const stockFlowIds = [...new Set([...req.shopUser.stockFlowIds, flow.id])];
    await prisma.storeUser.update({ where: { id: req.shopUser.id }, data: { stockFlowIds } });
  }
  res.status(201).json({ flow: { id: flow.id, name: flow.name, isDefault: flow.isDefault } });
});

router.patch('/flows/:id', async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!Number.isSafeInteger(id) || id < 1 || name.length < 2) throw new AppError(400, 'Informe um nome válido para o fluxo.');
  const { storeId } = await selectedFlows(req);
  const flow = await prisma.stockFlow.findFirst({ where: { id, userId: req.user.id, storeId } });
  if (!flow) throw new AppError(404, 'Fluxo de estoque não encontrado.');
  assertFlowAccess(flow, req);
  res.json({ flow: await prisma.stockFlow.update({ where: { id }, data: { name } }) });
});

router.delete('/flows/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { storeId } = await selectedFlows(req);
  if (!Number.isSafeInteger(id) || id < 1) throw new AppError(404, 'Fluxo de estoque não encontrado.');
  try {
    await prisma.$transaction(async (tx) => {
      const flow = await tx.stockFlow.findFirst({ where: { id, userId: req.user.id, storeId } });
      if (!flow) throw new AppError(404, 'Fluxo de estoque não encontrado.');
      assertFlowAccess(flow, req);
      if (flow.isDefault) throw new AppError(400, 'O fluxo padrão não pode ser excluído.');
      const [hasStock, hasOrders] = await Promise.all([
        tx.stockLevel.count({ where: { flowId: id, quantity: { gt: 0 } } }),
        tx.order.count({ where: { stockFlowId: id } }),
      ]);
      if (hasStock) throw new AppError(409, 'Transfira ou zere todo o estoque antes de excluir este fluxo.');
      if (hasOrders) throw new AppError(409, 'Este fluxo está vinculado a pedidos e não pode ser excluído para preservar o histórico de estoque.');
      const users = await tx.storeUser.findMany({ where: { storeId }, select: { id: true, stockFlowIds: true } });
      for (const user of users) {
        if (user.stockFlowIds.includes(id)) {
          await tx.storeUser.update({ where: { id: user.id }, data: { stockFlowIds: { set: user.stockFlowIds.filter((flowId) => flowId !== id) } } });
        }
      }
      await tx.stockFlow.delete({ where: { id } });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error?.code === 'P2034') throw new AppError(409, 'O fluxo foi alterado ao mesmo tempo. Atualize e tente novamente.', 'CONCURRENT_UPDATE');
    throw error;
  }
  res.json({ ok: true });
});

router.post('/transfers', async (req, res) => {
  const { storeId } = await selectedFlows(req);
  if (!Array.isArray(req.body?.items) || req.body.items.length < 1 || req.body.items.length > 100) {
    throw new AppError(400, 'Escolha de 1 a 100 itens para movimentar.');
  }
  const lines = req.body.items.map((item) => {
    const productId = Number(item?.productId);
    const qty = Number(item?.quantity);
    const variantKey = String(item?.variantKey || 'product');
    if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(qty) || qty < 1 || qty > 1_000_000
      || (variantKey !== 'product' && !/^image:[1-9]\d*$/.test(variantKey))) throw new AppError(400, 'Um item da movimentação é inválido.');
    return { productId, quantity: qty, variantKey };
  });
  const from = await resolveStockFlow(prisma, req.user.id, storeId, req.body?.fromFlowId, req.shopUser?.stockFlowIds);
  const to = await resolveStockFlow(prisma, req.user.id, storeId, req.body?.toFlowId, req.shopUser?.stockFlowIds);
  if (from.id === to.id) throw new AppError(400, 'Escolha fluxos de origem e destino diferentes.');
  const productIds = [...new Set(lines.map((line) => line.productId))];

  await prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, userId: req.user.id, storeId, stockEnabled: true },
      include: { images: { select: { id: true } } },
    });
    if (products.length !== productIds.length) throw new AppError(400, 'Um produto não controla estoque ou não pertence a esta loja.');
    const byId = new Map(products.map((product) => [product.id, product]));
    for (const line of lines) {
      const product = byId.get(line.productId);
      if (line.variantKey.startsWith('image:')) {
        const imageId = Number(line.variantKey.slice(6));
        if (!product.images.some((image) => image.id === imageId)) throw new AppError(400, `A variação de ${product.name} não pertence ao produto.`);
      }
      const source = await tx.stockLevel.updateMany({
        where: { flowId: from.id, productId: line.productId, variantKey: line.variantKey, quantity: { gte: line.quantity } },
        data: { quantity: { decrement: line.quantity } },
      });
      if (source.count !== 1) throw new AppError(409, `Estoque insuficiente de ${product.name} no fluxo ${from.name}.`);
      await tx.stockLevel.upsert({
        where: { flowId_productId_variantKey: { flowId: to.id, productId: line.productId, variantKey: line.variantKey } },
        create: { flowId: to.id, productId: line.productId, variantKey: line.variantKey, quantity: line.quantity },
        update: { quantity: { increment: line.quantity } },
      });
      const [sourceRow, destinationRow] = await Promise.all([
        tx.stockLevel.findUnique({ where: { flowId_productId_variantKey: { flowId: from.id, productId: line.productId, variantKey: line.variantKey } } }),
        tx.stockLevel.findUnique({ where: { flowId_productId_variantKey: { flowId: to.id, productId: line.productId, variantKey: line.variantKey } } }),
      ]);
      await mirrorStockLevel(tx, from, line.productId, line.variantKey, sourceRow.quantity);
      await mirrorStockLevel(tx, to, line.productId, line.variantKey, destinationRow.quantity);
    }
  }, { isolationLevel: 'Serializable' });
  res.json({ ok: true, from: from.name, to: to.name });
});

export default router;
