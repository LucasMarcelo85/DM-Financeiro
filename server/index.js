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
import { auth, pinGuard, requireAccess, requireAdmin } from './middleware/auth.js';
import { ensurePlans, topPlanId } from './plans.js';
import { loadAddons } from './addons.js';
import authRoutes from './routes/auth.js';
import instanceRoutes, { instanceRouter } from './routes/instances.js';
import auditRoutes from './routes/audit.js';
import auditWebhookRoutes from './routes/audit-webhooks.js';
import contactRoutes from './routes/contacts.js';
import scheduleRoutes from './routes/schedules.js';
import statsRoutes from './routes/stats.js';
import receiptRoutes from './routes/receipts.js';
import messageRoutes from './routes/messages.js';
import contractRoutes from './routes/contracts.js';
import portfolioRoutes from './routes/portfolios.js';
import storeRoutes from './routes/stores.js';
import shopAppRoutes from './routes/shop-app.js';
import { publicApi, tokenRoutes } from './routes/api-tokens.js';
import publicPortfolioRoutes, { injectMeta, portfolioShareMeta } from './routes/public-portfolio.js';
import productRoutes from './routes/products.js';
import catalogRoutes from './routes/catalog.js';
import publicCatalogRoutes, { ordersWebhook } from './routes/public-catalog.js';
import { catalogPaymentWebhooks, catalogPaymentsRouter } from './routes/catalog-payments.js';
import adminRoutes from './routes/admin.js';
import { billingRouter, webhookRouter } from './routes/billing.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { startAuditSync, stopAuditSync } from './services/audit-sync.js';
import { startMaintenance, stopMaintenance } from './services/maintenance.js';
import { startApiWebhookWorker, stopApiWebhookWorker } from './services/api-webhooks.js';
import { customDomainMiddleware } from './services/domains.js';

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
      passwordHash: bcrypt.hashSync(password, 10), role: 'admin', plan: topPlanId(), trialEndsAt: new Date(Date.now() + DAY),
    },
  });
  console.log(`[admin] Conta admin criada: ${email}`);
}
try {
  await ensurePlans(); // valores e limites dos planos vêm do banco (o .env só define os iniciais)
  await loadAddons();
  await seedAdmin();
} catch (e) {
  console.error('[banco] falha ao preparar o banco. As tabelas existem? Rode: npm run db:deploy\n', e.message);
  process.exit(1);
}

// CSP das páginas públicas que usam pixel de rastreamento (tráfego pago). As demais telas continuam com a CSP restrita.
const PIXEL_CSP = [
  "default-src 'self'",
  "script-src 'self' https://connect.facebook.net https://www.googletagmanager.com https://analytics.tiktok.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://www.facebook.com https://*.facebook.com https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://*.google.com https://*.doubleclick.net https://analytics.tiktok.com",
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
  "media-src 'self' https:",
  "connect-src 'self' https://www.facebook.com https://*.facebook.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://*.doubleclick.net https://analytics.tiktok.com https://*.tiktok.com",
  "frame-ancestors 'none'",
].join('; ');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(customDomainMiddleware);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:'],
        // Vídeos do portfólio: YouTube/Vimeo (embutidos) ou arquivo direto por https.
        'frame-src': ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
        'media-src': ["'self'", 'https:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
  })
);
// Webhook da Meta: guarda o corpo "cru" para conferir a assinatura (X-Hub-Signature-256).
const jsonSmall = express.json({ limit: '100kb', verify: (req, _res, buf) => { if (req.path === '/api/webhooks/meta') req.rawBody = buf; } });
// Caminhos com limite de corpo maior ou próprio: contratos e portfólio (têm imagens) e webhook da Evolution (lotes de contatos).
const hasOwnParser = (p) => p === '/api/contracts' || p.startsWith('/api/contracts/') || p === '/api/portfolios' || p.startsWith('/api/portfolios/') || p === '/api/products' || p.startsWith('/api/products/') || p === '/api/contacts/import' || p === '/api/catalog/orders/import' || p === '/api/catalog/customers/import' || p.startsWith('/api/shop-app/') || p.startsWith('/api/webhooks/evolution/');
app.use((req, res, next) => (hasOwnParser(req.path) ? next() : jsonSmall(req, res, next)));
app.use(cookieParser());
app.use('/api/contacts/import', express.json({ limit: '5mb' }));
app.use('/api/catalog/orders/import', express.json({ limit: '15mb' }));
app.use('/api/catalog/customers/import', express.json({ limit: '5mb' }));

const limiter = (limit, windowMs) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde um pouco e tente de novo.' } });
app.use('/api', limiter(config.rateLimitPerMinute, 60 * 1000));
app.use('/api/auth/login', limiter(20, 15 * 60 * 1000));
app.use('/api/auth/register', limiter(10, 60 * 60 * 1000));
app.use('/api/auth/forgot', limiter(8, 15 * 60 * 1000)); // pedir código de recuperação
app.use('/api/auth/reset', limiter(15, 15 * 60 * 1000)); // digitar o código e a nova senha
app.use('/api/auth/pin', limiter(60, 15 * 60 * 1000)); // PIN: verificar, criar, esqueci
app.use('/api/auth/profile', limiter(20, 15 * 60 * 1000)); // trocar e-mail/senha pede a senha atual

// Pedidos do catálogo (público): até 60 tentativas e 12 pedidos concluídos por IP a cada 15 minutos (tentativas com erro de preenchimento não gastam os 12).
app.use('/api/webhooks/orders', limiter(60, 15 * 60 * 1000));
app.use('/api/webhooks/orders', rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, skipFailedRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitos pedidos em pouco tempo. Aguarde um pouco e tente de novo.' } }));
app.use('/api/public/catalog/shipping', limiter(40, 10 * 60 * 1000)); // simulação de frete (chama serviços externos)
app.use('/api/public/catalog/payment-status', limiter(60, 10 * 60 * 1000)); // confirmações consultam APIs dos provedores
app.use('/api/public/cep', limiter(60, 10 * 60 * 1000));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'banco indisponível' });
  }
});
app.use('/api', authRoutes); // /plans e /auth/*
app.use('/api/webhooks/orders', ordersWebhook); // pedidos do catálogo: sem login
app.use('/api/webhooks/catalog-payments', catalogPaymentWebhooks);
app.use('/api/webhooks', webhookRouter);
app.use('/api/webhooks', auditWebhookRoutes);
app.use('/api/billing', auth, billingRouter);
app.use('/api/instances', auth, requireAccess, instanceRoutes);
app.use('/api/audit/instances', auth, requireAccess, pinGuard('auditoria'), instanceRouter('auditoria'));
app.use('/api/audit', auth, requireAccess, pinGuard('auditoria'), auditRoutes);
app.use('/api/contacts', auth, requireAccess, express.json({ limit: '5mb' }), contactRoutes);
app.use('/api/schedules', auth, requireAccess, scheduleRoutes);
app.use('/api/stats', auth, requireAccess, statsRoutes);
app.use('/api/receipts', auth, requireAccess, receiptRoutes);
app.use('/api/messages', auth, requireAccess, messageRoutes);
app.use('/api/contracts', auth, requireAccess, pinGuard('contratos'), express.json({ limit: '12mb' }), contractRoutes);
app.use('/api/portfolios', auth, requireAccess, pinGuard('portfolio'), express.json({ limit: '12mb' }), portfolioRoutes);
app.use('/api/stores', auth, requireAccess, pinGuard('portfolio'), storeRoutes);
app.use('/api/tokens', auth, requireAccess, pinGuard('api'), tokenRoutes);
app.use('/api/shop-app/login', limiter(30, 15 * 60 * 1000));
app.use('/api/shop-app', express.json({ limit: '40mb' }), shopAppRoutes);
app.use('/api/v1', limiter(300, 60 * 1000), publicApi);
app.use('/api/public', publicPortfolioRoutes); // páginas públicas: sem login
app.use('/api/public', publicCatalogRoutes);
app.use('/api/products', auth, requireAccess, express.json({ limit: '40mb' }), productRoutes);
app.use('/api/catalog', auth, requireAccess, pinGuard('pedidos'), catalogRoutes);
app.use('/api/catalog/payments', auth, requireAccess, pinGuard('pedidos'), catalogPaymentsRouter);
app.use('/api/admin', auth, requireAdmin, adminRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// Em produção (após `npm run build`) o próprio servidor entrega o front.
const dist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  const shell = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  app.use(async (req, res, next) => {
    if (!req.customDomain || req.method !== 'GET' || req.path.startsWith('/api') || req.path === '/app' || path.extname(req.path)) return next();
    try {
      const meta = await portfolioShareMeta(req);
      if (meta?.pixel) res.set('Content-Security-Policy', PIXEL_CSP);
      return res.status(meta ? 200 : 404).type('html').send(injectMeta(shell, meta, req.customDomain.slug));
    } catch (e) {
      console.error('[portfolio] domínio próprio:', e.message);
      return next(e);
    }
  });
  app.use(express.static(dist));
  app.use(async (req, res) => {
    // Endereço de uma página do portfólio: entrega o HTML já com título, descrição e imagem do link (WhatsApp, redes sociais).
    if (req.method === 'GET') {
      try {
        const meta = await portfolioShareMeta(req);
        if (meta) {
          // Só quando a página tem pixel (Meta, Google, TikTok): libera os endereços oficiais deles nesta página pública.
          if (meta.pixel) res.set('Content-Security-Policy', PIXEL_CSP);
          return res.type('html').send(injectMeta(shell, meta));
        }
      } catch (e) {
        console.error('[portfolio] pré-visualização do link:', e.message);
      }
    }
    return res.sendFile(path.join(dist, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requisição inválida.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'O conteúdo enviado é grande demais. Use imagens menores.' });
  console.error('[erro]', err);
  res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
});

const server = app.listen(config.port, () => {
  console.log(`API rodando em http://localhost:${config.port}`);
  if (!evolutionConfigured()) console.warn('[aviso] Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY).');
  if (!infinitepayConfigured()) console.warn('[aviso] InfinitePay não configurada (INFINITEPAY_HANDLE).');
  startScheduler();
  startAuditSync();
  startMaintenance();
  startApiWebhookWorker();
});

async function shutdown() {
  stopScheduler();
  stopAuditSync();
  stopMaintenance();
  stopApiWebhookWorker();
  server.close();
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
