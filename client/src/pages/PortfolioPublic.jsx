import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import PortfolioCanvas, { ClipDefs, PageBackground, PageCredit, pvVars, usePageScale } from '../components/portfolio/Canvas.jsx';
import { CartPage, CatalogHome, priced, useCart, useCartView } from '../components/portfolio/Catalog.jsx';
import { normalizeDoc } from '../lib/portfolio/doc.js';
import { initPixels, track } from '../lib/portfolio/pixel.js';

// Página pública do portfólio (sem login): dominio/<usuário> e dominio/<usuário>/<página>.
export default function PortfolioPublic({ fixedUser = '' }) {
  const { userSlug: routeUserSlug, pageSlug } = useParams();
  const userSlug = fixedUser || routeUserSlug;
  const [state, setState] = useState({ loading: true, page: null, owner: null, products: [], store: null });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, page: null, owner: null, products: [], store: null });
    const qs = `u=${encodeURIComponent(userSlug)}${pageSlug ? `&p=${encodeURIComponent(pageSlug)}` : ''}`;
    api.get(`/public/portfolio?${qs}`)
      .then((r) => alive && setState({ loading: false, owner: r.owner, products: r.products || [], store: r.store || null, page: { ...r.page, doc: normalizeDoc(r.page.data, r.page.kind) } }))
      .catch(() => alive && setState({ loading: false, page: null, owner: null, products: [], store: null }));
    return () => { alive = false; };
  }, [userSlug, pageSlug]);

  const { page, owner } = state;

  // Título da aba do navegador (quem recebe o link já vê o título certo pelo HTML que o servidor entrega).
  useEffect(() => {
    if (!page) return undefined;
    const before = document.title;
    document.title = page.doc.seo.title || page.name || owner?.name || before;
    return () => { document.title = before; };
  }, [page, owner]);

  // Pixels de rastreamento (Meta, Google, TikTok): só carregam quando o dono informou os códigos.
  useEffect(() => { if (page) initPixels(page.doc.pixel); }, [page]);

  if (state.loading) return <div className="splash"><span className="lamp lamp-lg is-pending" /></div>;

  if (!page) {
    return (
      <div className="pf-missing">
        <h1>Página não encontrada</h1>
        <p className="muted">Este endereço não existe ou a página ainda não foi publicada.</p>
        <Link to="/" className="btn btn-primary">Ir para o início</Link>
        <p className="pv-credit-plain"><span>Desenvolvido por <a href="https://www.agenciadmdigital.com.br/" target="_blank" rel="noopener">Solução DM</a></span> · <a href="https://agenciadmdigital.com.br" target="_blank" rel="noopener">agenciadmdigital.com.br</a></p>
      </div>
    );
  }
  return <PublicPage page={page} owner={owner} products={state.products} store={state.store} slug={owner.slug} />;
}

function PublicPage({ page, products, store, slug }) {
  const { doc } = page;
  const { device, scale } = usePageScale();
  const isCatalog = doc.kind === 'catalog' && Boolean(store);
  const cart = useCart(slug);
  const [cartOpen, goCart] = useCartView(doc.catalog.cartLink);
  const { count: cartCount } = priced(cart.items, products);
  const pixelOn = Boolean(doc.pixel.meta || doc.pixel.google || doc.pixel.tiktok);
  const onLink = useCallback((el) => { if (pixelOn && ['whatsapp', 'phone'].includes(el.link?.kind)) track('Contact'); }, [pixelOn]);
  const style = useMemo(() => pvVars(doc.theme), [doc.theme]);
  const showCart = isCatalog && cartOpen;

  return (
    <div className="pv-root" style={style}>
      <PageBackground theme={doc.theme} />
      <ClipDefs />
      {!showCart && (
        <main className="pv-main" style={{ flexDirection: 'column', alignItems: 'center' }}>
          <PortfolioCanvas doc={doc} device={device} scale={scale} mode="public" animate products={products} onLink={onLink} onCart={isCatalog ? () => goCart(true) : undefined} cartCount={cartCount} />
        </main>
      )}
      {isCatalog && !showCart && <CatalogHome doc={doc} products={products} cart={cart} onOpenCart={() => goCart(true)} pixelOn={pixelOn} />}
      {showCart && <CartPage doc={doc} products={products} store={store} slug={slug} cart={cart} onBack={() => goCart(false)} pixelOn={pixelOn} />}
      <PageCredit theme={doc.theme} />
    </div>
  );
}
