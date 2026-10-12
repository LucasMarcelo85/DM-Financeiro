import { Router } from 'express';
import { prisma } from '../prisma.js';
import { dueInMonth, localToday, zonedToUtc } from '../utils/schedule.js';

const router = Router();

router.get('/', async (req, res) => {
  const userId = req.user.id;
  const today = localToday();
  const y = today.getUTCFullYear();
  const m0 = today.getUTCMonth();
  const monthStart = zonedToUtc(new Date(Date.UTC(y, m0, 1)), '00:00');

  const [contacts, billings, upcoming, sentThisMonth] = await Promise.all([
    prisma.contact.count({ where: { userId } }),
    prisma.schedule.findMany({
      where: { userId, kind: 'cobranca' },
      select: { recurrence: true, status: true, amountCents: true, dueDate: true },
    }),
    prisma.schedule.findMany({
      where: { userId, status: 'ativa', nextRunAt: { not: null } },
      include: { contact: { select: { name: true } } },
      orderBy: { nextRunAt: 'asc' },
      take: 5,
    }),
    prisma.message.count({ where: { userId, status: { in: ['sent', 'partial'] }, createdAt: { gte: monthStart } } }),
  ]);

  let monthlyTotalCents = 0; // soma das cobranças mensais ativas (quanto entra por mês)
  let monthlyCount = 0;
  let expectedMonthCents = 0; // tudo que vence neste mês (mensais ativas + avulsas)
  for (const b of billings) {
    const amount = b.amountCents ?? 0;
    if (b.recurrence === 'mensal' && b.status === 'ativa') {
      monthlyTotalCents += amount;
      monthlyCount += 1;
    }
    const countsThisMonth = b.recurrence === 'mensal' ? b.status === 'ativa' : true;
    if (countsThisMonth && dueInMonth(b, y, m0)) expectedMonthCents += amount;
  }

  res.json({
    contacts,
    monthlyTotalCents,
    monthlyCount,
    expectedMonthCents,
    sentThisMonth,
    upcoming: upcoming.map((s) => ({
      id: s.id, kind: s.kind, recurrence: s.recurrence, contactName: s.contact.name,
      amountCents: s.amountCents, nextRunAt: s.nextRunAt.getTime(),
    })),
  });
});

export default router;
