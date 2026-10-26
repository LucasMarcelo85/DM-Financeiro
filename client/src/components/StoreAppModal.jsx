import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { copyText } from '../lib/portfolio/share.js';

// "Criar app" da loja: nome, cor, link de instalação e os acessos dos lojistas.
export default function StoreAppModal({ storeId, onClose }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState({ enabled: false, name: '', color: '#F2A33A' });
  const [nu, setNu] = useState({ name: '', login: '', password: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get(`/stores/${storeId}/app`).then((r) => {
    setData(r);
    setCfg({ enabled: r.store.app.enabled, name: r.store.app.name, color: r.store.app.color || '#F2A33A' });
  }).catch((e) => toast(e.message, 'error')), [storeId, toast]);
  useEffect(() => { load(); }, [load]);

  async function run(fn, ok) {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); await load(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  const store = data?.store;
  const link = store ? (store.domain.verified ? `https://${store.domain.name}/app` : `${window.location.origin}/app/${store.slug}`) : '';

  async function share() {
    const text = `Acesse o aplicativo da loja ${store.app.name || store.name}: ${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: store.app.name || store.name, text: 'Aplicativo da loja', url: link }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <Modal title="Aplicativo da loja" onClose={onClose}>
      {!data ? <p className="muted">Carregando...</p> : (
        <div style={{ display: 'grid', gap: 14 }}>
          <p className="muted small">O lojista instala este aplicativo no celular e, com o acesso que você criar, cadastra, edita e desativa produtos, e vê pedidos, clientes e arquivados desta loja. O endereço é o do site da loja.</p>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Aplicativo ativo
          </label>
          <input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} placeholder={`Nome do app (padrão: ${store.name})`} maxLength={40} aria-label="Nome do app" />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            Cor <input type="color" value={cfg.color} onChange={(e) => setCfg({ ...cfg, color: e.target.value })} />
          </label>
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.put(`/stores/${storeId}/app`, cfg), 'Aplicativo salvo.')}>Salvar aplicativo</button>

          {store.app.enabled ? (
            <div className="banner" style={{ flexWrap: 'wrap' }}>
              <div><strong>Link do aplicativo</strong><code style={{ wordBreak: 'break-all', display: 'block' }}>{link}</code></div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={share}>Compartilhar</button>
                <button className="btn btn-ghost btn-sm" onClick={async () => toast((await copyText(link)) ? 'Link copiado!' : 'Copie o link manualmente.')}>Copiar</button>
                <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noopener noreferrer">Abrir</a>
              </div>
            </div>
          ) : <p className="muted small">Ative o aplicativo e salve para liberar o link de compartilhamento.</p>}

          <h3 style={{ margin: '8px 0 0' }}>Acessos de lojistas</h3>
          {!data.users.length && <p className="muted small">Nenhum acesso criado.</p>}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {data.users.map((u) => (
              <li key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{u.name}</strong> <code>{u.login}</code>
                <span className={`pill ${u.active ? 'pill-sent' : 'pill-failed'}`}>{u.active ? 'Ativo' : 'Desativado'}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.patch(`/stores/${storeId}/app/users/${u.id}`, { active: !u.active }))}>{u.active ? 'Desativar' : 'Ativar'}</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { const p = window.prompt(`Nova senha para ${u.name} (mínimo 6 caracteres):`); if (p) run(() => api.patch(`/stores/${storeId}/app/users/${u.id}`, { password: p }), 'Senha alterada.'); }}>Nova senha</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { if (window.confirm(`Excluir o acesso de ${u.name}?`)) run(() => api.del(`/stores/${storeId}/app/users/${u.id}`), 'Acesso excluído.'); }}>Excluir</button>
                </span>
              </li>
            ))}
          </ul>

          <div style={{ display: 'grid', gap: 8 }}>
            <input className="input" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="Nome do lojista" maxLength={80} aria-label="Nome do lojista" />
            <input className="input" value={nu.login} onChange={(e) => setNu({ ...nu, login: e.target.value })} placeholder="Usuário de acesso" maxLength={80} autoCapitalize="none" aria-label="Usuário de acesso" />
            <input className="input" type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="Senha (mínimo 6 caracteres)" autoComplete="new-password" aria-label="Senha" />
            <button className="btn btn-primary" disabled={busy || !nu.name.trim() || !nu.login.trim() || nu.password.length < 6}
              onClick={() => run(async () => { await api.post(`/stores/${storeId}/app/users`, nu); setNu({ name: '', login: '', password: '' }); }, 'Acesso criado.')}>Criar acesso</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
