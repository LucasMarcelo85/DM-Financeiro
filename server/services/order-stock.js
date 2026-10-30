import { AppError } from '../utils/helpers.js';
import { ensureDefaultStockFlow, mirrorStockLevel } from './inventory.js';

function variationImage(product, item) {
  if (Number.isInteger(item.imageId)) return product.images.find((image) => image.id === item.imageId) || null;
  const variation = String(item.variation || '');
  if (!variation) return null;
  return [...product.images]
    .filter((image) => !image.isPrimary && (variation === image.label || variation.startsWith(`${image.label} · `)))
    .sort((a, b) => b.label.length - a.label.length)[0] || null;
}

export async function changeOrderStock(tx, order, direction) {
  const items = Array.isArray(order.items) ? order.items : [];
  const productIds = [...new Set(items.map((item) => Number(item.productId)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!productIds.length) return;

  const products = await tx.product.findMany({
    where: { id: { in: productIds }, userId: order.userId, storeId: order.storeId },
    select: { id: true, name: true, stockEnabled: true, images: { select: { id: true, label: true, isPrimary: true } } },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const demand = new Map();
  const flow = order.stockFlowId
    ? await tx.stockFlow.findFirst({ where: { id: order.stockFlowId, userId: order.userId, storeId: order.storeId } })
    : await ensureDefaultStockFlow(tx, order.userId, order.storeId);
  if (!flow) throw new AppError(409, 'O fluxo de estoque deste pedido não está disponível.');

  for (const item of items) {
    const product = byId.get(Number(item.productId));
    if (!product || (item.stockTracked === undefined ? !product.stockEnabled : !item.stockTracked)) continue;
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1) continue;

    const image = variationImage(product, item);
    if (item.imageId && !image) throw new AppError(409, `Não foi possível localizar a variação de ${product.name} para ajustar o estoque.`);
    if (!item.imageId && item.variation && !image && product.images.some((row) => !row.isPrimary)) {
      throw new AppError(409, `Não foi possível identificar a variação de ${product.name} para ajustar o estoque.`);
    }

    const key = image ? `image:${image.id}` : `product:${product.id}`;
    const previous = demand.get(key);
    demand.set(key, { product, image, qty: qty + (previous?.qty || 0) });
  }

  for (const row of demand.values()) {
    const delta = direction === 'restore' ? { increment: row.qty } : { decrement: row.qty };
    const variantKey = row.image ? `image:${row.image.id}` : 'product';
    const result = await tx.stockLevel.updateMany({
      where: {
        flowId: flow.id, productId: row.product.id, variantKey,
        ...(direction === 'reserve' ? { quantity: { gte: row.qty } } : {}),
      },
      data: { quantity: direction === 'restore' ? { increment: row.qty } : { decrement: row.qty } },
    });
    if (result.count !== 1) {
      const action = direction === 'reserve' ? 'vender' : 'restaurar o pedido';
      throw new AppError(409, `Estoque insuficiente para ${action} ${row.product.name}. Reponha o estoque e tente novamente.`);
    }
    const updated = await tx.stockLevel.findUnique({
      where: { flowId_productId_variantKey: { flowId: flow.id, productId: row.product.id, variantKey } },
    });
    await mirrorStockLevel(tx, flow, row.product.id, variantKey, updated.quantity);
  }
}
