import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { cleanProduct, publicProduct } from '../utils/catalog.js';

// Produtos e serviços do usuário (usados no portfólio e no catálogo digital).
const router = Router();
const imgSelect = { select: { id: true, position: true, label: true, priceCents: true }, orderBy: { position: 'asc' } };
const optionSelect = { select: { id: true, position: true, label: true, priceCents: true }, orderBy: { position: 'asc' } };
const productInclude = { images: imgSelect, priceOptions: optionSelect };
const dto = (p) => ({ ...publicProduct(p), active: p.active, createdAt: p.createdAt.getTime(), updatedAt: p.updatedAt.getTime() });

async function owned(req) {
  const id = Number(req.params.id);
  const p = Number.isInteger(id)   ? await prisma.product.findFirst({ where: { id, userId: req.user.id }, include: productInclude }) : null;
  if (!p) throw new AppError(404, 'Produto não encontrado.');
  return p;
}

async function assertCanCreate(user) {
  const limit = limitsFor(user).catalogProducts;
  if (limit < 1) throw new AppError(403, 'O seu plano não inclui produtos e catálogo digital. Mude para um plano com catálogo para cadastrar.', 'LIMIT_REACHED');
  const count = await prisma.product.count({ where: { userId: user.id } });
  if (count >= limit) throw new AppError(403, `Seu plano permite ${limit} ${limit === 1 ? 'produto/serviço' : 'produtos/serviços'}. Exclua algum ou mude de plano para cadastrar mais.`, 'LIMIT_REACHED');
}

router.get('/', async (req, res) => {
  const where = { userId: req.user.id };
  const q = String(req.query.q || '').trim();
  if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { category: { contains: q, mode: 'insensitive' } }];
  if (req.query.category) where.category = String(req.query.category);
  if (req.query.kind === 'produto' || req.query.kind === 'servico') where.kind = req.query.kind;
  const [rows, count, cats] = await Promise.all([
    prisma.product.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }], include: productInclude, take: 500 }),
    prisma.product.count({ where: { userId: req.user.id } }),
    prisma.product.findMany({ where: { userId: req.user.id }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
  ]);
  res.json({ products: rows.map(dto), count, limit: limitsFor(req.user).catalogProducts, categories: cats.map((c) => c.category).filter(Boolean) });
});

router.get('/:id', async (req, res) => {
  res.json({ product: dto(await owned(req)) });
});

router.post('/', async (req, res) => {
  await assertCanCreate(req.user);
  const { images, priceOptions, ...data } = cleanProduct(req.body);
  if (priceOptions.some((option) => option.id !== undefined)) throw new AppError(400, 'Não envie formas de preço existentes ao cadastrar um item.');
  if (images.some((i) => !i.upload)) throw new AppError(400, 'Envie as imagens do produto.');
  const p = await prisma.product.create({
    data: {
      ...data,
      userId: req.user.id,
      images: { create: images.map((im, position) => ({ position, label: im.label, priceCents: im.priceCents, mime: im.upload.mime, data: im.upload.data })) },
      priceOptions: { create: priceOptions.map((option, position) => ({ ...option, position })) },
    },
    include: productInclude,
  });
  res.status(201).json({ product: dto(p) });
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
      if (im.id !== undefined) await tx.productImage.update({ where: { id: im.id }, data: { position, label: im.label, priceCents: im.priceCents } });
      else await tx.productImage.create({ data: { productId: current.id, position, label: im.label, priceCents: im.priceCents, mime: im.upload.mime, data: im.upload.data } });
    }
    await tx.productPriceOption.deleteMany({ where: { productId: current.id, id: { notIn: [...keepPriceOptions] } } });
    for (const [position, option] of priceOptions.entries()) {
      if (option.id !== undefined) {
        await tx.productPriceOption.update({ where: { id: option.id }, data: { label: option.label, priceCents: option.priceCents, position } });
      } else {
        await tx.productPriceOption.create({ data: { productId: current.id, label: option.label, priceCents: option.priceCents, position } });
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
