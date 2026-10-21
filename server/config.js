import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const env = process.env;
// Algumas plataformas entregam o valor com aspas literais; remove-as.
const stripQuotes = (s) => String(s || '').trim().replace(/^(['"])(.*)\1$/, '$2');
const trimSlash = (s) => String(s || '').trim().replace(/\/+$/, '');
const positive = (v, fallback) => {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

let jwtSecret = (env.JWT_SECRET || '').trim();
if (!jwtSecret || jwtSecret === 'troque-por-uma-frase-longa-e-aleatoria') {
  jwtSecret = crypto.randomBytes(48).toString('hex');
  console.warn('[config] JWT_SECRET não definido: usando uma chave temporária (os logins expiram a cada reinício).');
}

// Chave que protege (criptografa) os tokens da API oficial da Meta guardados no banco.
// Use ENCRYPTION_KEY fixa em produção; sem ela usa o JWT_SECRET.
const encryptionSeed = (env.ENCRYPTION_KEY || '').trim() || jwtSecret;

export const config = {
  port: positive(env.PORT, 3001),
  appUrl: trimSlash(env.APP_URL) || 'http://localhost:5173',
  serverIp: (env.SERVER_IP || '').trim(),
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true' ? 1 : 0,
  jwtSecret,
  secretKey: crypto.createHash('sha256').update(`dm-financeiro:${encryptionSeed}`).digest(),
  databaseUrl: stripQuotes(env.DATABASE_URL),
  timezone: (env.APP_TIMEZONE || 'America/Sao_Paulo').trim(),
  scheduler: {
    enabled: env.SCHEDULER_ENABLED !== 'false',
    intervalMs: Math.max(1, positive(env.SCHEDULER_INTERVAL_SECONDS, 30)) * 1000,
  },
  trialDays: positive(env.TRIAL_DAYS, 3),
  accessDays: positive(env.ACCESS_DAYS, 30),
  admin: {
    name: (env.ADMIN_NAME || 'Administrador').trim(),
    email: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: env.ADMIN_PASSWORD || '',
    document: (env.ADMIN_DOCUMENT || '').replace(/\D/g, ''),
  },
  evolution: {
    url: trimSlash(env.EVOLUTION_API_URL),
    apiKey: (env.EVOLUTION_API_KEY || '').trim(),
    integration: (env.EVOLUTION_INTEGRATION || 'WHATSAPP-BAILEYS').trim(),
    messageDelayMs: Math.min(positive(env.EVOLUTION_MESSAGE_DELAY_MS, 1200), 10000),
  },
  infinitepay: {
    handle: (env.INFINITEPAY_HANDLE || '').trim().replace(/^\$/, ''),
    apiUrl: trimSlash(env.INFINITEPAY_API_URL) || 'https://api.checkout.infinitepay.io',
  },
  // Auditoria: o servidor também busca as mensagens sozinho (além do webhook), para a tela nunca depender só dele.
  // AUDIT_SYNC_SECONDS=0 desliga. Com alguém olhando a tela a busca é a cada AUDIT_SYNC_SECONDS; sem ninguém, a cada AUDIT_SYNC_IDLE_SECONDS.
  auditSync: {
    intervalMs: Math.max(0, Number(env.AUDIT_SYNC_SECONDS ?? 15)) * 1000,
    idleMs: Math.max(1, Number(env.AUDIT_SYNC_IDLE_SECONDS ?? 300)) * 1000,
    mediaMaxBytes: Math.max(1, Number(env.AUDIT_MEDIA_MAX_MB ?? 20)) * 1024 * 1024,
  },
  // API oficial do WhatsApp (Meta Cloud API).
  meta: {
    graphUrl: trimSlash(env.META_GRAPH_URL) || 'https://graph.facebook.com',
    apiVersion: (env.META_API_VERSION || 'v21.0').trim(),
  },
  // Preço MENSAL de cada plano, em reais. Semestral (paga 5 de 6 meses) e anual (paga 9 de 12) saem daqui.
  prices: {
    bronze: positive(env.PLAN_BRONZE_PRICE, 34.9),
    prata: positive(env.PLAN_PRATA_PRICE, 54.9),
    ouro: positive(env.PLAN_OURO_PRICE, 64.9),
  },
  easypanel: {
    url: trimSlash(env.EASYPANEL_API_URL),
    apiKey: (env.EASYPANEL_API_KEY || '').trim(),
    projectName: (env.EASYPANEL_PROJECT_NAME || 'ferramentas').trim(),
    serviceName: (env.EASYPANEL_SERVICE_NAME || 'dmfinanceiro').trim(),
  },
};

export const evolutionConfigured = () => Boolean(config.evolution.url && config.evolution.apiKey);
export const infinitepayConfigured = () => Boolean(config.infinitepay.handle);
export const easypanelConfigured = () => Boolean(config.easypanel.url && config.easypanel.apiKey);