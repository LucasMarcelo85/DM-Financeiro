import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import Lamp from '../components/Lamp.jsx';
import PlanBadge from '../components/PlanBadge.jsx';
import { useInstances } from '../lib/useInstances.js';
import { brl, dateBR, dateTimeBR, firstName, fmtRun, formatStoredPhone, plural } from '../lib/format.js';

export const STATUS_TEXT = { sent: 'Enviada', partial: 'Só o texto foi', failed: 'Falhou' };

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error } = useInstances();
  const [recent, setRecent] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/messages?limit=5').then((r) => setRecent(r.messages)).catch(() => setRecent([]));
    api.get('/stats').then(setStats).catch(() => {});
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

      <section className="stats-grid" aria-label="Resumo">
        <Link to="/clientes" className="stat-card">
          <span className="stat-icon"><Icon name="user" size={22} /></span>
          <span className="stat-label">Clientes cadastrados</span>
          <strong className="stat-value">{stats ? stats.contacts : '–'}</strong>
          <span className="stat-sub">Ver clientes</span>
        </Link>
        <Link to="/cobrancas" className="stat-card">
          <span className="stat-icon"><Icon name="trend" size={22} /></span>
          <span className="stat-label">Cobranças mensais</span>
          <strong className="stat-value">{stats ? brl(stats.monthlyTotalCents) : '–'}</strong>
          <span className="stat-sub">{stats ? `${plural(stats.monthlyCount, 'cobrança ativa', 'cobranças ativas')} por mês` : ' '}</span>
        </Link>
        <Link to="/cobrancas" className="stat-card">
          <span className="stat-icon"><Icon name="calendar" size={22} /></span>
          <span className="stat-label">Previsto neste mês</span>
          <strong className="stat-value">{stats ? brl(stats.expectedMonthCents) : '–'}</strong>
          <span className="stat-sub">Mensais + avulsas que vencem</span>
        </Link>
        <div className="stat-card">
          <span className="stat-icon"><Icon name="send" size={22} /></span>
          <span className="stat-label">Mensagens no mês</span>
          <strong className="stat-value">{stats ? stats.sentThisMonth : '–'}</strong>
          <span className="stat-sub">Enviadas com sucesso</span>
        </div>
      </section>

      <section className="grid-auto">
        <Link to="/cobrancas/nova" className="action-card">
          <span className="action-icon"><Icon name="money" size={24} /></span>
          <strong>Nova cobrança</strong>
          <span>Avulsa ou mensal, enviada no horário que você escolher.</span>
        </Link>
        <Link to="/lembretes/novo" className="action-card">
          <span className="action-icon"><Icon name="bell" size={24} /></span>
          <strong>Novo lembrete</strong>
          <span>Avise o cliente antes do vencimento.</span>
        </Link>
        <Link to="/clientes?novo=1" className="action-card">
          <span className="action-icon"><Icon name="user" size={24} /></span>
          <strong>Novo cliente</strong>
          <span>Salve para escolher rápido depois.</span>
        </Link>
      </section>

      <div className="two-col">
        <section className="card">
          <h2 className="card-title">Próximos envios</h2>
          {stats === null ? <p className="muted">Carregando...</p> : stats.upcoming.length === 0 ? (
            <p className="empty">Nada agendado. Crie uma <Link to="/cobrancas/nova">cobrança</Link> ou um <Link to="/lembretes/novo">lembrete</Link>.</p>
          ) : (
            <ul className="history">
              {stats.upcoming.map((u) => (
                <li key={u.id}>
                  <span className="history-main"><strong>{u.contactName}</strong>{u.amountCents != null ? ` · ${brl(u.amountCents)}` : ''}</span>
                  <span className={`tag ${u.recurrence === 'mensal' ? 'tag-monthly' : ''}`}>{u.recurrence === 'mensal' ? 'Mensal' : 'Avulsa'}</span>
                  <time>{fmtRun(u.nextRunAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
        <h2 className="card-title">Últimos envios</h2>
        {recent === null ? (
          <p className="muted">Carregando...</p>
        ) : recent.length === 0 ? (
          <p className="empty">Você ainda não enviou nada.</p>
        ) : (
          <ul className="history">
            {recent.map((m) => (
              <li key={m.id}>
                <span className="history-main">
                  <strong>{m.kind === 'cobranca' ? 'Cobrança' : 'Lembrete'}</strong> para {m.contactName || formatStoredPhone(m.number)}{m.automatic ? ' · automático' : ''}
                </span>
                <span className={`pill pill-${m.status}`}>{STATUS_TEXT[m.status]}</span>
                <time>{dateTimeBR(m.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
        </section>
      </div>
    </>
  );
}
