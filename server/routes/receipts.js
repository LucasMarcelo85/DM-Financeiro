import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { addDays, localToday, parseISODate, toISODate } from '../utils/schedule.js';
import { rateClient } from '../utils/rating.js';
import { billingPaymentDTO } from '../utils/serialize.js';

// Recebimentos: cobranças que o usuário marcou como pagas. Faturamento e avaliação dos clientes.
const router = Router();
const PERIODS = [30, 60, 90];
const MAX_SPAN_DAYS = 3660;
const LIST_LIMIT = 100;

// Período pedido: ?days=30|60|90 (últimos N dias, contando hoje) ou ?from=AAAA-MM-DD&to=AAAA-MM-DD.
function resolveRange(query, today) {
  if (query.from || query.to) {
    const from = parseISODate(query.from);
    const to = parseISODate(query.to);
    if (!from || !to) throw new AppError(400, 'Informe a data inicial e a final do período.');
    if (from > to) throw new AppError(400, 'A data inicial não pode ser depois da final.');
    if ((to - from) / 86400000 > MAX_SPAN_DAYS) throw new AppError(400, 'O período escolhido é muito longo.');
    return { from, to, days: null };
  }
  const days = PERIODS.includes(Number(query.days)) ? Number(query.days) : 30;
  return { from: addDays(today, -(days - 1)), to: today, days };
}

const periodWhere = (userId, from, to) => ({ userId, paidAt: { gte: from, lte: to } });

async function totals(userId, from, to) {
  const r = await prisma.billingPayment.aggregate({ where: periodWhere(userId, from, to), _sum: { amountCents: true }, _count: { _all: true } });
  return { totalCents: r._sum.amountCents ?? 0, count: r._count._all };
}

// Faturamento do período + os totais de 30/60/90 dias + a lista de recebimentos.
router.get('/summary', async (req, res) => {
  const userId = req.user.id;
  const today = localToday();
  const range = resolveRange(req.query, today);

  const [selected, byDay, items, ...periods] = await Promise.all([
    totals(userId, range.from, range.to),
    prisma.billingPayment.groupBy({
      by: ['paidAt'], where: periodWhere(userId, range.from, range.to),
      _sum: { amountCents: true }, _count: { _all: true }, orderBy: { paidAt: 'asc' },
    }),
    prisma.billingPayment.findMany({
      where: periodWhere(userId, range.from, range.to),
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT,
    }),
    ...PERIODS.map((d) => totals(userId, addDays(today, -(d - 1)), today)),
  ]);

  res.json({
    range: { from: toISODate(range.from), to: toISODate(range.to), days: range.days },
    totalCents: selected.totalCents,
    count: selected.count,
    averageCents: selected.count ? Math.round(selected.totalCents / selected.count) : 0,
    series: byDay.map((d) => ({ date: toISODate(d.paidAt), cents: d._sum.amountCents ?? 0, count: d._count._all })),
    periods: Object.fromEntries(PERIODS.map((d, i) => [d, periods[i]])),
    items: items.map(billingPaymentDTO),
    hasMore: selected.count > items.length,
  });
});

// Como cada cliente costuma pagar: estrelas, dia habitual e atraso médio. Os que mais atrasam vêm primeiro.
router.get('/clients', async (req, res) => {
  const userId = req.user.id;
  const rows = await prisma.billingPayment.findMany({
    where: { userId, contactId: { not: null } },
    orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    select: { contactId: true, dueDate: true, paidAt: true, amountCents: true },
    take: 50000,
  });

  const byContact = new Map();
  for (const r of rows) {
    if (!byContact.has(r.contactId)) byContact.set(r.contactId, []);
    byContact.get(r.contactId).push(r);
  }
  const contacts = await prisma.contact.findMany({ where: { userId, id: { in: [...byContact.keys()] } }, select: { id: true, name: true, phone: true } });

  const clients = contacts.map((c) => {
    const rating = rateClient(byContact.get(c.id));
    return {
      contactId: c.id, name: c.name, phone: c.phone,
      count: rating.count, stars: rating.stars, avgLateDays: rating.avgLateDays, maxLateDays: rating.maxLateDays,
      onTimeCount: rating.onTimeCount, usualDay: rating.usualDay, totalCents: rating.totalCents, lastPaidAt: toISODate(rating.lastPaidAt),
    };
  });
  clients.sort((a, b) => a.stars - b.stars || b.avgLateDays - a.avgLateDays || a.name.localeCompare(b.name, 'pt-BR'));
  res.json({ clients });
});

// Desfaz a marcação de pago.
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const removed = Number.isInteger(id) ? await prisma.billingPayment.deleteMany({ where: { id, userId: req.user.id } }) : { count: 0 };
  if (removed.count !== 1) throw new AppError(404, 'Pagamento não encontrado.');
  res.json({ ok: true });
});

export default router;
