import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import { plural } from '../lib/format.js';

export default function Contracts() {
  const { user } = useAuth();
  return (
    <>
      <header className="page-head">
        <h1>Contratos</h1>
        <p className="muted">Modelos de contrato para enviar aos seus clientes.</p>
      </header>
      <section className="empty-hero">
        <span className="action-icon action-icon-lg"><Icon name="file" size={32} /></span>
        <h2>Em breve</h2>
        <p>Seu plano já inclui {plural(user.limits.contracts, 'modelo de contrato', 'modelos de contrato')}. Avisaremos quando a criação de contratos estiver disponível.</p>
      </section>
    </>
  );
}
