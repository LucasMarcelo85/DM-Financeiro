import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();
const KINDS = ['cobranca', 'lembrete'];

// Histórico do que já foi enviado (manual ou automático).
router.get('/', async (req, res) => {
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : undefined;
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const rows = await prisma.message.findMany({
    where: { userId: req.user.id, ...(kind ? { kind } : {}) },
    orderBy: { id: 'desc' },
    take: limit,
  });
  res.json({
    messages: rows.map((m) => ({
      id: m.id, kind: m.kind, number: m.number, contactName: m.contactName, hasExtra: m.hasExtra,
      status: m.status, error: m.error, automatic: m.automatic, createdAt: m.createdAt.getTime(),
    })),
  });
});

export default router;
