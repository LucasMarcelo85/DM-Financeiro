import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { cleanDoc, cleanName } from '../utils/contract.js';

const router = Router();

const ms = (d) => (d ? d.getTime() : null);
const summaryDTO = (c) => ({ id: c.id, name: c.name, pageCount: c.pageCount, createdAt: ms(c.createdAt), updatedAt: ms(c.updatedAt) });
const fullDTO = (c) => ({ ...summaryDTO(c), data: c.data });
const summarySelect = { id: true, name: true, pageCount: true, createdAt: true, updatedAt: true };

async function owned(req, withData = false) {
  const id = Number(req.params.id);
  const c = Number.isInteger(id)
    ? await prisma.contract.findFirst({ where: { id, userId: req.user.id }, ...(withData ? {} : { select: summarySelect }) })
    : null;
  if (!c) throw new AppError(404, 'Contrato não encontrado.');
  return c;
}

// Cada plano tem um número máximo de modelos de contrato.
async function assertCanCreate(user) {
  const limit = limitsFor(user).contracts;
  const count = await prisma.contract.count({ where: { userId: user.id } });
  if (count >= limit) {
    throw new AppError(403, `Seu plano permite ${limit} ${limit === 1 ? 'modelo de contrato' : 'modelos de contrato'}. Exclua um modelo ou mude de plano para criar mais.`, 'LIMIT_REACHED');
  }
}

// A lista não traz o conteúdo (pode ter imagens pesadas): só o resumo de cada contrato.
router.get('/', async (req, res) => {
  const rows = await prisma.contract.findMany({ where: { userId: req.user.id }, orderBy: { updatedAt: 'desc' }, select: summarySelect });
  res.json({ contracts: rows.map(summaryDTO), limit: limitsFor(req.user).contracts });
});

router.get('/:id', async (req, res) => {
  res.json({ contract: fullDTO(await owned(req, true)) });
});

router.post('/', async (req, res) => {
  await assertCanCreate(req.user);
  const name = cleanName(req.body?.name);
  const data = cleanDoc(req.body?.data);
  const c = await prisma.contract.create({ data: { userId: req.user.id, name, data, pageCount: data.pages.length } });
  res.status(201).json({ contract: fullDTO(c) });
});

router.patch('/:id', async (req, res) => {
  const current = await owned(req);
  const patch = {};
  if (req.body?.name !== undefined) patch.name = cleanName(req.body.name);
  if (req.body?.data !== undefined) {
    patch.data = cleanDoc(req.body.data);
    patch.pageCount = patch.data.pages.length;
  }
  if (!Object.keys(patch).length) throw new AppError(400, 'Nada para atualizar.');
  const c = await prisma.contract.update({ where: { id: current.id }, data: patch });
  res.json({ contract: summaryDTO(c) });
});

router.post('/:id/duplicate', async (req, res) => {
  const current = await owned(req, true);
  await assertCanCreate(req.user);
  const name = `${current.name} (cópia)`.slice(0, 120);
  const c = await prisma.contract.create({ data: { userId: req.user.id, name, data: current.data, pageCount: current.pageCount } });
  res.status(201).json({ contract: summaryDTO(c) });
});

router.delete('/:id', async (req, res) => {
  const c = await owned(req);
  await prisma.contract.delete({ where: { id: c.id } });
  res.json({ ok: true });
});

export default router;
