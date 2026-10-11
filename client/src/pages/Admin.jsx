import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { dateBR, digits, formatDoc } from '../lib/format.js';

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
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const load = useCallback(() => {
    api.get('/admin/users').then((r) => setUsers(r.users)).catch((e) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(load, [load]);

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
    if (!q) return users || [];
    const qd = digits(q);
    return (users || []).filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (qd && u.document.includes(qd)));
  }, [users, query]);

  const count = (s) => (users || []).filter((u) => u.access.status === s).length;

  return (
    <>
      <header className="page-head">
        <h1>Usuários</h1>
        <p className="muted">Veja quem usa o sistema, dê acesso mensal, troque o plano ou exclua contas.</p>
      </header>

      {users && (
        <div className="stats">
          <div><strong>{users.length}</strong><span>Total</span></div>
          <div><strong>{count('paid')}</strong><span>Pagos</span></div>
          <div><strong>{count('trial')}</strong><span>Em teste</span></div>
          <div><strong>{count('expired')}</strong><span>Expirados</span></div>
        </div>
      )}

      <input className="input search" type="search" placeholder="Buscar por nome, e-mail ou CPF/CNPJ" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar usuário" />

      {users === null ? (
        <p className="muted">Carregando...</p>
      ) : filtered.length === 0 ? (
        <p className="empty">Nenhum usuário encontrado.</p>
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
                </div>
                <div className="user-plan">
                  {isAdmin ? (
                    <span className="badge plan-admin">Admin</span>
                  ) : (
                    <select className="input input-sm" value={u.plan} disabled={busyId === u.id} onChange={(e) => act(u.id, () => api.patch(`/admin/users/${u.id}/plan`, { plan: e.target.value }), 'Plano atualizado.')} aria-label={`Plano de ${u.name}`}>
                      <option value="bronze">Bronze</option>
                      <option value="prata">Prata</option>
                      <option value="ouro">Ouro</option>
                    </select>
                  )}
                </div>
                <div className="user-status">
                  <span className={`pill ${cls}`}>{label}</span>
                  {!isAdmin && <small>até {dateBR(u.access.endsAt)}</small>}
                </div>
                <div className="user-actions">
                  {!isAdmin && (
                    <button className="btn btn-ghost btn-sm" disabled={busyId === u.id} onClick={() => act(u.id, () => api.post(`/admin/users/${u.id}/grant`), 'Acesso mensal liberado.')}>
                      <Icon name="calendar" size={16} /> Dar acesso mensal
                    </button>
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
