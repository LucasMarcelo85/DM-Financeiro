import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT, evolutionConfigured, infinitepayConfigured } from './config.js';
import { prisma, connectWithRetry } from './prisma.js';
import { AppError, DAY } from './utils/helpers.js';
import { auth, requireAccess, requireAdmin } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import instanceRoutes from './routes/instances.js';
import contactRoutes from './routes/contacts.js';
import scheduleRoutes from './routes/schedules.js';
import statsRoutes from './routes/stats.js';
import messageRoutes from './routes/messages.js';
import adminRoutes from './routes/admin.js';
import { billingRouter, webhookRouter } from './routes/billing.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

try {
  new Intl.DateTimeFormat('en-US', { timeZone: config.timezone });
} catch {
  console.error(`APP_TIMEZONE inválido: "${config.timezone}". Exemplo: America/Sao_Paulo`);
  process.exit(1);
}

try {
  await connectWithRetry();
  console.log('[banco] conectado ao PostgreSQL');
} catch (e) {
  console.error('[banco] não foi possível conectar. Confira a DATABASE_URL e se as tabelas foram criadas (npm run db:deploy).\n', e.message);
  process.exit(1);
}

// Cria a conta admin na primeira execução (se ainda não existir).
async function seedAdmin() {
  const { email, password, name, document } = config.admin;
  if (!email || !password) {
    console.warn('[admin] ADMIN_EMAIL/ADMIN_PASSWORD não definidos: nenhuma conta admin foi criada.');
    return;
  }
  if (await prisma.user.findUnique({ where: { email } })) return;
  const doc = document || 'admin';
  if (await prisma.user.findUnique({ where: { document: doc } })) {
    console.warn('[admin] ADMIN_DOCUMENT já pertence a outra conta. Admin não criado.');
    return;
  }
  await prisma.user.create({
    data: {
      kind: document.length === 14 ? 'PJ' : 'PF', name, document: doc, email,
      passwordHash: bcrypt.hashSync(password, 10), role: 'admin', plan: 'ouro', trialEndsAt: new Date(Date.now() + DAY),
    },
  });
  console.log(`[admin] Conta admin criada: ${email}`);
}
try {
  await seedAdmin();
} catch (e) {
  console.error('[banco] falha ao preparar o banco. As tabelas existem? Rode: npm run db:deploy\n', e.message);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const limiter = (limit, windowMs) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde um pouco e tente de novo.' } });
app.use('/api', limiter(600, 60 * 1000));
app.use('/api/auth/login', limiter(20, 15 * 60 * 1000));
app.use('/api/auth/register', limiter(10, 60 * 60 * 1000));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'banco indisponível' });
  }
});
app.use('/api', authRoutes); // /plans e /auth/*
app.use('/api/webhooks', webhookRouter);
app.use('/api/billing', auth, billingRouter);
app.use('/api/instances', auth, requireAccess, instanceRoutes);
app.use('/api/contacts', auth, requireAccess, contactRoutes);
app.use('/api/schedules', auth, requireAccess, scheduleRoutes);
app.use('/api/stats', auth, requireAccess, statsRoutes);
app.use('/api/messages', auth, requireAccess, messageRoutes);
app.use('/api/admin', auth, requireAdmin, adminRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// Em produção (após `npm run build`) o próprio servidor entrega o front.
const dist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requisição inválida.' });
  console.error('[erro]', err);
  res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
});

const server = app.listen(config.port, () => {
  console.log(`API rodando em http://localhost:${config.port}`);
  if (!evolutionConfigured()) console.warn('[aviso] Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY).');
  if (!infinitepayConfigured()) console.warn('[aviso] InfinitePay não configurada (INFINITEPAY_HANDLE).');
  startScheduler();
});

async function shutdown() {
  stopScheduler();
  server.close();
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
