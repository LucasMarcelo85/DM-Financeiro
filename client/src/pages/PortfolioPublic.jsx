import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import PortfolioView from '../components/portfolio/PortfolioView.jsx';
import { DEFAULT_THEME, normalizeDoc, themeVars } from '../lib/portfolio/model.js';

// Página pública do portfólio (sem login): dominio/<usuário> e dominio/<usuário>/<página>.
export default function PortfolioPublic() {
  const { userSlug, pageSlug } = useParams();
  const [state, setState] = useState({ loading: true, page: null, owner: null });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, page: null, owner: null });
    const qs = `u=${encodeURIComponent(userSlug)}${pageSlug ? `&p=${encodeURIComponent(pageSlug)}` : ''}`;
    api.get(`/public/portfolio?${qs}`)
      .then((r) => alive && setState({ loading: false, owner: r.owner, page: { ...r.page, doc: normalizeDoc(r.page.data) } }))
      .catch(() => alive && setState({ loading: false, page: null, owner: null }));
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

  if (state.loading) return <div className="splash"><span className="lamp lamp-lg is-pending" /></div>;

  if (!page) {
    return (
      <div className="pf-missing">
        <h1>Página não encontrada</h1>
        <p className="muted">Este endereço não existe ou a página ainda não foi publicada.</p>
        <Link to="/" className="btn btn-primary">Ir para o início</Link>
      </div>
    );
  }

  // Fundo da página inteira (inclusive nas áreas fora do conteúdo) segue a cor do tema.
  const theme = { ...DEFAULT_THEME, ...page.doc.theme };
  return (
    <div className="pf-wrap" style={themeVars(theme)}>
      <PortfolioView doc={page.doc} />
    </div>
  );
}
