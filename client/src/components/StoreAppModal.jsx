import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { copyText } from '../lib/portfolio/share.js';

const PERM_LABELS = [
  ['produtos', 'Produtos (cadastrar, editar e desativar)'],
  ['pedidos', 'Pedidos'],
  ['clientes', 'Clientes'],
  ['arquivados', 'Arquivados'],
  ['estrategia', 'Estratégia de vendas e regiões'],
  ['pdv', 'Frente de caixa (PDV)'],
  ['api', 'API e webhooks da loja'],
  ['entregas', 'Entregas, frete e WhatsApp'],
  ['auditoria', 'Auditoria e conversas WhatsApp'],
];
const ALL_PERMS = PERM_LABELS.map(([k]) => k);

function PermChecks({ value, onChange, disabled, labels = PERM_LABELS }) {
  return (
    <div style={{ display: 'flex', gap: '4px 14px', flexWrap: 'wrap' }}>
      {labels.map(([key, label]) => (
        <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" disabled={disabled} checked={value.includes(key)}
            onChange={(e) => onChange(e.target.checked ? [...value, key] : value.filter((k) => k !== key))} /> {label}
        </label>
      ))}
    </div>
  );
}

// "Criar app" da loja: nome, cor, link de instalação e os acessos dos lojistas.
export default function StoreAppModal({ storeId, onClose }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState({ enabled: false, name: '', color: '#F2A33A', userLimit: 10 });
  const [nu, setNu] = useState({ name: '', login: '', password: '', perms: ALL_PERMS });
  const [busy, setBusy] = useState(false);
  const permissionLabels = PERM_LABELS.filter(([key]) => (data?.availablePerms || ALL_PERMS).includes(key));

  const load = useCallback(() => api.get(`/stores/${storeId}/app`).then((r) => {
    setData(r);
    setCfg({ enabled: r.store.app.enabled, name: r.store.app.name, color: r.store.app.color || '#F2A33A', userLimit: r.store.app.userLimit });
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
          <p className="muted small">O lojista instala este aplicativo no celular. Escolha as áreas que cada acesso poderá usar; os dados e as conexões ficam limitados a este site.</p>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={cfg.enabled} disabled={!data.appAvailable} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Aplicativo ativo
          </label>
          {!data.appAvailable && <p className="muted small">O plano atual não inclui lojas com aplicativo.</p>}
          <input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} placeholder={`Nome do app (padrão: ${store.name})`} maxLength={40} aria-label="Nome do app" />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            Cor <input type="color" value={cfg.color} onChange={(e) => setCfg({ ...cfg, color: e.target.value })} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Quantidade de acessos permitidos nesta loja</span>
            <input className="input" type="number" min="1" max={data.maxAppUsers} step="1" value={cfg.userLimit}
              onChange={(e) => setCfg({ ...cfg, userLimit: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Quantidade de acessos permitidos nesta loja" />
            <small className="muted">Seu plano permite até {data.maxAppUsers} acessos por aplicativo. Acessos desativados também ocupam uma vaga.</small>
          </label>
          {data.users.length > data.maxAppUsers && <p className="muted small">Há {data.users.length} acessos cadastrados, acima do limite atual do plano. Exclua acessos excedentes para adequar a quantidade.</p>}
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.put(`/stores/${storeId}/app`, cfg), 'Aplicativo salvo.')}>Salvar aplicativo</button>

          {store.app.enabled && data.appAvailable ? (
            <div className="banner" style={{ flexWrap: 'wrap' }}>
              <div><strong>Link do aplicativo</strong><code style={{ wordBreak: 'break-all', display: 'block' }}>{link}</code></div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={share}>Compartilhar</button>
                <button className="btn btn-ghost btn-sm" onClick={async () => toast((await copyText(link)) ? 'Link copiado!' : 'Copie o link manualmente.')}>Copiar</button>
                <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noopener noreferrer">Abrir</a>
              </div>
            </div>
          ) : <p className="muted small">{data.appAvailable ? 'Ative o aplicativo e salve para liberar o link de compartilhamento.' : 'O aplicativo desta loja não está disponível no plano atual.'}</p>}

          <h3 style={{ margin: '8px 0 0' }}>Acessos de lojistas ({data.users.length}/{Math.min(cfg.userLimit || 0, data.maxAppUsers)})</h3>
          {!data.users.length && <p className="muted small">Nenhum acesso criado.</p>}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {data.users.map((u) => (
              <li key={u.id} style={{ display: 'grid', gap: 6, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{u.name}</strong> <code>{u.login}</code>
                  <span className={`pill ${u.active ? 'pill-sent' : 'pill-failed'}`}>{u.active ? 'Ativo' : 'Desativado'}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.patch(`/stores/${storeId}/app/users/${u.id}`, { active: !u.active }))}>{u.active ? 'Desativar' : 'Ativar'}</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { const p = window.prompt(`Nova senha para ${u.name} (mínimo 6 caracteres):`); if (p) run(() => api.patch(`/stores/${storeId}/app/users/${u.id}`, { password: p }), 'Senha alterada.'); }}>Nova senha</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { if (window.confirm(`Excluir o acesso de ${u.name}?`)) run(() => api.del(`/stores/${storeId}/app/users/${u.id}`), 'Acesso excluído.'); }}>Excluir</button>
                  </span>
                </div>
                <PermChecks labels={permissionLabels} value={u.perms} disabled={busy} onChange={(perms) => perms.length && run(() => api.patch(`/stores/${storeId}/app/users/${u.id}`, { perms }), 'Permissões salvas.')} />
              </li>
            ))}
          </ul>

          <div style={{ display: 'grid', gap: 8 }}>
            <input className="input" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="Nome do lojista" maxLength={80} aria-label="Nome do lojista" />
            <input className="input" value={nu.login} onChange={(e) => setNu({ ...nu, login: e.target.value })} placeholder="Usuário de acesso" maxLength={80} autoCapitalize="none" aria-label="Usuário de acesso" />
            <input className="input" type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="Senha (mínimo 6 caracteres)" autoComplete="new-password" aria-label="Senha" />
            <strong className="small">O que este acesso pode usar:</strong>
            <PermChecks labels={permissionLabels} value={nu.perms.filter((perm) => permissionLabels.some(([key]) => key === perm))} onChange={(perms) => setNu({ ...nu, perms })} />
            <button className="btn btn-primary" disabled={busy || data.users.length >= Math.min(cfg.userLimit || 0, data.maxAppUsers) || !nu.name.trim() || !nu.login.trim() || nu.password.length < 6 || !nu.perms.some((perm) => permissionLabels.some(([key]) => key === perm))}
              onClick={() => run(async () => {
                const perms = nu.perms.filter((perm) => permissionLabels.some(([key]) => key === perm));
                await api.post(`/stores/${storeId}/app/users`, { ...nu, perms });
                setNu({ name: '', login: '', password: '', perms: data.availablePerms });
              }, 'Acesso criado.')}>Criar acesso</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
