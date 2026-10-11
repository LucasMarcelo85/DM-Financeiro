import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const env = process.env;
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

export const config = {
  port: positive(env.PORT, 3001),
  appUrl: trimSlash(env.APP_URL) || 'http://localhost:5173',
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true' ? 1 : 0,
  jwtSecret,
  dbPath: path.resolve(ROOT, env.DB_PATH || './data/dm-financeiro.db'),
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
  prices: {
    bronze: positive(env.PLAN_BRONZE_PRICE, 29.9),
    prata: positive(env.PLAN_PRATA_PRICE, 49.9),
    ouro: positive(env.PLAN_OURO_PRICE, 79.9),
  },
};

export const evolutionConfigured = () => Boolean(config.evolution.url && config.evolution.apiKey);
export const infinitepayConfigured = () => Boolean(config.infinitepay.handle);
