import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { cleanProduct, publicProduct } from '../utils/catalog.js';
import { storeScope } from '../utils/store.js';

// Produtos e serviços do usuário (usados no portfólio e no catálogo digital).
const router = Router();
const imgSelect = { select: { id: true, position: true, label: true, size: true, color: true, colorHex: true, priceCents: true, stockQuantity: true }, orderBy: { position: 'asc' } };
const optionSelect = { select: { id: true, position: true, label: true, priceCents: true, minQuantity: true, scope: true, minCartCents: true }, orderBy: { position: 'asc' } };
const productInclude = { images: imgSelect, priceOptions: optionSelect };
const dto = (p) => ({ ...publicProduct(p), active: p.active, createdAt: p.createdAt.getTime(), updatedAt: p.updatedAt.getTime() });
const defaultPreferences = {
  categories: [],
  variationTypes: ['Cor', 'Tamanho', 'Litros'],
  priceLabels: ['Varejo', 'Atacarejo', 'Atacado', 'Mensal', 'Semestral', 'Anual'],
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

async function owned(req) {
  const id = Number(req.params.id);
  const p = Number.isInteger(id)   ? await prisma.product.findFirst({ where: { id, userId: req.user.id }, include: productInclude }) : null;
  if (!p) throw new AppError(404, 'Produto não encontrado.');
  return p;
}

async function assertCanCreate(user, requested = 1) {
  const limit = limitsFor(user).catalogProducts;
  if (limit < 1) throw new AppError(403, 'O seu plano não inclui produtos e catálogo digital. Mude para um plano com catálogo para cadastrar.', 'LIMIT_REACHED');
  const count = await prisma.product.count({ where: { userId: user.id } });
  if (count + requested > limit) throw new AppError(403, `Seu plano permite ${limit} ${limit === 1 ? 'produto/serviço' : 'produtos/serviços'} e há espaço para mais ${Math.max(0, limit - count)}. Exclua algum ou mude de plano para cadastrar mais.`, 'LIMIT_REACHED');
}

function createData(data, userId, storeId) {
  const { images, priceOptions, ...product } = data;
  if (priceOptions.some((option) => option.id !== undefined)) throw new AppError(400, 'Não envie formas de preço existentes ao cadastrar um item.');
  if (images.some((image) => !image.upload)) throw new AppError(400, 'Envie novamente as imagens do produto.');
  return {
    ...product,
    userId,
    storeId,
    images: { create: images.map((image, position) => ({ position, label: image.label, size: image.size, color: image.color, colorHex: image.colorHex, priceCents: image.priceCents, stockQuantity: image.stockQuantity, mime: image.upload.mime, data: image.upload.data })) },
    priceOptions: { create: priceOptions.map((option, position) => ({ ...option, position })) },
  };
}

router.get('/', async (req, res) => {
  const storeId = await storeScope(req);
  const where = { userId: req.user.id, storeId };
  const q = String(req.query.q || '').trim();
  if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { category: { contains: q, mode: 'insensitive' } }];
  if (req.query.category) where.category = String(req.query.category);
  if (req.query.kind === 'produto' || req.query.kind === 'servico') where.kind = req.query.kind;
  const [rows, count, cats, savedPreferences] = await Promise.all([
    prisma.product.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }], include: productInclude, take: 500 }),
    prisma.product.count({ where: { userId: req.user.id } }),
    prisma.product.findMany({ where: { userId: req.user.id }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
    prisma.productPreferences.findUnique({ where: { userId: req.user.id } }),
  ]);
  const preferences = {
    ...defaultPreferences,
    ...(savedPreferences ? {
      categories: savedPreferences.categories,
      variationTypes: savedPreferences.variationTypes,
      priceLabels: savedPreferences.priceLabels,
    } : {}),
  };
  preferences.categories = [...new Set([...preferences.categories, ...cats.map((c) => c.category).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  res.json({ products: rows.map(dto), count, limit: limitsFor(req.user).catalogProducts, categories: preferences.categories, preferences });
});

router.put('/preferences', async (req, res) => {
  const preferences = {
    categories: cleanPreferenceList(req.body?.categories, 'categorias', 100, 60),
    variationTypes: cleanPreferenceList(req.body?.variationTypes, 'tipos de variação', 30, 40),
    priceLabels: cleanPreferenceList(req.body?.priceLabels, 'formas de preço', 30, 40),
  };
  const saved = await prisma.productPreferences.upsert({
    where: { userId: req.user.id },
    create: { userId: req.user.id, ...preferences },
    update: preferences,
  });
  res.json({ preferences: { categories: saved.categories, variationTypes: saved.variationTypes, priceLabels: saved.priceLabels } });
});

router.get('/:id', async (req, res) => {
  res.json({ product: dto(await owned(req)) });
});

router.post('/', async (req, res) => {
  await assertCanCreate(req.user);
  const data = cleanProduct(req.body);
  const p = await prisma.product.create({ data: createData(data, req.user.id, await storeScope(req)), include: productInclude });
  res.status(201).json({ product: dto(p) });
});

router.post('/bulk', async (req, res) => {
  const list = req.body?.products;
  if (!Array.isArray(list) || list.length < 1 || list.length > 30) throw new AppError(400, 'Envie de 1 a 30 produtos por cadastro.');
  const imagePayloadSize = list.reduce((total, product) => total + (Array.isArray(product?.images)
    ? product.images.reduce((size, image) => size + (typeof image?.data === 'string' ? image.data.length : 0), 0)
    : 0), 0);
  if (imagePayloadSize > 32 * 1024 * 1024) throw new AppError(413, 'O lote de fotos ficou muito grande. Cadastre menos produtos ou reduza o número de imagens por produto.');
  await assertCanCreate(req.user, list.length);
  const prepared = list.map((product) => cleanProduct(product));
  const storeId = await storeScope(req);
  const products = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const data of prepared) {
      created.push(await tx.product.create({ data: createData(data, req.user.id, storeId), include: productInclude }));
    }
    return created;
  });
  res.status(201).json({ products: products.map(dto) });
});

router.patch('/:id', async (req, res) => {
  const current = await owned(req);
  const body = req.body || {};
  // Só ativar/desativar (botão rápido da lista).
  if (Object.keys(body).length === 1 && typeof body.active === 'boolean') {
    const p = await prisma.product.update({ where: { id: current.id }, data: { active: body.active }, include: productInclude });
    return res.json({ product: dto(p) });
  }
  const { images, priceOptions, ...data } = cleanProduct(body);
  const have = new Set(current.images.map((i) => i.id));
  if (images.some((i) => i.id !== undefined && !have.has(i.id))) throw new AppError(400, 'Uma das imagens não pertence a este produto.');
  const havePriceOptions = new Set(current.priceOptions.map((option) => option.id));
  if (priceOptions.some((option) => option.id !== undefined && !havePriceOptions.has(option.id))) throw new AppError(400, 'Uma das formas de preço não pertence a este produto.');
  const keep = new Set(images.filter((i) => i.id !== undefined).map((i) => i.id));
  const keepPriceOptions = new Set(priceOptions.filter((option) => option.id !== undefined).map((option) => option.id));
  const p = await prisma.$transaction(async (tx) => {
    await tx.productImage.deleteMany({ where: { productId: current.id, id: { notIn: [...keep] } } });
    for (const [position, im] of images.entries()) {
      if (im.id !== undefined) await tx.productImage.update({ where: { id: im.id }, data: { position, label: im.label, size: im.size, color: im.color, colorHex: im.colorHex, priceCents: im.priceCents, stockQuantity: im.stockQuantity } });
      else await tx.productImage.create({ data: { productId: current.id, position, label: im.label, size: im.size, color: im.color, colorHex: im.colorHex, priceCents: im.priceCents, stockQuantity: im.stockQuantity, mime: im.upload.mime, data: im.upload.data } });
    }
    await tx.productPriceOption.deleteMany({ where: { productId: current.id, id: { notIn: [...keepPriceOptions] } } });
    for (const [position, option] of priceOptions.entries()) {
      if (option.id !== undefined) {
        await tx.productPriceOption.update({ where: { id: option.id }, data: { label: option.label, priceCents: option.priceCents, minQuantity: option.minQuantity, scope: option.scope, minCartCents: option.minCartCents, position } });
      } else {
        await tx.productPriceOption.create({ data: { productId: current.id, label: option.label, priceCents: option.priceCents, minQuantity: option.minQuantity, scope: option.scope, minCartCents: option.minCartCents, position } });
      }
    }
    return tx.product.update({ where: { id: current.id }, data, include: productInclude });
  });
  res.json({ product: dto(p) });
});

router.delete('/:id', async (req, res) => {
  const p = await owned(req);
  await prisma.product.delete({ where: { id: p.id } });
  res.json({ ok: true });
});

export default router;
