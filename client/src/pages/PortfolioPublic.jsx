import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import PortfolioCanvas, { ClipDefs, PageBackground, PageCredit, pvVars, usePageScale } from '../components/portfolio/Canvas.jsx';
import { CartBar, CartPage, priced, useCart, useCartView } from '../components/portfolio/Catalog.jsx';
import PortfolioPushPrompt from '../components/portfolio/PortfolioPushPrompt.jsx';
import PortfolioInstallPrompt from '../components/portfolio/PortfolioInstallPrompt.jsx';
import ImageLightboxProvider, { useImageLightbox } from '../components/portfolio/ImageLightbox.jsx';
import { normalizeDoc } from '../lib/portfolio/doc.js';
import { initPixels, track } from '../lib/portfolio/pixel.js';
import { makeGrapesFrameDocument } from '../lib/portfolio/grapesPreview.js';

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
      .then((r) => {
        if (!alive) return;
        const doc = r.page.data?.editor === 'grapesjs'
          ? { ...normalizeDoc({}, r.page.kind), ...r.page.data, kind: r.page.kind, seo: { title: r.page.data.title || r.page.name || '', description: r.page.data.description || '' } }
          : normalizeDoc(r.page.data, r.page.kind);
        setState({ loading: false, owner: { ...r.owner, credit: r.credit !== false }, products: r.products || [], store: r.store || null, page: { ...r.page, doc } });
      })
      .catch(() => alive && setState({ loading: false, page: null, owner: null, products: [], store: null }));
    return () => { alive = false; };
  }, [userSlug, pageSlug]);

  const { page, owner } = state;

  // Título da aba do navegador (quem recebe o link já vê o título certo pelo HTML que o servidor entrega).
  useEffect(() => {
    if (!page) return undefined;
    const before = document.title;
    document.title = page.doc.branding?.siteName || page.doc.seo.title || owner?.siteName || page.name || owner?.name || before;
    return () => { document.title = before; };
  }, [page, owner]);

  useEffect(() => {
    if (!page || !owner?.slug) return undefined;
    const query = new URLSearchParams({ u: owner.slug });
    if (!page.isMain) query.set('p', page.slug);
    const iconUrl = `/api/public/portfolio/icon?${query}`;
    const links = [
      ['icon', iconUrl],
      ['apple-touch-icon', iconUrl],
      ...(page.doc.branding?.installEnabled !== false ? [['manifest', `/api/public/portfolio/manifest?${query}`]] : []),
    ].map(([rel, href]) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      document.head.appendChild(link);
      return link;
    });
    const themeColor = document.querySelector('meta[name="theme-color"]');
    const previousColor = themeColor?.content;
    if (themeColor) themeColor.content = page.doc.theme.primary;
    return () => {
      links.forEach((link) => link.remove());
      if (themeColor && previousColor) themeColor.content = previousColor;
    };
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
  return <ImageLightboxProvider key={page.id}><PublicPage page={page} owner={owner} products={state.products} store={state.store} slug={owner.slug} credit={owner.credit} /></ImageLightboxProvider>;
}

function PublicPage({ page, products, store, slug, credit }) {
  const { doc } = page;
  const legacyFrameRef = useRef(null);
  const lightbox = useImageLightbox();
  const { device, scale } = usePageScale();
  const isCatalog = doc.kind === 'catalog' && Boolean(store);
  const cart = useCart(slug);
  const [cartOpen, goCart] = useCartView(doc.catalog?.cartLink);
  const { count: cartCount } = priced(cart.items, products);
  const pixelOn = Boolean(doc.pixel.meta || doc.pixel.google || doc.pixel.tiktok);
  const directOrder = isCatalog && doc.catalog?.orderMode === 'direct';
  const onLink = useCallback((el) => { if (pixelOn && ['whatsapp', 'phone'].includes(el.link?.kind)) track('Contact'); }, [pixelOn]);
  const style = useMemo(() => pvVars(doc.theme), [doc.theme]);
  const showCart = isCatalog && !directOrder && cartOpen;
  const bindLegacyImageZoom = useCallback(() => {
    const frameDocument = legacyFrameRef.current?.contentDocument;
    if (!frameDocument || !lightbox) return undefined;
    const onImageClick = (event) => {
      const image = event.target?.closest?.('img');
      if (!image?.currentSrc) return;
      event.preventDefault();
      event.stopPropagation();
      const source = image.currentSrc;
      if (!/^(?:https?:\/\/|data:image\/)/i.test(source)) return;
      const rawHref = image.closest('a')?.href || '';
      const href = /^(?:https?:\/\/|mailto:|tel:|\/|#)/i.test(rawHref) ? rawHref : '';
      lightbox.openImage(source, String(image.alt || '').slice(0, 500), href);
    };
    frameDocument.addEventListener('click', onImageClick, true);
    return () => frameDocument.removeEventListener('click', onImageClick, true);
  }, [lightbox]);
  useEffect(() => {
    if (doc.editor !== 'grapesjs') return undefined;
    const frame = legacyFrameRef.current;
    if (!frame) return undefined;
    let cleanup = () => {};
    const onLoad = () => {
      cleanup();
      cleanup = bindLegacyImageZoom() || (() => {});
    };
    frame.addEventListener('load', onLoad);
    if (frame.contentDocument?.readyState === 'complete') onLoad();
    return () => {
      frame.removeEventListener('load', onLoad);
      cleanup();
    };
  }, [bindLegacyImageZoom, doc.editor, page.id]);

  if (doc.editor === 'grapesjs') {
    return (
      <div className="pv-root gpe-published" style={style}>
        <PublicNotices notices={doc.branding?.notices} />
        <PortfolioPushPrompt slug={slug} page={page} />
        <PortfolioInstallPrompt enabled={doc.branding?.installEnabled !== false} />
        <iframe ref={legacyFrameRef} title={doc.title || page.name || 'Página do portfólio'} sandbox="allow-same-origin" srcDoc={makeGrapesFrameDocument(doc.html, doc.css)} />
        {credit !== false && <PageCredit theme={doc.theme} />}
      </div>
    );
  }

  return (
    <div className="pv-root" style={style}>
      <PageBackground theme={doc.theme} />
      <ClipDefs />
      <PublicNotices notices={doc.branding?.notices} />
      <PortfolioPushPrompt slug={slug} page={page} />
      <PortfolioInstallPrompt enabled={doc.branding?.installEnabled !== false} />
      {!showCart && (
        <main className="pv-main" style={{ flexDirection: 'column', alignItems: 'center' }}>
          <PortfolioCanvas doc={doc} device={device} scale={scale} mode="public" animate products={products} shop={isCatalog ? { cart, pixelOn, whatsapp: store?.whatsapp, slug } : undefined} onLink={onLink} onCart={isCatalog && !directOrder ? () => goCart(true) : undefined} cartCount={cartCount} />
        </main>
      )}
      {isCatalog && !directOrder && !showCart && <CartBar products={products} cart={cart} onOpenCart={() => goCart(true)} />}
      {showCart && <CartPage doc={doc} products={products} store={store} slug={slug} cart={cart} onBack={() => goCart(false)} pixelOn={pixelOn} />}
      {credit !== false && <PageCredit theme={doc.theme} />}
    </div>
  );
}

function PublicNotices({ notices = [] }) {
  const active = notices.filter((notice) => notice.title || notice.message);
  if (!active.length) return null;
  return (
    <aside className="pv-announcements" aria-label="Avisos da loja">
      {active.map((notice) => (
        <section className="pv-announcement" key={notice.id}>
          {notice.title && <strong>{notice.title}</strong>}
          {notice.message && <p>{notice.message}</p>}
        </section>
      ))}
    </aside>
  );
}
