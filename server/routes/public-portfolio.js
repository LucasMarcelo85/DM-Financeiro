import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { planShowsCredit } from '../plans.js';
import { resolvePublicOwner } from '../utils/store.js';
import { decodeImage, portfolioCover, portfolioDescription } from '../utils/portfolio.js';
import { isReservedSlug, isValidSlug } from '../utils/slug.js';
import { publicCatalogConfig, publicProduct } from '../utils/catalog.js';
import { loadCatalogOwner } from '../services/orders.js';
import { hostKey } from '../utils/domain.js';

// Página pública do portfólio (sem login): dominio/<usuário> e dominio/<usuário>/<página>.
// Só aparece se a página estiver publicada e o dono ainda tiver acesso ao sistema (teste grátis ou plano pago).
const router = Router();

export async function findPublicPage(userSlug, pageSlug) {
  const u = String(userSlug || '').toLowerCase();
  const p = pageSlug ? String(pageSlug).toLowerCase() : '';
  if (!isValidSlug(u) || isReservedSlug(u) || (p && !isValidSlug(p))) return null;
  const resolved = await resolvePublicOwner(u, { id: true, name: true, portfolioSlug: true, plan: true, role: true });
  if (!resolved) return null;
  const { store } = resolved;
  const owner = store ? { ...resolved.owner, name: store.name, portfolioSlug: store.slug } : resolved.owner;
  const scope = { userId: owner.id, storeId: store?.id ?? null, published: true };
  const page = await prisma.portfolio.findFirst({ where: p ? { ...scope, slug: p } : { ...scope, isMain: true } });
  if (page) owner.storeId = store?.id ?? null;
  return page ? { owner, page } : null;
}

router.get('/portfolio', async (req, res) => {
  const found = await findPublicPage(req.query.u, req.query.p);
  if (!found) throw new AppError(404, 'Página não encontrada.');
  const { owner, page } = found;
  const doc = page.data || {};
  const out = {};
  const imgs = { select: { id: true, position: true, isPrimary: true, label: true, priceCents: true, color: true, size: true, colorHex: true, stockQuantity: true } };
  const priceOptions = { select: { id: true, position: true, label: true, priceCents: true, minQuantity: true, scope: true, minCartCents: true } };
  if (doc.v === 2 && page.kind === 'catalog') {
    // Catálogo digital: todos os produtos ativos + as formas de entrega (sem token e sem endereço de saída). Sem plano com catálogo = 404.
    const ctx = await loadCatalogOwner(owner.portfolioSlug);
    const products = await prisma.product.findMany({ where: { userId: owner.id, storeId: owner.storeId ?? null, active: true }, include: { images: imgs, priceOptions }, orderBy: [{ category: 'asc' }, { name: 'asc' }], take: 500 });
    out.products = products.map(publicProduct);
    out.store = publicCatalogConfig(ctx.cfg);
  } else if (doc.v === 2) {
    // Página livre com cartões de produtos escolhidos.
    const ids = [...new Set((doc.elements || []).filter((e) => e.t === 'products').flatMap((e) => e.ids || []))].slice(0, 60);
    if (ids.length) out.products = (await prisma.product.findMany({ where: { id: { in: ids }, userId: owner.id, storeId: owner.storeId ?? null, active: true }, include: { images: imgs, priceOptions } })).map(publicProduct);
  }
  res.set('Cache-Control', 'no-cache'); // o navegador confere (ETag) antes de reusar: edições aparecem logo
  res.json({
    owner: { name: owner.name, slug: owner.portfolioSlug },
    credit: owner.role === 'admin' ? true : planShowsCredit(owner.plan),
    page: { name: page.name, slug: page.slug, isMain: page.isMain, kind: page.kind, updatedAt: page.updatedAt.getTime(), data: page.data },
    ...out,
  });
});

// Miniatura do link: o WhatsApp e as redes sociais precisam de uma imagem por endereço (não aceitam data URL).
router.get('/portfolio/image', async (req, res) => {
  const found = await findPublicPage(req.query.u, req.query.p);
  const img = found ? decodeImage(portfolioCover(found.page.data)) : null;
  if (!img) throw new AppError(404, 'Sem imagem.');
  res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=300', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.send(img.buffer);
});

router.get('/domain-check', async (req, res) => {
  const domain = hostKey(req.query.domain);
  const row = domain ? await prisma.user.findFirst({
    where: { customDomain: domain, customDomainVerifiedAt: { not: null } },
    select: { id: true },
  }) : null;
  res.status(row ? 200 : 404).end();
});

// ---------- Pré-visualização do link (meta tags Open Graph) ----------
// Quem recebe o link no WhatsApp não executa JavaScript: o título, a descrição e a imagem precisam vir no HTML.
const PATH_RE = /^\/([a-z0-9-]{1,60})(?:\/([a-z0-9-]{1,60}))?\/?$/;
const CUSTOM_PATH_RE = /^\/(?:([a-z0-9-]{1,60}))?\/?$/;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Se o endereço pedido é de uma página publicada, devolve os dados da pré-visualização; senão, null.
export async function portfolioShareMeta(req) {
  let userSlug;
  let pageSlug;
  if (req.customDomain) {
    const match = CUSTOM_PATH_RE.exec(req.path);
    if (!match) return null;
    userSlug = req.customDomain.slug;
    pageSlug = match[1];
  } else {
    const match = PATH_RE.exec(req.path);
    if (!match || isReservedSlug(match[1])) return null;
    userSlug = match[1];
    pageSlug = match[2];
  }
  const found = await findPublicPage(userSlug, pageSlug);
  if (!found) return null;
  const { owner, page } = found;
  const origin = `${req.protocol}://${req.get('host')}`;
  const doc = page.data || {};
  const q = `u=${encodeURIComponent(owner.portfolioSlug)}${pageSlug ? `&p=${encodeURIComponent(pageSlug)}` : ''}`;
  return {
    title: doc.seo?.title || page.name || owner.name,
    description: portfolioDescription(doc),
    image: portfolioCover(doc) ? `${origin}/api/public/portfolio/image?${q}` : '',
    url: `${origin}${req.path}`,
    siteName: owner.name,
    pixel: Boolean(doc.pixel && (doc.pixel.meta || doc.pixel.google || doc.pixel.tiktok)),
  };
}

export function injectMeta(html, meta, pfUser = '') {
  const tags = meta ? [
    `<meta name="description" content="${esc(meta.description)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${esc(meta.siteName)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    meta.image ? `<meta property="og:image" content="${esc(meta.image)}" />` : '',
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" />`,
  ].filter(Boolean) : [];
  if (pfUser) tags.push(`<meta name="pf-user" content="${esc(pfUser)}" />`);
  // Funções no replace: o título pode ter "$&" ou "$1" e não pode ser interpretado como padrão.
  return html
    .replace(/<title>[^<]*<\/title>/, () => meta ? `<title>${esc(meta.title)}</title>` : '<title>Portfólio</title>')
    .replace('</head>', () => `    ${tags.join('\n    ')}\n  </head>`);
}

export default router;
