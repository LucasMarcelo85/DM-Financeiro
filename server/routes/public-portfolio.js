import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { accessibleUserFilter } from '../services/access.js';
import { decodeImage, portfolioCover, portfolioDescription } from '../utils/portfolio.js';
import { isReservedSlug, isValidSlug } from '../utils/slug.js';
import { hostKey } from '../utils/domain.js';

// Página pública do portfólio (sem login): dominio/<usuário> e dominio/<usuário>/<página>.
// Só aparece se a página estiver publicada e o dono ainda tiver acesso ao sistema (teste grátis ou plano pago).
const router = Router();

export async function findPublicPage(userSlug, pageSlug) {
  const u = String(userSlug || '').toLowerCase();
  const p = pageSlug ? String(pageSlug).toLowerCase() : '';
  if (!isValidSlug(u) || isReservedSlug(u) || (p && !isValidSlug(p))) return null;
  const owner = await prisma.user.findFirst({
    where: { portfolioSlug: u, ...accessibleUserFilter() },
    select: { id: true, name: true, portfolioSlug: true },
  });
  if (!owner) return null;
  const page = await prisma.portfolio.findFirst({
    where: p ? { userId: owner.id, slug: p, published: true } : { userId: owner.id, isMain: true, published: true },
  });
  return page ? { owner, page } : null;
}

router.get('/portfolio', async (req, res) => {
  const found = await findPublicPage(req.query.u, req.query.p);
  if (!found) throw new AppError(404, 'Página não encontrada.');
  const { owner, page } = found;
  res.set('Cache-Control', 'no-cache'); // o navegador confere (ETag) antes de reusar: edições aparecem logo
  res.json({
    owner: { name: owner.name, slug: owner.portfolioSlug },
    page: { name: page.name, slug: page.slug, isMain: page.isMain, updatedAt: page.updatedAt.getTime(), data: page.data },
  });
});

// Autorização de certificado sob demanda (Caddy "on_demand_tls { ask ... }"): 200 só para domínio verificado de algum usuário.
router.get('/domain-check', async (req, res) => {
  const domain = hostKey(req.query.domain);
  const row = domain ? await prisma.user.findFirst({ where: { customDomain: domain, customDomainVerifiedAt: { not: null } }, select: { id: true } }) : null;
  res.status(row ? 200 : 404).end();
});

// Miniatura do link: o WhatsApp e as redes sociais precisam de uma imagem por endereço (não aceitam data URL).
router.get('/portfolio/image', async (req, res) => {
  const found = await findPublicPage(req.query.u, req.query.p);
  const img = found ? decodeImage(portfolioCover(found.page.data)) : null;
  if (!img) throw new AppError(404, 'Sem imagem.');
  res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=300', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.send(img.buffer);
});

// ---------- Pré-visualização do link (meta tags Open Graph) ----------
// Quem recebe o link no WhatsApp não executa JavaScript: o título, a descrição e a imagem precisam vir no HTML.
const PATH_RE = /^\/([a-z0-9-]{1,60})(?:\/([a-z0-9-]{1,60}))?\/?$/;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Se o endereço pedido é de uma página publicada, devolve os dados da pré-visualização; senão, null.
// Em domínio próprio o endereço não leva o nome do usuário: "/" = página principal e "/<página>" = as demais.
const CUSTOM_PATH_RE = /^\/(?:([a-z0-9-]{1,60}))?\/?$/;

export async function portfolioShareMeta(req) {
  let userSlug;
  let pageSlug;
  if (req.customDomain) {
    const c = CUSTOM_PATH_RE.exec(req.path);
    if (!c) return null;
    [userSlug, pageSlug] = [req.customDomain.slug, c[1]];
  } else {
    const m = PATH_RE.exec(req.path);
    if (!m || isReservedSlug(m[1])) return null;
    [userSlug, pageSlug] = [m[1], m[2]];
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
  };
}

// `pfUser`: em domínio próprio, avisa o front de qual usuário é o site (o endereço não tem o nome dele).
export function injectMeta(html, meta, pfUser = '') {
  const tags = !meta ? [] : [
    `<meta name="description" content="${esc(meta.description)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${esc(meta.siteName)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    meta.image ? `<meta property="og:image" content="${esc(meta.image)}" />` : '',
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" />`,
  ];
  if (pfUser) tags.push(`<meta name="pf-user" content="${esc(pfUser)}" />`);
  const joined = tags.filter(Boolean).join('\n    ');
  // Funções no replace: o título pode ter "$&" ou "$1" e não pode ser interpretado como padrão.
  const withTitle = meta ? html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(meta.title)}</title>`) : html;
  return withTitle.replace('</head>', () => `    ${joined}\n  </head>`);
}

export default router;
