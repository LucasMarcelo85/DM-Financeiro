import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import Lamp from '../components/Lamp.jsx';
import PlanBadge from '../components/PlanBadge.jsx';
import { useInstances } from '../lib/useInstances.js';
import { dateBR, dateTimeBR, firstName, formatStoredPhone, plural } from '../lib/format.js';

export const STATUS_TEXT = { sent: 'Enviada', partial: 'Só o texto foi', failed: 'Falhou' };

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error } = useInstances();
  const [recent, setRecent] = useState(null);

  useEffect(() => {
    api.get('/messages?limit=5').then((r) => setRecent(r.messages)).catch(() => setRecent([]));
  }, []);

  const instances = data?.instances || [];
  const connected = instances.some((i) => i.connected);
  const loading = !data && !error;
  const { access } = user;

  return (
    <>
      <header className="page-head">
        <h1>Olá, {firstName(user.name)}</h1>
        <p className="muted">Veja se o WhatsApp está conectado e envie suas mensagens.</p>
      </header>

      {access.status === 'trial' && (
        <div className="banner banner-amber">
          <div>
            <strong>Teste grátis: {access.daysLeft === 1 ? 'resta 1 dia' : `restam ${access.daysLeft} dias`}</strong>
            <span>Seu acesso grátis vai até {dateBR(access.endsAt)}. Depois, o pagamento é feito por link.</span>
          </div>
          <Link to="/plano" className="btn btn-primary btn-sm">Ver planos</Link>
        </div>
      )}
      {access.status === 'paid' && access.daysLeft <= 5 && (
        <div className="banner banner-amber">
          <div>
            <strong>Seu acesso termina em {plural(access.daysLeft, 'dia', 'dias')}</strong>
            <span>Renove antes de {dateBR(access.endsAt)} para não perder o acesso.</span>
          </div>
          <Link to="/plano" className="btn btn-primary btn-sm">Renovar</Link>
        </div>
      )}

      <section className={`status-hero ${connected ? 'is-on' : ''}`} aria-live="polite">
        <Lamp on={connected} pending={loading} size="xl" />
        <div className="status-hero-text">
          <h2>{loading ? 'Verificando o WhatsApp...' : connected ? 'WhatsApp conectado' : instances.length ? 'WhatsApp desconectado' : 'Nenhum WhatsApp conectado'}</h2>
          <p>
            {loading
              ? 'Só um instante.'
              : connected
                ? 'Tudo pronto para enviar cobranças e lembretes.'
                : data?.evolutionConfigured === false
                  ? 'A integração com o WhatsApp ainda não foi configurada. Avise o administrador.'
                  : 'Conecte lendo um QR Code com o celular. Leva cerca de um minuto.'}
          </p>
          {instances.length > 1 && (
            <ul className="mini-instances">
              {instances.map((i) => (
                <li key={i.id}>
                  <Lamp on={i.connected} size="sm" /> {i.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        {!loading && (
          <Link to="/whatsapp" className={`btn ${connected ? 'btn-ghost' : 'btn-primary'}`}>
            {connected ? 'Gerenciar' : 'Conectar WhatsApp'}
          </Link>
        )}
      </section>

      <section className="grid-auto">
        <Link to="/cobranca" className="action-card">
          <span className="action-icon"><Icon name="money" size={24} /></span>
          <strong>Enviar cobrança</strong>
          <span>Texto, número do cliente e link ou chave Pix.</span>
        </Link>
        <Link to="/lembrete" className="action-card">
          <span className="action-icon"><Icon name="bell" size={24} /></span>
          <strong>Enviar lembrete</strong>
          <span>Avise o cliente antes do vencimento.</span>
        </Link>
        <Link to="/plano" className="action-card">
          <span className="action-icon"><Icon name="card" size={24} /></span>
          <strong>
            Plano {user.role === 'admin' ? 'Admin' : <PlanBadge plan={user.plan} />}
          </strong>
          <span>
            {access.status === 'admin' ? 'Sem cobrança.' : access.status === 'paid' ? `Ativo até ${dateBR(access.endsAt)}.` : 'Veja valores e pague pelo link.'}
          </span>
        </Link>
      </section>

      <section className="card">
        <h2 className="card-title">Últimos envios</h2>
        {recent === null ? (
          <p className="muted">Carregando...</p>
        ) : recent.length === 0 ? (
          <p className="empty">Você ainda não enviou nada. Comece por uma <Link to="/cobranca">cobrança</Link> ou um <Link to="/lembrete">lembrete</Link>.</p>
        ) : (
          <ul className="history">
            {recent.map((m) => (
              <li key={m.id}>
                <span className="history-main">
                  <strong>{m.kind === 'cobranca' ? 'Cobrança' : 'Lembrete'}</strong> para {formatStoredPhone(m.number)}
                </span>
                <span className={`pill pill-${m.status}`}>{STATUS_TEXT[m.status]}</span>
                <time>{dateTimeBR(m.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
