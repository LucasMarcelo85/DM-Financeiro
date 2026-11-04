import { Link, Navigate, useParams } from 'react-router-dom';
import { DOCS, docBySlug, docHref } from '../lib/docs.js';
import { DEMOS } from '../components/DocsDemos.jsx';
import { Brand } from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';

// Documentação pública das funções do sistema (/ajuda e /ajuda/:topic), com prévia interativa de exemplo.
export default function Docs() {
  const { topic } = useParams();
  const doc = topic ? docBySlug(topic) : null;
  if (topic && !doc) return <Navigate to="/ajuda" replace />;
  const Demo = doc ? DEMOS[doc.slug] : null;
  return (
    <div className="docs-shell">
      <header className="docs-top">
        <Link to="/ajuda" className="docs-brand"><Brand /></Link>
        <a href="/" className="btn btn-ghost btn-sm">Voltar ao sistema</a>
      </header>
      <div className="docs-body">
        <nav className="docs-nav" aria-label="Funções">
          {DOCS.map((d) => <Link key={d.slug} to={docHref(d.slug)} className={d.slug === doc?.slug ? 'is-active' : ''}><Icon name={d.icon} size={16} /> {d.title}</Link>)}
        </nav>
        <main className="docs-main">
          {!doc ? (
            <>
              <h1>Documentação</h1>
              <p className="muted">Escolha uma função para entender como ela funciona, ver os limites e testar uma prévia interativa.</p>
              <div className="docs-grid">
                {DOCS.map((d) => <Link key={d.slug} to={docHref(d.slug)} className="card docs-card"><strong><Icon name={d.icon} size={18} /> {d.title}</strong><span className="muted small">{d.summary}</span></Link>)}
              </div>
            </>
          ) : (
            <article className="docs-article">
              <h1>{doc.title}</h1>
              <p className="docs-lead">{doc.about}</p>
              <section className="card">
                <h2>Prévia interativa</h2>
                <p className="muted small">Teste à vontade: são dados de exemplo e nada é salvo nem enviado.</p>
                <div className="dc"><Demo /></div>
              </section>
              <section><h2>Como usar</h2><ol>{doc.steps.map((s) => <li key={s}>{s}</li>)}</ol></section>
              <section><h2>Limitações</h2><ul>{doc.limitsList.map((s) => <li key={s}>{s}</li>)}</ul></section>
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
