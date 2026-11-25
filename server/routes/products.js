import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { cleanBarcode, cleanProduct, publicProduct } from '../utils/catalog.js';
import { storeScope } from '../utils/store.js';
import { emitApiWebhook } from '../services/api-webhooks.js';
import { dateRange } from '../utils/date-range.js';
import { ensureDefaultStockFlow, syncProductStock } from '../services/inventory.js';

// Produtos e serviços do usuário (usados no portfólio e no catálogo digital).
const router = Router();
const imgSelect = { select: { id: true, position: true, isPrimary: true, label: true, size: true, color: true, colorHex: true, barcode: true, priceCents: true, stockQuantity: true, mime: true, externalUrl: true }, orderBy: { position: 'asc' } };
const optionSelect = { select: { id: true, position: true, label: true, priceCents: true, minQuantity: true, scope: true, minCartCents: true }, orderBy: { position: 'asc' } };
const productInclude = {
  images: imgSelect,
  priceOptions: optionSelect,
  stockLevels: { where: { variantKey: 'product' }, select: { flowId: true, isActive: true } },
};
const dto = (p, allowedFlowIds = null) => ({
  ...publicProduct(p),
  active: p.active,
  activeFlowIds: (p.stockLevels || []).filter((level) => level.isActive && (!allowedFlowIds || allowedFlowIds.includes(level.flowId))).map((level) => level.flowId),
  createdAt: p.createdAt.getTime(),
  updatedAt: p.updatedAt.getTime(),
});
const publishProduct = (userId, product, event) => emitApiWebhook({
  userId, storeId: product.storeId, event, data: dto(product),
}).catch((error) => console.error(`[api-webhook] produto ${product.id}: ${error.message}`));
const defaultPreferences = {
  categories: [],
  variationTypes: ['Cor', 'Tamanho', 'Litros'],
  priceLabels: ['Varejo', 'Atacarejo', 'Atacado', 'Mensal', 'Semestral', 'Anual'],
  priceRules: [],
};

function cleanPreferenceList(value, label, maxItems, maxLength) {
  if (!Array.isArray(value)) throw new AppError(400, `A lista de ${label} é inválida.`);
  if (value.length > maxItems) throw new AppError(400, `Use no máximo ${maxItems} itens em ${label}.`);
  const seen = new Set();
  return value.map((item) => {
    if (typeof item !== 'string') throw new AppError(400, `Um item da lista de ${label} é inválido.`);
    return item.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  })
    .filter((item) => {
      const key = item.toLocaleLowerCase('pt-BR');
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems);
}

function cleanPriceRules(value) {
  if (!Array.isArray(value)) throw new AppError(400, 'A lista de preços pré-configurados é inválida.');
  if (value.length > 12) throw new AppError(400, 'Configure no máximo 12 preços.');
  const seenLabels = new Set();
  return value.map((rule) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new AppError(400, 'Uma configuração de preço é inválida.');
    const label = typeof rule.label === 'string' ? rule.label.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    const scope = rule.scope;
    const minQuantity = Number(rule.minQuantity);
    const minCartCents = Number(rule.minCartCents);
    if (!label) throw new AppError(400, 'Informe o nome de cada preço pré-configurado.');
    const key = label.toLocaleLowerCase('pt-BR');
    if (seenLabels.has(key)) throw new AppError(400, 'Use nomes diferentes para cada preço pré-configurado.');
    seenLabels.add(key);
    if (!['same_product', 'cart_quantity', 'cart_value'].includes(scope)) throw new AppError(400, 'A regra de aplicação do preço é inválida.');
    if (scope === 'cart_value') {
      if (!Number.isSafeInteger(minCartCents) || minCartCents < 1 || minCartCents > 100_000_000_000) {
        throw new AppError(400, 'Informe um valor mínimo válido para o carrinho.');
      }
    } else if (!Number.isInteger(minQuantity) || minQuantity < 1 || minQuantity > 999) {
      throw new AppError(400, 'Informe uma quantidade mínima entre 1 e 999.');
    }
    return {
      label,
      scope,
      minQuantity: scope === 'cart_value' ? 1 : minQuantity,
      minCartCents: scope === 'cart_value' ? minCartCents : 0,
    };
  });
}

const normalizeRuleLabel = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');

// Preferências da loja atual. Cada loja tem a sua; a conta principal usa a linha do usuário.
// Loja sem configuração própria herda a do dono (só na visão do dono), como era antes.
async function loadSavedPreferences(req, storeId) {
  if (storeId === null || storeId === undefined) {
    return req.forcedStore === undefined ? prisma.productPreferences.findUnique({ where: { userId: req.user.id } }) : null;
  }
  const own = await prisma.productStorePreferences.findUnique({ where: { storeId } });
  if (own) return own;
  return req.forcedStore === undefined ? prisma.productPreferences.findUnique({ where: { userId: req.user.id } }) : null;
}

// Aplica as faixas configuradas a todos os produtos da loja: renomear/alterar regra atualiza os produtos
// (mantendo o valor digitado) e remover uma faixa apaga o valor dela. Faixas antigas sem correspondência ficam como estão.
async function syncPriceOptions(tx, userId, storeId, rules, originalLabels, previousRules) {
  const kept = new Set(originalLabels.map(normalizeRuleLabel).filter(Boolean));
  const removed = new Set(previousRules.map((rule) => normalizeRuleLabel(rule?.label)).filter((label) => label && !kept.has(label)));
  if (!rules.length && !removed.size) return 0;
  const options = await tx.productPriceOption.findMany({
    where: { product: { userId, storeId: storeId ?? null } },
    orderBy: [{ productId: 'asc' }, { position: 'asc' }],
  });
  const byProduct = new Map();
  for (const option of options) byProduct.set(option.productId, [...(byProduct.get(option.productId) || []), option]);
  const touched = new Set();
  const deleteIds = [];
  const updates = [];
  for (const [productId, group] of byProduct) {
    const used = new Set();
    rules.forEach((rule, index) => {
      const wanted = normalizeRuleLabel(originalLabels[index] || rule.label);
      const match = group.find((option) => !used.has(option.id) && normalizeRuleLabel(option.label) === wanted);
      if (!match) return;
      used.add(match.id);
      if (match.label !== rule.label || match.scope !== rule.scope || match.minQuantity !== rule.minQuantity || match.minCartCents !== rule.minCartCents) {
        updates.push({ id: match.id, data: { label: rule.label, scope: rule.scope, minQuantity: rule.minQuantity, minCartCents: rule.minCartCents } });
        touched.add(productId);
      }
    });
    for (const option of group) {
      if (!used.has(option.id) && removed.has(normalizeRuleLabel(option.label))) {
        deleteIds.push(option.id);
        touched.add(productId);
      }
    }
  }
  for (const update of updates) await tx.productPriceOption.update({ where: { id: update.id }, data: update.data });
  if (deleteIds.length) await tx.productPriceOption.deleteMany({ where: { id: { in: deleteIds } } });
  if (touched.size) await tx.product.updateMany({ where: { id: { in: [...touched] } }, data: { updatedAt: new Date() } });
  return touched.size;
}

async function owned(req) {
  const id = Number(req.params.id);
  const p = Number.isInteger(id) ? await prisma.product.findFirst({ where: { id, userId: req.user.id, storeId: await storeScope(req) }, include: productInclude }) : null;
  if (!p) throw new AppError(404, 'Produto não encontrado.');
  return p;
}

async function assertCanCreate(req, requested = 1, storeId = null) {
  const user = req.user;
  const limit = limitsFor(user).catalogProducts;
  if (limit < 1) throw new AppError(403, 'O seu plano não inclui produtos e catálogo digital. Mude para um plano com catálogo para cadastrar.', 'LIMIT_REACHED');
  const count = await prisma.product.count({ where: { userId: user.id } });
  if (count + requested > limit) throw new AppError(403, `Seu plano permite ${limit} ${limit === 1 ? 'produto/serviço' : 'produtos/serviços'} e há espaço para mais ${Math.max(0, limit - count)}. Exclua algum ou mude de plano para cadastrar mais.`, 'LIMIT_REACHED');
  if (req.shopUser) {
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { appProductLimit: true } });
    const appLimit = Math.min(limit, store?.appProductLimit ?? limit);
    const appCount = await prisma.product.count({ where: { userId: user.id, storeId } });
    if (appCount + requested > appLimit) throw new AppError(403, `O criador do aplicativo liberou até ${appLimit} produtos nesta loja.`, 'LIMIT_REACHED');
  }
}

async function setActiveStockFlows(tx, req, productId, storeId, requestedFlowIds) {
  const defaultFlow = await ensureDefaultStockFlow(tx, req.user.id, storeId);
  const flows = await tx.stockFlow.findMany({ where: { userId: req.user.id, storeId }, select: { id: true } });
  const allowedIds = new Set(flows
    .filter((flow) => !req.shopUser || req.shopUser.stockFlowIds.includes(flow.id) || flow.id === defaultFlow.id)
    .map((flow) => flow.id));
  const activeFlowIds = requestedFlowIds === undefined ? [defaultFlow.id] : requestedFlowIds;
  if (!Array.isArray(activeFlowIds) || activeFlowIds.some((id) => !Number.isSafeInteger(id) || !allowedIds.has(id))) {
    throw new AppError(400, 'Seleção de fluxos de estoque inválida.');
  }
  await tx.stockLevel.updateMany({
    where: { productId, variantKey: 'product', flowId: { in: flows.map((flow) => flow.id) } },
    data: { isActive: false },
  });
  if (activeFlowIds.length) {
    await tx.stockLevel.updateMany({
      where: { productId, variantKey: 'product', flowId: { in: [...new Set(activeFlowIds)] } },
      data: { isActive: true },
    });
  }
}

function createData(data, userId, storeId) {
  const { images, priceOptions, ...product } = data;
  if (priceOptions.some((option) => option.id !== undefined)) throw new AppError(400, 'Não envie formas de preço existentes ao cadastrar um item.');
  if (images.some((image) => image.id !== undefined || (image.isPrimary && !image.upload && !image.externalUrl))) {
    throw new AppError(400, 'Envie novamente as imagens do produto.');
  }
  return {
    ...product,
    userId,
    storeId,
    images: { create: images.map((image, position) => ({ position, isPrimary: image.isPrimary, label: image.label, size: image.size, color: image.color, colorHex: image.colorHex, barcode: image.barcode, priceCents: image.priceCents, stockQuantity: image.stockQuantity, mime: image.upload?.mime || null, data: image.upload?.data || null, externalUrl: image.externalUrl || null })) },
    priceOptions: { create: priceOptions.map((option, position) => ({ ...option, position })) },
  };
}

router.get('/', async (req, res) => {
  const storeId = await storeScope(req);
  const defaultFlow = await prisma.$transaction((tx) => ensureDefaultStockFlow(tx, req.user.id, storeId));
  const allowedFlowIds = req.shopUser ? [...new Set([...req.shopUser.stockFlowIds, defaultFlow.id])] : null;
  const where = { userId: req.user.id, storeId };
  const q = String(req.query.q || '').trim();
  if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { category: { contains: q, mode: 'insensitive' } }];
  if (req.query.category) where.category = String(req.query.category);
  if (req.query.kind === 'produto' || req.query.kind === 'servico') where.kind = req.query.kind;
  const [rows, count, cats, savedPreferences, flows] = await Promise.all([
    prisma.product.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }], include: productInclude, take: 500 }),
    prisma.product.count({ where: req.shopUser ? { userId: req.user.id, storeId } : { userId: req.user.id } }),
    prisma.product.findMany({ where: { userId: req.user.id, storeId }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
    loadSavedPreferences(req, storeId),
    prisma.stockFlow.findMany({
      where: { userId: req.user.id, storeId, ...(allowedFlowIds ? { id: { in: allowedFlowIds } } : {}) },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    }),
  ]);
  const preferences = {
    ...defaultPreferences,
    ...(savedPreferences ? {
      categories: savedPreferences.categories,
      variationTypes: savedPreferences.variationTypes,
      priceLabels: savedPreferences.priceLabels,
      priceRules: savedPreferences.priceRules,
    } : {}),
  };
  let productLimit = limitsFor(req.user).catalogProducts;
  if (req.shopUser) {
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { appProductLimit: true } });
    productLimit = Math.min(productLimit, store?.appProductLimit ?? productLimit);
  }
  preferences.categories = [...new Set([...preferences.categories, ...cats.map((c) => c.category).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  res.json({
    products: rows.map((product) => dto(product, allowedFlowIds)),
    stockFlows: flows,
    count,
    limit: productLimit,
    categories: preferences.categories,
    preferences,
  });
});

router.get('/export', async (req, res) => {
  const storeId = await storeScope(req);
  const where = { userId: req.user.id, storeId, ...dateRange(req.query) };
  const products = await prisma.product.findMany({
    where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      images: { select: { position: true, isPrimary: true, label: true, size: true, color: true, colorHex: true, barcode: true, stockQuantity: true, mime: true, data: true, externalUrl: true }, orderBy: { position: 'asc' } },
      priceOptions: optionSelect,
    },
  });
  res.json({ rows: products.map((product) => {
    const images = product.images.map((image) => ({
      ...(image.externalUrl ? { url: image.externalUrl } : image.data ? { data: `data:${image.mime};base64,${Buffer.from(image.data).toString('base64')}` } : {}),
      label: image.label, size: image.size, color: image.color, colorHex: image.colorHex, barcode: image.barcode,
    }));
    const mainImage = images.find((_image, index) => product.images[index].isPrimary) || null;
    return {
      kind: product.kind, name: product.name, category: product.category, description: product.description, barcode: product.barcode,
      priceCents: product.priceCents, stockEnabled: product.stockEnabled, stockQuantity: product.stockQuantity,
      active: product.active,
      mainImage, mainImageUrl: mainImage?.url || '',
      images: images.filter((_image, index) => !product.images[index].isPrimary),
      priceOptions: product.priceOptions.map(({ label, priceCents, minQuantity, scope, minCartCents }) => ({ label, priceCents, minQuantity, scope, minCartCents })),
      sourceId: product.id, sourceUserId: req.user.id, sourceStoreId: storeId,
    };
  }) });
});

router.post('/import', async (req, res) => {
  const rows = req.body?.products;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new AppError(400, 'Envie de 1 a 500 produtos por importação.');
  const storeId = await storeScope(req);
  let created = 0;
  let skipped = 0;
  const errors = [];
  for (const [index, row] of rows.entries()) {
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new AppError(400, 'Registro de produto inválido.');
      const sourceStoreId = row.sourceStoreId === null || row.sourceStoreId === '' ? null : Number(row.sourceStoreId);
      if (Number(row.sourceUserId) === req.user.id && sourceStoreId === storeId && Number.isInteger(Number(row.sourceId))) {
        const existing = await prisma.product.findFirst({
          where: { id: Number(row.sourceId), userId: req.user.id, storeId },
          select: { id: true },
        });
        if (existing) {
          skipped += 1;
          continue;
        }
      }
      await assertCanCreate(req, 1, storeId);
      const data = cleanProduct(row);
      await assertBarcodesFree(req.user.id, storeId, barcodesOf(data));
      const product = await prisma.$transaction(async (tx) => {
        const created = await tx.product.create({ data: createData(data, req.user.id, storeId), include: productInclude });
        await syncProductStock(tx, created);
        return created;
      });
      publishProduct(req.user.id, product, 'product.created');
      created += 1;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      errors.push({ row: index + 2, message: error.message });
    }
  }
  res.json({ created, updated: 0, skipped: skipped + errors.length, errors });
});

router.put('/preferences', async (req, res) => {
  const storeId = await storeScope(req);
  const rawRules = Array.isArray(req.body?.priceRules) ? req.body.priceRules : [];
  const priceRules = cleanPriceRules(req.body?.priceRules ?? []);
  const originalLabels = rawRules.map((rule) => (typeof rule?.origLabel === 'string' ? rule.origLabel : ''));
  const configuredLabels = priceRules.map((rule) => rule.label);
  const savedPriceLabels = cleanPreferenceList(req.body?.priceLabels, 'formas de preço', 30, 40);
  const mergedPriceLabels = [...new Set([...configuredLabels, ...savedPriceLabels])].slice(0, 30);
  const preferences = {
    categories: cleanPreferenceList(req.body?.categories, 'categorias', 100, 60),
    variationTypes: cleanPreferenceList(req.body?.variationTypes, 'tipos de variação', 30, 40),
    priceLabels: cleanPreferenceList(mergedPriceLabels, 'formas de preço', 30, 40),
    priceRules,
  };
  const previous = await loadSavedPreferences(req, storeId);
  const previousRules = Array.isArray(previous?.priceRules) ? previous.priceRules : [];
  const { saved, updatedProducts } = await prisma.$transaction(async (tx) => {
    const row = storeId === null || storeId === undefined
      ? await tx.productPreferences.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, ...preferences }, update: preferences })
      : await tx.productStorePreferences.upsert({ where: { storeId }, create: { storeId, userId: req.user.id, ...preferences }, update: preferences });
    const count = await syncPriceOptions(tx, req.user.id, storeId, priceRules, originalLabels, previousRules);
    return { saved: row, updatedProducts: count };
  }, { timeout: 30000 });
  res.json({
    preferences: { categories: saved.categories, variationTypes: saved.variationTypes, priceLabels: saved.priceLabels, priceRules: saved.priceRules },
    updatedProducts,
  });
});

// Um mesmo código não pode identificar dois itens, senão o leitor do PDV não saberia qual vender.
async function assertBarcodesFree(userId, storeId, codes, ignoreProductId = 0) {
  const list = codes.filter(Boolean);
  if (new Set(list).size !== list.length) throw new AppError(400, 'O mesmo código de barras foi usado mais de uma vez neste produto.');
  if (!list.length) return;
  const productWhere = { userId, storeId, ...(ignoreProductId ? { id: { not: ignoreProductId } } : {}) };
  const [product, image] = await Promise.all([
    prisma.product.findFirst({ where: { ...productWhere, barcode: { in: list } }, select: { name: true, barcode: true } }),
    prisma.productImage.findFirst({ where: { barcode: { in: list }, product: productWhere }, select: { barcode: true, product: { select: { name: true } } } }),
  ]);
  const used = product || image;
  if (used) throw new AppError(409, `O código ${used.barcode} já está em uso em "${product?.name || image.product.name}".`);
}
const barcodesOf = (data) => [data.barcode, ...data.images.map((image) => image.barcode)];

router.get('/:id', async (req, res) => {
  res.json({ product: dto(await owned(req)) });
});

router.post('/', async (req, res) => {
  const storeId = await storeScope(req);
  await assertCanCreate(req, 1, storeId);
  const data = cleanProduct(req.body);
  await assertBarcodesFree(req.user.id, storeId, barcodesOf(data));
  const p = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({ data: createData(data, req.user.id, storeId), include: productInclude });
    await syncProductStock(tx, created);
    await setActiveStockFlows(tx, req, created.id, storeId, req.body?.activeFlowIds);
    return created;
  });
  const fresh = await prisma.product.findUnique({ where: { id: p.id }, include: productInclude });
  publishProduct(req.user.id, fresh, 'product.created');
  res.status(201).json({ product: dto(fresh, req.shopUser?.stockFlowIds) });
});

router.post('/bulk', async (req, res) => {
  const list = req.body?.products;
  if (!Array.isArray(list) || list.length < 1 || list.length > 30) throw new AppError(400, 'Envie de 1 a 30 produtos por cadastro.');
  const imagePayloadSize = list.reduce((total, product) => total + [
    ...(Array.isArray(product?.images) ? product.images : []),
    ...(product?.mainImage ? [product.mainImage] : []),
  ].reduce((size, image) => size + (typeof image?.data === 'string' ? image.data.length : 0), 0), 0);
  if (imagePayloadSize > 32 * 1024 * 1024) throw new AppError(413, 'O lote de fotos ficou muito grande. Cadastre menos produtos ou reduza o número de imagens por produto.');
  const storeId = await storeScope(req);
  await assertCanCreate(req, list.length, storeId);
  const prepared = list.map((product) => ({ data: cleanProduct(product), activeFlowIds: product?.activeFlowIds }));
  for (const product of prepared) await assertBarcodesFree(req.user.id, storeId, barcodesOf(product.data));
  const products = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const item of prepared) {
      const product = await tx.product.create({ data: createData(item.data, req.user.id, storeId), include: productInclude });
      await syncProductStock(tx, product);
      await setActiveStockFlows(tx, req, product.id, storeId, item.activeFlowIds);
      created.push(product);
    }
    return Promise.all(created.map((product) => tx.product.findUnique({ where: { id: product.id }, include: productInclude })));
  });
  for (const product of products) publishProduct(req.user.id, product, 'product.created');
  res.status(201).json({ products: products.map((product) => dto(product, req.shopUser?.stockFlowIds)) });
});

router.patch('/:id', async (req, res) => {
  const current = await owned(req);
  const body = req.body || {};
  // Só ativar/desativar (botão rápido da lista).
  if (Object.keys(body).length === 1 && typeof body.active === 'boolean') {
    const p = await prisma.product.update({ where: { id: current.id }, data: { active: body.active }, include: productInclude });
    publishProduct(req.user.id, p, 'product.updated');
    return res.json({ product: dto(p) });
  }
  // Só o código de barras (gerar código na impressão de etiquetas).
  if (Object.keys(body).length === 1 && typeof body.barcode === 'string') {
    const barcode = cleanBarcode(body.barcode);
    await assertBarcodesFree(req.user.id, current.storeId, [barcode], current.id);
    const p = await prisma.product.update({ where: { id: current.id }, data: { barcode }, include: productInclude });
    publishProduct(req.user.id, p, 'product.updated');
    return res.json({ product: dto(p) });
  }
  const { images, priceOptions, ...data } = cleanProduct(body, { existingImages: current.images });
  await assertBarcodesFree(req.user.id, current.storeId, [data.barcode, ...images.map((image) => image.barcode)], current.id);
  const have = new Set(current.images.map((i) => i.id));
  if (images.some((i) => i.id !== undefined && !have.has(i.id))) throw new AppError(400, 'Uma das imagens não pertence a este produto.');
  const havePriceOptions = new Set(current.priceOptions.map((option) => option.id));
  if (priceOptions.some((option) => option.id !== undefined && !havePriceOptions.has(option.id))) throw new AppError(400, 'Uma das formas de preço não pertence a este produto.');
  const keep = new Set(images.filter((i) => i.id !== undefined).map((i) => i.id));
  const keepPriceOptions = new Set(priceOptions.filter((option) => option.id !== undefined).map((option) => option.id));
  const p = await prisma.$transaction(async (tx) => {
    await tx.productImage.deleteMany({ where: { productId: current.id, id: { notIn: [...keep] } } });
    for (const [position, im] of images.entries()) {
      if (im.id !== undefined) await tx.productImage.update({ where: { id: im.id }, data: {
        position, isPrimary: im.isPrimary, label: im.label, size: im.size, color: im.color, colorHex: im.colorHex, barcode: im.barcode, priceCents: im.priceCents, stockQuantity: im.stockQuantity,
        ...(im.upload ? { mime: im.upload.mime, data: im.upload.data, externalUrl: null } : im.removeImage ? { mime: null, data: null, externalUrl: null } : im.externalUrl ? { mime: null, data: null, externalUrl: im.externalUrl } : {}),
      } });
      else await tx.productImage.create({ data: { productId: current.id, position, isPrimary: im.isPrimary, label: im.label, size: im.size, color: im.color, colorHex: im.colorHex, barcode: im.barcode, priceCents: im.priceCents, stockQuantity: im.stockQuantity, mime: im.upload?.mime || null, data: im.upload?.data || null, externalUrl: im.externalUrl || null } });
    }
    await tx.productPriceOption.deleteMany({ where: { productId: current.id, id: { notIn: [...keepPriceOptions] } } });
    for (const [position, option] of priceOptions.entries()) {
      if (option.id !== undefined) {
        await tx.productPriceOption.update({ where: { id: option.id }, data: { label: option.label, priceCents: option.priceCents, minQuantity: option.minQuantity, scope: option.scope, minCartCents: option.minCartCents, position } });
      } else {
        await tx.productPriceOption.create({ data: { productId: current.id, label: option.label, priceCents: option.priceCents, minQuantity: option.minQuantity, scope: option.scope, minCartCents: option.minCartCents, position } });
      }
    }
    const updated = await tx.product.update({ where: { id: current.id }, data, include: productInclude });
    await syncProductStock(tx, updated);
    if (body.activeFlowIds !== undefined) await setActiveStockFlows(tx, req, current.id, current.storeId, body.activeFlowIds);
    return updated;
  });
  const fresh = await prisma.product.findUnique({ where: { id: p.id }, include: productInclude });
  publishProduct(req.user.id, fresh, 'product.updated');
  res.json({ product: dto(fresh, req.shopUser?.stockFlowIds) });
});

router.delete('/:id', async (req, res) => {
  const p = await owned(req);
  await prisma.product.delete({ where: { id: p.id } });
  publishProduct(req.user.id, p, 'product.deleted');
  res.json({ ok: true });
});

export default router;