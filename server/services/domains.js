import dns from 'node:dns/promises';
import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { hostKey } from '../utils/domain.js';

// Host do próprio sistema (APP_URL): nunca é tratado como domínio de portfólio.
export const appHost = (() => {
  try { return hostKey(new URL(config.appUrl).host); } catch { return ''; }
})();
const SYSTEM_HOSTS = new Set([appHost, 'localhost', '127.0.0.1', '::1', '[::1]'].filter(Boolean));
export const isSystemHost = (host) => SYSTEM_HOSTS.has(host);

// ---------- Verificação do DNS ----------
// O domínio está certo se o registro A aponta para SERVER_IP (ou se é um CNAME para o endereço do sistema).
// Sem SERVER_IP configurado não há o que conferir: aceita (o administrador assume a responsabilidade).
export async function checkDomainDns(domain) {
  if (!config.serverIp) return { ok: true, checked: false };
  let ips = [];
  try { ips = await dns.resolve4(domain); } catch { /* sem registro A */ }
  if (ips.includes(config.serverIp)) return { ok: true, checked: true, ips };
  if (appHost) {
    try {
      const names = (await dns.resolveCname(domain)).map((n) => hostKey(n));
      if (names.includes(appHost)) return { ok: true, checked: true, ips };
    } catch { /* sem CNAME */ }
  }
  return { ok: false, checked: true, ips };
}

// ---------- Quem é o dono do domínio (cache curto: cada arquivo da página passa por aqui) ----------
const TTL_HIT = 30_000;
const TTL_MISS = 60_000;
const MAX_CACHE = 1000;
const cache = new Map(); // host -> { owner|null, at }

export const forgetDomain = (domain) => { cache.delete(domain); };

export async function domainOwner(host) {
  if (!host || isSystemHost(host)) return null;
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < (hit.owner ? TTL_HIT : TTL_MISS)) return hit.owner;
  const owner = await prisma.user.findFirst({
    where: { customDomain: host, customDomainVerifiedAt: { not: null }, portfolioSlug: { not: null } },
    select: { id: true, portfolioSlug: true },
  });
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(host, { owner, at: Date.now() });
  return owner;
}

// Em domínios próprios só as rotas públicas do portfólio ficam abertas (nada de login, painel ou webhooks).
const OPEN_API = new Set(['/api/public/portfolio', '/api/public/portfolio/image']);

export async function customDomainMiddleware(req, res, next) {
  try {
    const owner = await domainOwner(hostKey(req.headers.host));
    if (!owner) return next();
    req.customDomain = { host: hostKey(req.headers.host), slug: owner.portfolioSlug };
    if (req.path.startsWith('/api') && !OPEN_API.has(req.path)) return res.status(404).json({ error: 'Rota não encontrada.' });
    return next();
  } catch (e) {
    return next(e);
  }
}
