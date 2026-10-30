import { AppError } from '../utils/helpers.js';

export async function ensureDefaultStockFlow(tx, userId, storeId) {
  const existing = await tx.stockFlow.findFirst({ where: { userId, storeId, isDefault: true } });
  if (existing) return existing;
  await tx.stockFlow.createMany({
    data: [{ userId, storeId, name: 'Estoque principal', isDefault: true }],
    skipDuplicates: true,
  });
  const created = await tx.stockFlow.findFirst({ where: { userId, storeId, isDefault: true } });
  if (!created) throw new Error('Não foi possível inicializar o fluxo padrão de estoque.');
  return created;
}

export async function syncProductStock(tx, product) {
  const flows = await tx.stockFlow.findMany({
    where: { userId: product.userId, storeId: product.storeId },
    select: { id: true, isDefault: true },
  });
  const defaultFlow = flows.find((flow) => flow.isDefault) || await ensureDefaultStockFlow(tx, product.userId, product.storeId);
  const rows = [
    { variantKey: 'product', quantity: product.stockQuantity },
    ...(product.images || []).filter((image) => !image.isPrimary).map((image) => ({ variantKey: `image:${image.id}`, quantity: image.stockQuantity })),
  ];
  const keys = rows.map((row) => row.variantKey);
  for (const flow of flows) {
    await tx.stockLevel.deleteMany({
      where: { flowId: flow.id, productId: product.id, variantKey: { notIn: keys } },
    });
  }
  await tx.stockLevel.createMany({
    data: flows.filter((flow) => !flow.isDefault).flatMap((flow) => rows.map((row) => ({
      flowId: flow.id, productId: product.id, variantKey: row.variantKey, quantity: 0,
    }))),
    skipDuplicates: true,
  });
  for (const row of rows) {
    await tx.stockLevel.upsert({
      where: { flowId_productId_variantKey: { flowId: defaultFlow.id, productId: product.id, variantKey: row.variantKey } },
      create: { flowId: defaultFlow.id, productId: product.id, ...row },
      update: { quantity: row.quantity },
    });
  }
}

export async function resolveStockFlow(tx, userId, storeId, flowId, allowedFlowIds = null) {
  let flow;
  if (flowId == null || flowId === '') {
    flow = await ensureDefaultStockFlow(tx, userId, storeId);
  } else {
    const id = Number(flowId);
    flow = Number.isSafeInteger(id) && id > 0
      ? await tx.stockFlow.findFirst({ where: { id, userId, storeId } })
      : null;
  }
  if (!flow) throw new AppError(400, 'Fluxo de estoque inválido.');
  if (allowedFlowIds && !allowedFlowIds.includes(flow.id)) {
    throw new AppError(403, 'Seu acesso não permite usar este fluxo de estoque.', 'FORBIDDEN');
  }
  return flow;
}

export async function mirrorStockLevel(tx, flow, productId, variantKey, quantity) {
  if (!flow.isDefault) return;
  if (variantKey === 'product') {
    await tx.product.updateMany({ where: { id: productId, userId: flow.userId, storeId: flow.storeId }, data: { stockQuantity: quantity } });
    return;
  }
  const imageId = Number(variantKey.slice('image:'.length));
  if (!Number.isSafeInteger(imageId) || imageId < 1) throw new AppError(409, 'Variação de estoque inválida.');
  await tx.productImage.updateMany({ where: { id: imageId, productId }, data: { stockQuantity: quantity } });
}
