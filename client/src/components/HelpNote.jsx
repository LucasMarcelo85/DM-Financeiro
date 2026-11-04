import { docBySlug, docHref } from '../lib/docs.js';

// Texto curto no topo de cada menu: o que a área faz, as limitações e o link para a documentação completa.
export default function HelpNote({ topic, children }) {
  const doc = docBySlug(topic);
  if (!doc) return null;
  return (
    <p className="muted help-note">
      {doc.summary} {children} <strong className="help-limit">Limites:</strong> {doc.limits}{' '}
      <a href={docHref(topic)} target="_blank" rel="noopener noreferrer">Saiba mais</a>
    </p>
  );
}
