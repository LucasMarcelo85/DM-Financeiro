import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { copyText } from '../lib/portfolio/share.js';
import { SHOP_PERMISSION_GROUPS } from '../lib/shop-permissions.js';

const ALL_PERMS = SHOP_PERMISSION_GROUPS.flatMap(({ permissions }) => permissions.map(([key]) => key));
const LIMIT_FIELDS = [
  ['wsInstances', 'WhatsApps de envio (cobranças e notificações; auditoria usa conexões separadas)'],
  ['contracts', 'Contratos'],
  ['apiTokens', 'Tokens de API'],
  ['aiAgents', 'Agentes de IA'],
];

// Cada menu que o dono tem pode ser liberado inteiro para o acesso; não há ver/criar/editar/excluir separados.
function PermMatrix({ groups, perms, disabled, onChange }) {
  const labels = groups.flatMap(({ permissions }) => permissions);
  function toggle(key, on) {
    const next = labels.map(([permission]) => permission).filter((permission) => (permission === key ? on : perms.includes(permission)));
    onChange({ perms: next, actions: {} });
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {groups.map(({ title, permissions }) => (
        <section key={title} style={{ display: 'grid', gap: 7 }}>
          <strong className="small">{title}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '10px 14px' }}>
            {permissions.map(([key, label, description]) => (
              <label key={key} className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', alignItems: 'start' }}>
                <input type="checkbox" disabled={disabled} checked={perms.includes(key)} onChange={(e) => toggle(key, e.target.checked)} />
                <span><strong>{label}</strong><small className="muted" style={{ display: 'block' }}>{description}</small></span>
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// "Criar app" da loja: nome, cor, link de instalação e os acessos dos lojistas.
export default function StoreAppModal({ storeId, onClose }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState({ enabled: false, name: '', color: '#F2A33A', userLimit: 10, productLimit: 0, auditEnabled: false, auditInstanceLimit: 0, limits: {} });
  const [appNotifications, setAppNotifications] = useState({ fallbackEnabled: false, fallbackInstanceId: '' });
  const [notificationInstances, setNotificationInstances] = useState([]);
  const [nu, setNu] = useState({ name: '', login: '', perms: ALL_PERMS, actions: {}, stockFlowIds: [], isPrimary: false });
  const [temporaryCredential, setTemporaryCredential] = useState(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const initializedFlowsStoreId = useRef(null);
  const permissionGroups = SHOP_PERMISSION_GROUPS.map(({ title, permissions }) => ({
    title,
    permissions: permissions.filter(([key]) => (data?.availablePerms || ALL_PERMS).includes(key)
      && (key !== 'auditoria' || cfg.auditEnabled && Number(cfg.auditInstanceLimit) > 0)),
  })).filter(({ permissions }) => permissions.length > 0);
  const permissionLabels = permissionGroups.flatMap(({ permissions }) => permissions);

  const load = useCallback((preserveConfig = false) => Promise.all([
    api.get(`/stores/${storeId}/app`),
    api.get(`/instances?store=${storeId}&includeOwner=1`),
  ]).then(([r, connectionData]) => {
    setData(r);
    setNotificationInstances(connectionData.instances || []);
    if (!preserveConfig) {
      setAppNotifications({
        fallbackEnabled: r.appNotifications.fallbackEnabled,
        fallbackInstanceId: r.appNotifications.fallbackInstanceId,
      });
      setCfg({
        enabled: r.store.app.enabled, name: r.store.app.name, color: r.store.app.color || '#F2A33A',
        userLimit: r.store.app.userLimit, productLimit: r.store.app.productLimit ?? r.maxAppProducts,
        auditEnabled: r.store.app.auditEnabled, auditInstanceLimit: r.store.app.auditInstanceLimit,
        limits: r.store.app.limits || {},
      });
    }
    if (initializedFlowsStoreId.current !== storeId) {
      initializedFlowsStoreId.current = storeId;
      setNu((current) => ({ ...current, stockFlowIds: r.flows.map((flow) => flow.id) }));
    }
  }).catch((e) => toast(e.message, 'error')), [storeId, toast]);
  useEffect(() => { load(); }, [load]);

  async function run(fn, ok, preserveConfig = true) {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); await load(preserveConfig); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
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
    <Modal title="Aplicativo da loja" onClose={onClose} wide>
      {!data ? <p className="muted">Carregando...</p> : (
        <div className="sapp" style={{ display: 'grid', gap: 14 }}>
          <p className="muted small">O lojista instala este aplicativo no celular. Configure o app em etapas; as alterações gerais só são aplicadas ao clicar em “Salvar configuração”.</p>
          {temporaryCredential && <section className="banner" style={{ display: 'grid', gap: 8 }}>
            <strong>Acesso de {temporaryCredential.name}</strong>
            <p className="muted small" style={{ margin: 0 }}>Envie o usuário e a senha provisória. No primeiro acesso, será necessário cadastrar uma senha nova. A senha provisória não será exibida novamente.</p>
            <span className="small">Usuário: <code>{temporaryCredential.login}</code></span>
            <code style={{ fontSize: 16, userSelect: 'all' }}>{temporaryCredential.password}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => toast((await copyText(temporaryCredential.password)) ? 'Senha copiada!' : 'Copie a senha manualmente.')}>Copiar senha</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => toast((await copyText(`Link: ${link}\nUsuário: ${temporaryCredential.login}\nSenha provisória: ${temporaryCredential.password}`)) ? 'Link e dados de acesso copiados!' : 'Copie o link e os dados de acesso manualmente.')}>Copiar link e dados de acesso</button>
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

          <nav className="sapp-steps" aria-label="Etapas da configuração do aplicativo">
            {[
              ['Configuração', 'Nome, notificações e limites'],
              ['Acessos', `${data.users.length} usuário(s) cadastrado(s)`],
              ['Novo acesso', 'Criar usuário e permissões'],
            ].map(([label, hint], index) => (
              <button type="button" className={`sapp-step${step === index ? ' is-active' : ''}`} key={label} onClick={() => setStep(index)} aria-current={step === index ? 'step' : undefined}>
                <span className="sapp-step-number">{index + 1}</span>
                <span><strong>{label}</strong><small>{hint}</small></span>
              </button>
            ))}
          </nav>

          {step === 0 && <>
          <section className="sapp-section">
            <header><span className="sapp-section-number">1</span><div><h3>Configuração do aplicativo</h3><p className="muted small">Defina a aparência, notificações e os limites disponíveis para esta loja.</p></div></header>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={cfg.enabled} disabled={!data.appAvailable} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Aplicativo ativo
          </label>
          {!data.appAvailable && <p className="muted small">O plano atual não inclui lojas com aplicativo.</p>}
          <label className="field"><span>Nome exibido no aplicativo</span><input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} placeholder={`Padrão: ${store.name}`} maxLength={40} /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>Cor principal do aplicativo</span><input type="color" value={cfg.color} onChange={(e) => setCfg({ ...cfg, color: e.target.value })} />
          </label>
          </section>

          <section className="sapp-section">
            <header><span className="sapp-section-number">2</span><div><h3>Instância reserva para notificações</h3><p className="muted small">Será usada se a instância principal do app falhar ou não estiver configurada.</p></div></header>
          <section className="banner" style={{ display: 'grid', gap: 10 }}>
            <strong>Usar uma instância do administrador como reserva</strong>
            <small className="muted">Ela será usada se a instância principal escolhida pelo usuário do app falhar ou não estiver configurada.</small>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={appNotifications.fallbackEnabled}
                disabled={!appNotifications.fallbackEnabled && !notificationInstances.some((instance) => instance.storeId === null && instance.connected)}
                onChange={(e) => setAppNotifications({
                  ...appNotifications,
                  fallbackEnabled: e.target.checked,
                  fallbackInstanceId: e.target.checked ? appNotifications.fallbackInstanceId : '',
                })} />
              Se falhar ou não houver instância principal, usar uma instância da conta do administrador
            </label>
            {!appNotifications.fallbackEnabled && !notificationInstances.some((instance) => instance.storeId === null && instance.connected)
              && <small className="muted">Conecte uma instância na conta do administrador para habilitar a reserva.</small>}
            {appNotifications.fallbackEnabled && <>
              <label style={{ display: 'grid', gap: 4 }}>
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
              </label>
              <small className="muted">A instância principal e o destino dos avisos são configurados pelo usuário do app.</small>
            </>}
          </section>
          </section>

          <section className="sapp-section">
            <header><span className="sapp-section-number">3</span><div><h3>Limites e recursos do app</h3><p className="muted small">Os valores abaixo são reservados dentro dos limites do seu plano.</p></div></header>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Quantidade máxima de acessos nesta loja</span>
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
          <section className="banner" style={{ display: 'grid', gap: 10 }}>
            <strong>Limites repartidos com este app</strong>
            <small className="muted">Cada app tem dados próprios (clientes, lembretes, contratos, portfólio e IA). Eles saem do limite do seu plano e nunca passam dele. Em branco = sem permissão para o recurso (WhatsApp, contratos e portfólio) ou sem teto (demais). Na IA, quem usa o app informa o próprio token.</small>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>WhatsApps de envio de pedidos (disponível: {data.maxAppInstances})</span>
              <input className="input" type="number" min="0" max={data.maxAppInstances} step="1" value={cfg.limits.instances ?? ''}
                onChange={(e) => setCfg({ ...cfg, limits: { ...cfg.limits, instances: e.target.value === '' ? '' : Number(e.target.value) } })} aria-label="WhatsApps de envio do app" />
            </label>
            {LIMIT_FIELDS.map(([key, label]) => {
              const room = data.limitRoom?.[key];
              return (
                <label key={key} style={{ display: 'grid', gap: 4 }}>
                  <span>{label}{room !== undefined ? ` (disponível: ${room})` : ''}</span>
                  <input className="input" type="number" min="0" max={room} step="1" value={cfg.limits[key] ?? ''}
                    onChange={(e) => setCfg({ ...cfg, limits: { ...cfg.limits, [key]: e.target.value === '' ? '' : Number(e.target.value) } })} aria-label={`${label} do app`} />
                </label>
              );
            })}
          </section>
          {data.users.length > data.maxAppUsers && <p className="muted small">Há {data.users.length} acessos cadastrados, acima do limite atual do plano. Exclua acessos excedentes para adequar a quantidade.</p>}
          <button className="btn btn-primary" disabled={busy || cfg.auditEnabled && (!Number.isInteger(Number(cfg.auditInstanceLimit)) || Number(cfg.auditInstanceLimit) < 1 || Number(cfg.auditInstanceLimit) > data.maxAppAuditInstances)} onClick={() => run(() => api.put(`/stores/${storeId}/app`, { ...cfg, appNotifications }), 'Configuração do app salva.', false)}>Salvar configuração</button>
          </section>
          </>}

          {step === 1 && <>
          <section className="sapp-section">
            <header><span className="sapp-section-number">2</span><div><h3>Acessos de lojistas</h3><p className="muted small">{data.users.length} cadastrados · limite desta loja: {Math.min(cfg.userLimit || 0, data.maxAppUsers)}. Gerencie contas, permissões e fluxos de estoque.</p></div></header>
          <div className="sapp-user-toolbar"><span className="muted small">Cada usuário só pode acessar as áreas e operações liberadas.</span><button type="button" className="btn btn-primary btn-sm" onClick={() => setStep(2)} disabled={busy || data.users.length >= Math.min(cfg.userLimit || 0, data.maxAppUsers)}>Criar novo acesso</button></div>
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
                          setTemporaryCredential({ name: u.name, login: u.login, password: result.temporaryPassword });
                        }, 'Senha provisória criada.');
                      }
                    }}>Resetar senha</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { if (window.confirm(`Excluir o acesso de ${u.name}?`)) run(() => api.del(`/stores/${storeId}/app/users/${u.id}`), 'Acesso excluído.'); }}>Excluir</button>
                  </span>
                </div>
                <details className="sapp-user-details">
                  <summary>Permissões, estoque e usuário principal</summary>
                  <PermMatrix groups={permissionGroups} perms={u.perms} disabled={busy}
                    onChange={({ perms, actions }) => perms.length && run(() => api.patch(`/stores/${storeId}/app/users/${u.id}`, { perms, actions }), 'Permissões salvas.')} />
                  <div className="sapp-flow-list">
                    <strong className="small">Fluxos de estoque permitidos</strong>
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
                </details>
              </li>
            ))}
          </ul>
          {!data.users.length && <button type="button" className="btn btn-primary" onClick={() => setStep(2)} disabled={busy || data.users.length >= Math.min(cfg.userLimit || 0, data.maxAppUsers)}>Criar primeiro acesso</button>}
          </section>
          </>}

          {step === 2 && <>
          <section className="sapp-section">
            <header><span className="sapp-section-number">3</span><div><h3>Criar acesso de lojista</h3><p className="muted small">Defina a conta e escolha exatamente o que essa pessoa poderá acessar.</p></div></header>
            <div className="sapp-create-user-summary"><strong>{data.users.length} de {Math.min(cfg.userLimit || 0, data.maxAppUsers)} acessos usados</strong><button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(1)}>Ver acessos existentes</button></div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label className="field"><span>Nome da pessoa</span><input className="input" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="Ex.: Maria Silva" maxLength={80} /></label>
            <label className="field"><span>Nome de usuário para entrar</span><input className="input" value={nu.login} onChange={(e) => setNu({ ...nu, login: e.target.value })} placeholder="Ex.: maria.loja" maxLength={80} autoCapitalize="none" /></label>
            <p className="muted small" style={{ margin: 0 }}>Uma senha provisória será gerada após criar o acesso. O usuário deverá cadastrar uma senha nova ao entrar.</p>
            <details className="sapp-create-perms" open>
              <summary>Áreas que esta pessoa poderá usar ({nu.perms.filter((perm) => permissionLabels.some(([key]) => key === perm)).length} selecionadas)</summary>
              <p className="muted small">WhatsApp de envio é usado em cobranças e notificações. Auditoria usa conexões próprias, separadas. Liberar uma área não conecta o WhatsApp automaticamente.</p>
              <PermMatrix groups={permissionGroups} perms={nu.perms.filter((perm) => permissionLabels.some(([key]) => key === perm))}
                onChange={({ perms, actions }) => setNu({ ...nu, perms, actions })} />
            </details>
            <details className="sapp-create-perms">
              <summary>Fluxos de estoque permitidos ({nu.stockFlowIds.length})</summary>
              <div className="sapp-flow-list">
              {data.flows.map((flow) => <label key={flow.id} className="small">
                <input type="checkbox" checked={nu.stockFlowIds.includes(flow.id)}
                  onChange={(e) => setNu({ ...nu, stockFlowIds: e.target.checked ? [...nu.stockFlowIds, flow.id] : nu.stockFlowIds.filter((id) => id !== flow.id) })} />
                {' '}{flow.name}{flow.isDefault ? ' (padrão)' : ''}
              </label>)}
              </div>
            </details>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={nu.isPrimary} onChange={(e) => setNu({ ...nu, isPrimary: e.target.checked })} />
              Este será o usuário principal e poderá delegar apenas os acessos que recebeu
            </label>
            <button className="btn btn-primary" disabled={busy || data.users.length >= Math.min(cfg.userLimit || 0, data.maxAppUsers) || !nu.name.trim() || !nu.login.trim() || !nu.perms.some((perm) => permissionLabels.some(([key]) => key === perm))}
              onClick={() => run(async () => {
                const perms = nu.perms.filter((perm) => permissionLabels.some(([key]) => key === perm));
                const result = await api.post(`/stores/${storeId}/app/users`, { ...nu, perms });
                setTemporaryCredential({ name: result.user.name, login: result.user.login, password: result.temporaryPassword });
                setNu({ name: '', login: '', perms: data.availablePerms.filter((perm) => perm !== 'auditoria' || cfg.auditEnabled), actions: {}, stockFlowIds: data.flows.map((flow) => flow.id), isPrimary: false });
              }, 'Acesso criado.')}>Criar acesso</button>
          </div>
          </section>
          </>}
        </div>
      )}
    </Modal>
  );
}
