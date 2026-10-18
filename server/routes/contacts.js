import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError, isValidCNPJ, isValidCPF, normalizePhone, onlyDigits } from '../utils/helpers.js';
import { contactDTO } from '../utils/serialize.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const withCount = { _count: { select: { schedules: true } } };

// Dados extras (usados como variáveis nos contratos). Só entram quando vêm na requisição,
// assim quem salva só nome/telefone não apaga o endereço que já estava cadastrado.
const TEXT_FIELDS = { street: 120, number: 20, complement: 80, district: 80, city: 80 };

function parseExtras(b) {
  const out = {};
  if (b.document !== undefined) {
    const d = onlyDigits(b.document);
    if (d && !(d.length === 11 ? isValidCPF(d) : d.length === 14 ? isValidCNPJ(d) : false)) throw new AppError(400, 'CPF/CNPJ do cliente inválido.');
    out.document = d || null;
  }
  if (b.zip !== undefined) {
    const z = onlyDigits(b.zip);
    if (z && z.length !== 8) throw new AppError(400, 'CEP inválido. Use os 8 números.');
    out.zip = z || null;
  }
  if (b.state !== undefined) {
    const st = String(b.state || '').trim().toUpperCase();
    if (st && !/^[A-Z]{2}$/.test(st)) throw new AppError(400, 'Estado inválido. Use a sigla com 2 letras, como CE.');
    out.state = st || null;
  }
  for (const [k, max] of Object.entries(TEXT_FIELDS)) {
    if (b[k] === undefined) continue;
    const v = String(b[k] || '').replace(/\s+/g, ' ').trim();
    if (v.length > max) throw new AppError(400, `O campo "${k}" do endereço é longo demais (máximo de ${max} caracteres).`);
    out[k] = v || null;
  }
  return out;
}

function parseBody(b = {}) {
  const name = String(b.name || '').trim();
  const phone = normalizePhone(b.phone);
  const email = String(b.email || '').trim().toLowerCase() || null;
  const notes = String(b.notes || '').trim() || null;
  if (name.length < 2 || name.length > 120) throw new AppError(400, 'Informe o nome do cliente.');
  if (!phone) throw new AppError(400, 'Número inválido. Use DDD + número, por exemplo (85) 99999-9999.');
  if (email && !EMAIL_RE.test(email)) throw new AppError(400, 'E-mail inválido.');
  if (notes && notes.length > 500) throw new AppError(400, 'A observação é longa demais (máximo de 500 caracteres).');
  return { name, phone, email, notes, ...parseExtras(b) };
}

async function owned(req) {
  const id = Number(req.params.id);
  const c = Number.isInteger(id) ? await prisma.contact.findFirst({ where: { id, userId: req.user.id }, include: withCount }) : null;
  if (!c) throw new AppError(404, 'Cliente não encontrado.');
  return c;
}

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const where = { userId: req.user.id };
  if (q) {
    const digits = onlyDigits(q);
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.contact.findMany({ where, orderBy: { name: 'asc' }, take: limit, include: withCount }),
    prisma.contact.count({ where: { userId: req.user.id } }),
  ]);
  res.json({ contacts: rows.map(contactDTO), total });
});

router.get('/:id', async (req, res) => {
  res.json({ contact: contactDTO(await owned(req)) });
});

router.post('/', async (req, res) => {
  const data = parseBody(req.body);
  const dup = await prisma.contact.findUnique({ where: { userId_phone: { userId: req.user.id, phone: data.phone } } });
  if (dup) throw new AppError(409, `Este número já está salvo para o cliente "${dup.name}".`);
  const c = await prisma.contact.create({ data: { ...data, userId: req.user.id }, include: withCount });
  res.status(201).json({ contact: contactDTO(c) });
});

router.patch('/:id', async (req, res) => {
  const current = await owned(req);
  const data = parseBody(req.body);
  const dup = await prisma.contact.findFirst({ where: { userId: req.user.id, phone: data.phone, NOT: { id: current.id } } });
  if (dup) throw new AppError(409, `Este número já está salvo para o cliente "${dup.name}".`);
  const c = await prisma.contact.update({ where: { id: current.id }, data, include: withCount });
  res.json({ contact: contactDTO(c) });
});

router.delete('/:id', async (req, res) => {
  const c = await owned(req);
  await prisma.contact.delete({ where: { id: c.id } }); // apaga também as cobranças/lembretes deste cliente
  res.json({ ok: true, removedSchedules: c._count.schedules });
});

export default router;
