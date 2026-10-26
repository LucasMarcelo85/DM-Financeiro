import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { dateBR, dateTimeBR, digits, formatDoc, formatStoredPhone } from '../lib/format.js';

// "há 5 min", "há 3 h", "há 2 dias"
function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'agora mesmo';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}
const grantLabel = (kind, trialDays) => (kind === 'teste' ? `teste de ${trialDays} ${trialDays === 1 ? 'dia' : 'dias'}` : 'acesso mensal (+30 dias)');

const STATUS = {
  admin: ['Admin', 'pill-admin'],
  paid: ['Pago', 'pill-sent'],
  trial: ['Teste grátis', 'pill-partial'],
  expired: ['Expirado', 'pill-failed'],
};

export default function Admin() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [plans, setPlans] = useState([]); // planos cadastrados (o admin cria, edita e exclui em "Gerir planos")
  const [trialDays, setTrialDays] = useState(3);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | paid | trial | expired (clique nos totais)
  const [busyId, setBusyId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [confirmUndo, setConfirmUndo] = useState(null);

  const load = useCallback(() => {
    api.get('/admin/users').then((r) => setUsers(r.users)).catch((e) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(load, [load]);
  useEffect(() => {
    api.get('/admin/plans')
      .then((r) => {
        setPlans(r.plans);
        setTrialDays(Number(r.trial?.days) > 0 ? Number(r.trial.days) : 3);
      })
      .catch(() => {});
  }, []);

  const replace = (u) => setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, ...u } : x)));

  async function act(id, fn, okMsg) {
    setBusyId(id);
    try {
      const r = await fn();
      if (r?.user) replace(r.user);
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(u) {
    setConfirmDel(null);
    await act(u.id, async () => {
      await api.del(`/admin/users/${u.id}`);
      setUsers((list) => list.filter((x) => x.id !== u.id));
    }, 'Usuário excluído.');
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qd = digits(q);
    return (users || []).filter((u) => {
      if (statusFilter !== 'all' && u.access.status !== statusFilter) return false;
      return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || Boolean(qd && u.document.includes(qd));
    });
  }, [users, query, statusFilter]);

  const count = (s) => (users || []).filter((u) => u.access.status === s).length;

  return (
    <>
      <header className="page-head">
        <h1>Usuários</h1>
        <p className="muted">Veja quem usa o sistema, dê acesso mensal, troque o plano ou exclua contas.</p>
      </header>

      {users && (
        <div className="stats" role="group" aria-label="Filtrar usuários por situação">
          {[['all', users.length, 'Total'], ['paid', count('paid'), 'Pagos'], ['trial', count('trial'), 'Em teste'], ['expired', count('expired'), 'Expirados']].map(([id, n, label]) => (
            <button key={id} type="button" className={statusFilter === id ? 'is-on' : ''} aria-pressed={statusFilter === id} onClick={() => setStatusFilter(id)}>
              <strong>{n}</strong><span>{label}</span>
            </button>
          ))}
        </div>
      )}

      <input className="input search" type="search" placeholder="Buscar por nome, e-mail ou CPF/CNPJ" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar usuário" />

      {users === null ? (
        <p className="muted">Carregando...</p>
      ) : filtered.length === 0 ? (
        <p className="empty">{statusFilter !== 'all' && !query.trim() ? 'Nenhum usuário nesta situação.' : 'Nenhum usuário encontrado.'}</p>
      ) : (
        <ul className="user-list">
          {filtered.map((u) => {
            const [label, cls] = STATUS[u.access.status];
            const self = u.id === me.id;
            const isAdmin = u.role === 'admin';
            return (
              <li key={u.id} className="user-row">
                <div className="user-id">
                  <strong>{u.name}</strong>
                  <span>{formatDoc(u.document)} · {u.email}</span>
                  <span className="user-contact">
                    {u.phone
                      ? <a href={`https://wa.me/55${digits(u.phone)}`} target="_blank" rel="noreferrer" title="Abrir conversa no WhatsApp">{formatStoredPhone(u.phone)}</a>
                      : 'Sem telefone'}
                    <span className="user-last" title={u.lastActivityAt ? new Date(u.lastActivityAt).toLocaleString('pt-BR') : ''}>
                      {u.lastActivityAt ? `Última atividade: ${ago(u.lastActivityAt)}${u.lastActivity ? ` · ${u.lastActivity}` : ''}` : 'Ainda não mexeu em nada'}
                    </span>
                  </span>
                </div>
                <div className="user-plan">
                  {isAdmin ? (
                    <span className="badge plan-admin">Admin</span>
                  ) : (
                    <select className="input input-sm" value={u.plan} disabled={busyId === u.id} onChange={(e) => act(u.id, () => api.patch(`/admin/users/${u.id}/plan`, { plan: e.target.value }), 'Plano atualizado.')} aria-label={`Plano de ${u.name}`}>
                      {(plans.some((p) => p.id === u.plan) ? plans : [...plans, { id: u.plan, name: u.planName || u.plan }]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="user-status">
                  <span className={`pill ${cls}`}>{label}</span>
                  {!isAdmin && <small>até {dateBR(u.access.endsAt)}</small>}
                </div>
                <div className="user-actions">
                  {!isAdmin && (
                    <>
                      <button className="btn btn-ghost btn-sm" disabled={busyId === u.id} onClick={() => act(u.id, () => api.post(`/admin/users/${u.id}/grant`), 'Acesso mensal liberado (+30 dias).')}>
                        <Icon name="calendar" size={16} /> Dar acesso mensal
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={busyId === u.id} onClick={() => act(u.id, () => api.post(`/admin/users/${u.id}/grant-trial`), `Teste de ${trialDays} ${trialDays === 1 ? 'dia' : 'dias'} liberado.`)} title={`Dá mais ${trialDays} ${trialDays === 1 ? 'dia' : 'dias'} de teste grátis`}>
                        <Icon name="clock" size={16} /> Dar teste de {trialDays} {trialDays === 1 ? 'dia' : 'dias'}
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={busyId === u.id || !u.lastGrant} onClick={() => setConfirmUndo(u)}
                        title={u.lastGrant ? `Desfaz: ${grantLabel(u.lastGrant.kind, trialDays)} dado em ${dateTimeBR(u.lastGrant.createdAt)}` : 'Não há liberação do administrador para desfazer'}>
                        <Icon name="undo" size={16} /> Retroceder
                      </button>
                    </>
                  )}
                  {!isAdmin && !self && (
                    <button className="icon-btn icon-btn-danger" disabled={busyId === u.id} onClick={() => setConfirmDel(u)} aria-label={`Excluir ${u.name}`} title="Excluir">
                      <Icon name="trash" size={18} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirmUndo && (
        <Modal title="Retroceder a última liberação?" onClose={() => setConfirmUndo(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirmUndo(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => { const u = confirmUndo; setConfirmUndo(null); act(u.id, () => api.post(`/admin/users/${u.id}/undo-access`), 'Liberação desfeita.'); }}>Retroceder</button></>}>
          <p>Vai desfazer o <strong>{GRANT_LABEL[confirmUndo.lastGrant.kind]}</strong> que {confirmUndo.lastGrant.adminName || 'um administrador'} deu a <strong>{confirmUndo.name}</strong> em {dateTimeBR(confirmUndo.lastGrant.createdAt)}.</p>
          <p className="muted small">O que o usuário pagou depois não é perdido. Se tiver mais liberações, dá para retroceder uma de cada vez, da mais nova para a mais antiga.</p>
        </Modal>
      )}

      {confirmDel && (
        <Modal
          title="Excluir este usuário?"
          onClose={() => setConfirmDel(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => remove(confirmDel)}>Excluir</button>
            </>
          }
        >
          <p><strong>{confirmDel.name}</strong> perderá o acesso, e os WhatsApps conectados e o histórico serão apagados. Isso não pode ser desfeito.</p>
        </Modal>
      )}
    </>
  );
}
