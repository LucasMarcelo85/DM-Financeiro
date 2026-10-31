import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { copyText } from '../lib/portfolio/share.js';

const PERM_LABELS = [
  ['produtos', 'Produtos (cadastrar, editar e desativar)'],
  ['estoque', 'Estoque e movimentações'],
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
  const [cfg, setCfg] = useState({ enabled: false, name: '', color: '#F2A33A', userLimit: 10, productLimit: 0, auditEnabled: false, auditInstanceLimit: 0 });
  const [appNotifications, setAppNotifications] = useState({ enabled: false, instanceId: '', fallbackEnabled: false, fallbackInstanceId: '' });
  const [notificationInstances, setNotificationInstances] = useState([]);
  const [nu, setNu] = useState({ name: '', login: '', perms: ALL_PERMS, stockFlowIds: [], isPrimary: false });
  const [temporaryCredential, setTemporaryCredential] = useState(null);
  const [busy, setBusy] = useState(false);
  const initializedFlowsStoreId = useRef(null);
  const permissionLabels = PERM_LABELS.filter(([key]) => (data?.availablePerms || ALL_PERMS).includes(key)
    && (key !== 'auditoria' || cfg.auditEnabled && Number(cfg.auditInstanceLimit) > 0));

  const load = useCallback(() => Promise.all([
    api.get(`/stores/${storeId}/app`),
    api.get(`/instances?store=${storeId}&includeOwner=1`),
  ]).then(([r, connectionData]) => {
    setData(r);
    setNotificationInstances(connectionData.instances || []);
    setAppNotifications({
      enabled: r.appNotifications.enabled,
      instanceId: r.appNotifications.instanceId,
      fallbackEnabled: r.appNotifications.fallbackEnabled,
      fallbackInstanceId: r.appNotifications.fallbackInstanceId,
    });
    setCfg({
      enabled: r.store.app.enabled, name: r.store.app.name, color: r.store.app.color || '#F2A33A',
      userLimit: r.store.app.userLimit, productLimit: r.store.app.productLimit ?? r.maxAppProducts,
      auditEnabled: r.store.app.auditEnabled, auditInstanceLimit: r.store.app.auditInstanceLimit,
    });
    if (initializedFlowsStoreId.current !== storeId) {
      initializedFlowsStoreId.current = storeId;
      setNu((current) => ({ ...current, stockFlowIds: r.flows.map((flow) => flow.id) }));
    }
  }).catch((e) => toast(e.message, 'error')), [storeId, toast]);
  useEffect(() => { load(); }, [load]);

  async function run(fn, ok) {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); await load(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  const store = data?.store;
  const link = store ? (store.domain.verified ? `https://${store.domain.name}/app` : `${window.location.origin}/app/${store.slug}`) : '';
  const appReady = Boolean(store?.app.enabled && data?.appAvailable);

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
          {temporaryCredential && <section className="banner" style={{ display: 'grid', gap: 8 }}>
            <strong>Senha provisória de {temporaryCredential.name}</strong>
            <p className="muted small" style={{ margin: 0 }}>Envie esta senha ao usuário. No primeiro acesso, ele precisará cadastrar uma senha nova. Ela não será exibida novamente.</p>
            <code style={{ fontSize: 16, userSelect: 'all' }}>{temporaryCredential.password}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => toast((await copyText(temporaryCredential.password)) ? 'Senha copiada!' : 'Copie a senha manualmente.')}>Copiar senha</button>
          </section>}

          <section className="banner" aria-label="Link do aplicativo" style={{ display: 'grid', gap: 10 }}>
            <div>
              <strong>Link para enviar ao usuário</strong>
              <code style={{ display: 'block', marginTop: 6, wordBreak: 'break-all' }}>{link}</code>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" disabled={!appReady} onClick={share}>Compartilhar</button>
              <button className="btn btn-ghost btn-sm" disabled={!appReady} onClick={async () => toast((await copyText(link)) ? 'Link copiado!' : 'Copie o link manualmente.')}>Copiar link</button>
              {appReady
                ? <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noopener noreferrer">Visualizar aplicativo</a>
                : <button className="btn btn-ghost btn-sm" disabled>Visualizar aplicativo</button>}
            </div>
            {!appReady && <small className="muted">{!data.appAvailable ? 'O plano atual não disponibiliza o aplicativo.' : cfg.enabled ? 'Salve o aplicativo para ativar este link.' : 'Ative e salve o aplicativo para poder enviar este link.'}</small>}
          </section>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={cfg.enabled} disabled={!data.appAvailable} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Aplicativo ativo
          </label>
          {!data.appAvailable && <p className="muted small">O plano atual não inclui lojas com aplicativo.</p>}
          <input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} placeholder={`Nome do app (padrão: ${store.name})`} maxLength={40} aria-label="Nome do app" />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            Cor <input type="color" value={cfg.color} onChange={(e) => setCfg({ ...cfg, color: e.target.value })} />
          </label>
          <section className="banner" style={{ display: 'grid', gap: 10 }}>
            <strong>Notificações de pedidos do app</strong>
            <small className="muted">O destino é o WhatsApp cadastrado nas configurações de entrega da loja.</small>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={appNotifications.enabled}
                onChange={(e) => setAppNotifications({
                  ...appNotifications,
                  enabled: e.target.checked,
                  fallbackEnabled: e.target.checked && appNotifications.fallbackEnabled,
                })} />
              Receber notificações pela instância da loja
            </label>
            {appNotifications.enabled && <>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Instância principal da loja</span>
                <select className="input" value={appNotifications.instanceId}
                  onChange={(e) => setAppNotifications({ ...appNotifications, instanceId: e.target.value })}>
                  <option value="">Selecione uma instância</option>
                  {notificationInstances.filter((instance) => (instance.storeId === Number(storeId)
                    || String(instance.id) === appNotifications.instanceId)
                    && (instance.connected || String(instance.id) === appNotifications.instanceId)).map((instance) => (
                    <option key={instance.id} value={instance.id}>
                      {instance.label || instance.metaPhoneDisplay || instance.name}
                      {instance.storeId === null ? ' · conta do administrador (configuração anterior)' : ''}
                      {instance.connected ? '' : ' · desconectada'}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={appNotifications.fallbackEnabled}
                  disabled={!appNotifications.fallbackEnabled && !notificationInstances.some((instance) => instance.storeId === null && instance.connected)}
                  onChange={(e) => setAppNotifications({ ...appNotifications, fallbackEnabled: e.target.checked })} />
                Se houver falha, usar uma instância da conta do administrador
              </label>
              {appNotifications.fallbackEnabled && <label style={{ display: 'grid', gap: 4 }}>
                <span>Instância reserva do administrador</span>
                <select className="input" value={appNotifications.fallbackInstanceId}
                  onChange={(e) => setAppNotifications({ ...appNotifications, fallbackInstanceId: e.target.value })}>
                  <option value="">Selecione uma instância</option>
                  {notificationInstances.filter((instance) => instance.storeId === null
                    && (instance.connected || String(instance.id) === appNotifications.fallbackInstanceId)).map((instance) => (
                    <option key={instance.id} value={instance.id}>
                      {instance.label || instance.metaPhoneDisplay || instance.name}{instance.connected ? '' : ' · desconectada'}
                    </option>
                  ))}
                </select>
                <small className="muted">A instância reserva só será usada quando o envio pela instância da loja falhar.</small>
              </label>}
              {!notificationInstances.some((instance) => instance.storeId === Number(storeId) && instance.connected)
                && <small className="muted">Conecte uma instância de envio nesta loja para receber notificações.</small>}
            </>}
          </section>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Quantidade de acessos permitidos nesta loja</span>
            <input className="input" type="number" min="1" max={data.maxAppUsers} step="1" value={cfg.userLimit}
              onChange={(e) => setCfg({ ...cfg, userLimit: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Quantidade de acessos permitidos nesta loja" />
            <small className="muted">Seu plano permite até {data.maxAppUsers} acessos por aplicativo. Acessos desativados também ocupam uma vaga.</small>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Limite de produtos deste app</span>
            <input className="input" type="number" min="0" max={data.maxAppProducts} step="1" value={cfg.productLimit}
              onChange={(e) => setCfg({ ...cfg, productLimit: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Limite de produtos do app" />
            <small className="muted">Até {data.maxAppProducts} produtos, respeitando o limite global do seu plano e adicionais.</small>
          </label>
          {data.availablePerms.includes('auditoria') && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={cfg.auditEnabled} disabled={!cfg.auditEnabled && data.maxAppAuditInstances < 1} onChange={(e) => setCfg({
              ...cfg,
              auditEnabled: e.target.checked,
              auditInstanceLimit: e.target.checked ? Math.min(data.maxAppAuditInstances, Math.max(1, Number(cfg.auditInstanceLimit) || 0)) : 0,
            })} />
            Liberar auditoria neste aplicativo
          </label>}
          {data.availablePerms.includes('auditoria') && cfg.auditEnabled && <label style={{ display: 'grid', gap: 4 }}>
            <span>Conexões de auditoria liberadas para este app</span>
            <input className="input" type="number" min="1" max={data.maxAppAuditInstances} step="1" value={cfg.auditInstanceLimit}
              onChange={(e) => setCfg({ ...cfg, auditInstanceLimit: e.target.value === '' ? '' : Number(e.target.value) })}
              aria-label="Limite de conexões de auditoria do app" />
            <small className="muted">Disponível: {data.maxAppAuditInstances}. Cada vaga reservada é descontada do limite da sua conta e dos outros apps.</small>
          </label>}
          {data.availablePerms.includes('auditoria') && !cfg.auditEnabled && data.maxAppAuditInstances < 1 && <p className="muted small">Não há vagas de auditoria disponíveis. Reduza o limite de outro app ou amplie o limite da conta.</p>}
          {data.users.length > data.maxAppUsers && <p className="muted small">Há {data.users.length} acessos cadastrados, acima do limite atual do plano. Exclua acessos excedentes para adequar a quantidade.</p>}
          <button className="btn btn-primary" disabled={busy || cfg.auditEnabled && (!Number.isInteger(Number(cfg.auditInstanceLimit)) || Number(cfg.auditInstanceLimit) < 1 || Number(cfg.auditInstanceLimit) > data.maxAppAuditInstances)} onClick={() => run(() => api.put(`/stores/${storeId}/app`, { ...cfg, appNotifications }), 'Aplicativo salvo.')}>Salvar aplicativo</button>

          <h3 style={{ margin: '8px 0 0' }}>Acessos de lojistas ({data.users.length}/{Math.min(cfg.userLimit || 0, data.maxAppUsers)})</h3>
          {!data.users.length && <p className="muted small">Nenhum acesso criado.</p>}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {data.users.map((u) => (
              <li key={u.id} style={{ display: 'grid', gap: 6, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{u.name}</strong> <code>{u.login}</code>
                  {u.isPrimary && <span className="pill pill-sent">Principal</span>}
                  <span className={`pill ${u.active ? 'pill-sent' : 'pill-failed'}`}>{u.active ? 'Ativo' : 'Desativado'}</span>
                  {u.mustChangePassword && <span className="pill">Senha provisória</span>}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.patch(`/stores/${storeId}/app/users/${u.id}`, { active: !u.active }))}>{u.active ? 'Desativar' : 'Ativar'}</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
                      if (window.confirm(`Criar uma senha provisória para ${u.name}? O usuário precisará cadastrar uma senha nova ao entrar.`)) {
                        run(async () => {
                          const result = await api.post(`/stores/${storeId}/app/users/${u.id}/reset-password`);
                          setTemporaryCredential({ name: u.name, password: result.temporaryPassword });
                        }, 'Senha provisória criada.');
                      }
                    }}>Resetar senha</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { if (window.confirm(`Excluir o acesso de ${u.name}?`)) run(() => api.del(`/stores/${storeId}/app/users/${u.id}`), 'Acesso excluído.'); }}>Excluir</button>
                  </span>
                </div>
                <PermChecks labels={permissionLabels} value={u.perms.filter((perm) => permissionLabels.some(([key]) => key === perm))} disabled={busy} onChange={(perms) => perms.length && run(() => api.patch(`/stores/${storeId}/app/users/${u.id}`, { perms }), 'Permissões salvas.')} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong className="small">Fluxos de estoque</strong>
                  {data.flows.map((flow) => <label key={flow.id} className="small">
                    <input type="checkbox" checked={u.stockFlowIds.includes(flow.id)} disabled={busy}
                      onChange={(e) => {
                        const stockFlowIds = e.target.checked ? [...u.stockFlowIds, flow.id] : u.stockFlowIds.filter((id) => id !== flow.id);
                        run(() => api.patch(`/stores/${storeId}/app/users/${u.id}`, { stockFlowIds }), 'Fluxos atualizados.');
                      }} /> {flow.name}{flow.isDefault ? ' (padrão)' : ''}
                  </label>)}
                </div>
                <button className="btn btn-ghost btn-sm" disabled={busy}
                  onClick={() => run(() => api.patch(`/stores/${storeId}/app/users/${u.id}`, { isPrimary: !u.isPrimary }), u.isPrimary ? 'Usuário principal removido.' : 'Usuário principal atualizado.')}>
                  {u.isPrimary ? 'Remover principal' : 'Definir como principal'}
                </button>
              </li>
            ))}
          </ul>

          <div style={{ display: 'grid', gap: 8 }}>
            <input className="input" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="Nome do lojista" maxLength={80} aria-label="Nome do lojista" />
            <input className="input" value={nu.login} onChange={(e) => setNu({ ...nu, login: e.target.value })} placeholder="Usuário de acesso" maxLength={80} autoCapitalize="none" aria-label="Usuário de acesso" />
            <p className="muted small" style={{ margin: 0 }}>Uma senha provisória será gerada após criar o acesso. O usuário deverá cadastrar uma senha nova ao entrar.</p>
            <strong className="small">O que este acesso pode usar:</strong>
            <PermChecks labels={permissionLabels} value={nu.perms.filter((perm) => permissionLabels.some(([key]) => key === perm))} onChange={(perms) => setNu({ ...nu, perms })} />
            <strong className="small">Fluxos de estoque permitidos:</strong>
            <div style={{ display: 'flex', gap: '4px 14px', flexWrap: 'wrap' }}>
              {data.flows.map((flow) => <label key={flow.id} className="small">
                <input type="checkbox" checked={nu.stockFlowIds.includes(flow.id)}
                  onChange={(e) => setNu({ ...nu, stockFlowIds: e.target.checked ? [...nu.stockFlowIds, flow.id] : nu.stockFlowIds.filter((id) => id !== flow.id) })} />
                {' '}{flow.name}{flow.isDefault ? ' (padrão)' : ''}
              </label>)}
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={nu.isPrimary} onChange={(e) => setNu({ ...nu, isPrimary: e.target.checked })} />
              Este será o usuário principal e poderá delegar apenas os acessos que recebeu
            </label>
            <button className="btn btn-primary" disabled={busy || data.users.length >= Math.min(cfg.userLimit || 0, data.maxAppUsers) || !nu.name.trim() || !nu.login.trim() || !nu.perms.some((perm) => permissionLabels.some(([key]) => key === perm))}
              onClick={() => run(async () => {
                const perms = nu.perms.filter((perm) => permissionLabels.some(([key]) => key === perm));
                const result = await api.post(`/stores/${storeId}/app/users`, { ...nu, perms });
                setTemporaryCredential({ name: result.user.name, password: result.temporaryPassword });
                setNu({ name: '', login: '', perms: data.availablePerms.filter((perm) => perm !== 'auditoria' || cfg.auditEnabled), stockFlowIds: data.flows.map((flow) => flow.id), isPrimary: false });
              }, 'Acesso criado.')}>Criar acesso</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
