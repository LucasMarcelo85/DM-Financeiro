import { AppError } from '../utils/helpers.js';

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
    const where = row.image
      ? { id: row.image.id, productId: row.product.id, ...(direction === 'reserve' ? { stockQuantity: { gte: row.qty } } : {}) }
      : { id: row.product.id, userId: order.userId, storeId: order.storeId, ...(direction === 'reserve' ? { stockQuantity: { gte: row.qty } } : {}) };
    const result = row.image
      ? await tx.productImage.updateMany({ where, data: { stockQuantity: delta } })
      : await tx.product.updateMany({ where, data: { stockQuantity: delta } });
    if (result.count !== 1) {
      const action = direction === 'reserve' ? 'vender' : 'restaurar o pedido';
      throw new AppError(409, `Estoque insuficiente para ${action} ${row.product.name}. Reponha o estoque e tente novamente.`);
    }
  }
}
