import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, getShopToken, setShopToken, setWorkspaceMode } from '../api.js';
import WorkspaceSection, { WORKSPACE_TABS } from '../components/WorkspaceSection.jsx';
import { useToast } from '../components/Toast.jsx';
import Modal from '../components/Modal.jsx';
import Products from './Products.jsx';
import Orders from './Orders.jsx';
import Api from './Api.jsx';
import Audit from './Audit.jsx';
import CatalogSettings from '../components/CatalogSettings.jsx';
import Icon from '../components/Icon.jsx';
import { SHOP_PERMISSION_GROUPS } from '../lib/shop-permissions.js';

const TABS = [
  ['produtos', 'Produtos'],
  ['equipe', 'Gerenciar acessos'],
  ['pedidos', 'Pedidos e clientes do catálogo e PDV'],
  ['pdv', 'Frente de caixa'],
  ['api', 'API e webhooks'],
  ['auditoria', 'Auditoria WhatsApp'],
  ['whatsapp', 'WhatsApp'],
  ['contatos', 'Clientes de cobranças'],
  ['cobrancas', 'Cobranças'],
  ['contratos', 'Contratos'],
  ['portfolio', 'Portfólio'],
  ['ia', 'IA'],
];
const tabsFor = (perms = [], isPrimary = false) => TABS.filter(([key]) => key === 'produtos'
  ? perms.includes(key) || perms.includes('estoque')
  : key === 'whatsapp'
    ? perms.includes('whatsapp') || perms.includes('entregas')
    : key === 'equipe'
      ? isPrimary
      : key === 'pedidos'
        ? ['pedidos', 'clientes', 'arquivados', 'estrategia'].some((perm) => perms.includes(perm))
        : perms.includes(key));
const firstTab = (perms, isPrimary) => tabsFor(perms, isPrimary)[0]?.[0] || '';
const TAB_ICONS = {
  produtos: 'box', equipe: 'users', pedidos: 'receipt', pdv: 'cart', api: 'link',
  auditoria: 'eye', whatsapp: 'chat', contatos: 'user', cobrancas: 'money',
  contratos: 'file', portfolio: 'globe', ia: 'sparkles',
};
const foregroundFor = (color) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1] || 'F2A33A';
  const channel = (offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = channel(0) * 0.2126 + channel(2) * 0.7152 + channel(4) * 0.0722;
  const darkContrast = (luminance + 0.05) / 0.017;
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast ? '#14202E' : '#FFFFFF';
};

// Aplicativo do lojista, instalável no celular: o nome e a cor vêm da configuração da loja e o endereço é o do próprio site da loja.
export default function ShopApp() {
  const { slug } = useParams();
  const toast = useToast();
  const q = slug ? `?u=${encodeURIComponent(slug)}` : '';
  const [info, setInfo] = useState(null);
  const [missing, setMissing] = useState(false);
  const [authed, setAuthed] = useState(Boolean(getShopToken()));
  const [profile, setProfile] = useState(null);
  const [appStoreId, setAppStoreId] = useState(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [perms, setPerms] = useState(null);
  const [isPrimary, setIsPrimary] = useState(false);
  const [tab, setTab] = useState('');
  const [auditCanSend, setAuditCanSend] = useState(false);
  const [catalogSettingsOpen, setCatalogSettingsOpen] = useState(false);
  const [form, setForm] = useState({ login: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    if (!authed) { setPerms(null); setProfile(null); setMustChangePassword(false); return; }
    let active = true;
    api.get('/shop-app/me').then((r) => {
      if (!active) return;
      setProfile(r.user);
      setAppStoreId(r.app.id);
      setMustChangePassword(Boolean(r.user.mustChangePassword));
      setPerms(r.user.perms);
      setIsPrimary(Boolean(r.user.isPrimary));
      const allowedTabs = tabsFor(r.user.perms, r.user.isPrimary).map(([key]) => key);
      setTab((current) => allowedTabs.includes(current) ? current : firstTab(r.user.perms, r.user.isPrimary));
      setAuditCanSend(Boolean(r.app.auditSend));
    }).catch((e) => { if (active && e.status !== 401) toast(e.message, 'error'); });
    return () => { active = false; };
  }, [authed]);

  useEffect(() => {
    api.get(`/shop-app/info${q}`).then(setInfo).catch(() => setMissing(true));
  }, [q]);

  useEffect(() => {
    const out = (event) => {
      setAuthed(false);
      setLoginError(event.detail?.message || 'Sua sessão expirou. Entre novamente no aplicativo.');
    };
    window.addEventListener('dm:shop-logout', out);
    return () => window.removeEventListener('dm:shop-logout', out);
  }, []);

  useEffect(() => {
    const requirePasswordChange = () => setMustChangePassword(true);
    window.addEventListener('dm:shop-password-required', requirePasswordChange);
    return () => window.removeEventListener('dm:shop-password-required', requirePasswordChange);
  }, []);

  useEffect(() => {
    if (!info) return undefined;
    document.title = info.name;
    let theme = document.querySelector('meta[name="theme-color"]');
    if (!theme) { theme = document.createElement('meta'); theme.name = 'theme-color'; document.head.appendChild(theme); }
    theme.content = info.color;
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = `/api/shop-app/manifest${q}`;
    document.head.appendChild(link);
    return () => link.remove();
  }, [info, q]);

  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setLoginError('');
    try {
      const r = await api.post('/shop-app/login', { u: slug, login: form.login, password: form.password });
      setShopToken(r.token);
      setProfile(r.user);
      setAppStoreId(r.app.id);
      setMustChangePassword(Boolean(r.user.mustChangePassword));
      setPerms(r.user.perms);
      setIsPrimary(Boolean(r.user.isPrimary));
      setTab(firstTab(r.user.perms, r.user.isPrimary));
      setAuditCanSend(Boolean(r.app.auditSend));
      setForm((current) => ({ ...current, password: '' }));
      setAuthed(true);
    } catch (err) {
      setLoginError(err.message);
      toast(err.message, 'error');
    } finally { setBusy(false); }
  }

  async function changePassword(event) {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast('A confirmação da nova senha não confere.', 'error');
      return;
    }
    setPasswordBusy(true);
    try {
      const result = await api.post('/shop-app/password', {
        ...(!mustChangePassword ? { currentPassword: passwordForm.currentPassword } : {}),
        newPassword: passwordForm.newPassword,
      });
      setProfile(result.user);
      setMustChangePassword(false);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowNewPassword(false);
      setAccountOpen(false);
      toast(mustChangePassword ? 'Senha cadastrada. Use essa senha nos próximos acessos.' : 'Senha atualizada.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setPasswordBusy(false);
    }
  }

  function logout() {
    setShopToken(null);
    setForm((current) => ({ ...current, password: '' }));
    setShowLoginPassword(false);
    setShowNewPassword(false);
    setAuthed(false);
  }

  if (missing) return <main style={{ padding: 32, textAlign: 'center' }}><h1>Aplicativo indisponível</h1><p className="muted">Confira o endereço com a loja.</p></main>;
  if (!info) return <main style={{ padding: 32 }}><p className="muted">Carregando...</p></main>;

  const color = info.color || '#F2A33A';
  const foreground = foregroundFor(color);
  const bar = { background: color, color: foreground, '--shop-app-bg': color, '--shop-app-fg': foreground, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' };

  if (!authed) {
    return (
      <>
        <header style={bar}><strong style={{ fontSize: 18 }}>{info.name}</strong></header>
        <form onSubmit={login} style={{ width: 'min(calc(100% - 32px), 26rem)', margin: 'clamp(24px, 8vh, 64px) auto', padding: 'clamp(20px, 4vw, 32px)', display: 'grid', gap: 16, background: '#fff', border: '1px solid var(--line)', borderRadius: 16, boxShadow: '0 12px 36px #0f223814' }}>
          <h1 style={{ margin: 0 }}>Entrar</h1>
          <label className="field"><span>Usuário</span><input className="input" value={form.login} onChange={(e) => { setLoginError(''); setForm({ ...form, login: e.target.value }); }} placeholder="Digite o usuário fornecido pela loja" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" aria-label="Usuário" required /></label>
          <label className="field"><span>Senha</span><input className="input" type={showLoginPassword ? 'text' : 'password'} value={form.password} onChange={(e) => { setLoginError(''); setForm({ ...form, password: e.target.value }); }} placeholder="Digite sua senha" autoComplete="current-password" aria-label="Senha" required /></label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowLoginPassword((visible) => !visible)}>{showLoginPassword ? 'Ocultar senha' : 'Mostrar senha'}</button>
          {loginError && <p className="form-error" role="alert">{loginError}</p>}
          <button className="btn btn-primary" style={{ minHeight: 48, fontSize: 16 }} disabled={busy || !form.login.trim() || !form.password}>{busy ? 'Entrando...' : 'Entrar'}</button>
        </form>
      </>
    );
  }

  if (mustChangePassword) {
    return (
      <>
        <header style={bar}>
          <strong style={{ fontSize: 18 }}>{info.name}</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>Sair</button>
        </header>
        <form onSubmit={changePassword} style={{ maxWidth: 420, margin: '40px auto', padding: 16, display: 'grid', gap: 12 }}>
          <h1 style={{ margin: 0 }}>Cadastre sua senha</h1>
          <p className="muted" style={{ margin: 0 }}>Esta é uma senha provisória. Para continuar, escolha uma senha nova com pelo menos 6 caracteres.</p>
          <label className="field"><span>Nova senha</span><input className="input" type={showNewPassword ? 'text' : 'password'} value={passwordForm.newPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
            placeholder="Nova senha" autoComplete="new-password" aria-label="Nova senha" minLength={6} maxLength={72} required /></label>
          <label className="field"><span>Confirme a nova senha</span><input className="input" type={showNewPassword ? 'text' : 'password'} value={passwordForm.confirmPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
            placeholder="Confirme a nova senha" autoComplete="new-password" aria-label="Confirme a nova senha" maxLength={72} required /></label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNewPassword((visible) => !visible)}>{showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}</button>
          <button className="btn btn-primary" disabled={passwordBusy || passwordForm.newPassword.length < 6 || !passwordForm.confirmPassword}>
            {passwordBusy ? 'Salvando...' : 'Cadastrar senha'}
          </button>
        </form>
      </>
    );
  }

  function TeamManagement() {
    const toast = useToast();
    const [data, setData] = useState(null);
    const [drafts, setDrafts] = useState({});
    const [busy, setBusy] = useState(false);

    async function load() {
      const result = await api.get('/team');
      setData(result);
      setDrafts(Object.fromEntries(result.users.map((user) => [user.id, {
        perms: user.perms,
        stockFlowIds: user.stockFlowIds,
        active: user.active,
      }])));
    }

    useEffect(() => {
      load().catch((error) => toast(error.message, 'error'));
    }, []);

    async function save(userId) {
      setBusy(true);
      try {
        await api.patch(`/team/users/${userId}`, drafts[userId]);
        await load();
        toast('Acesso atualizado.');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(false);
      }
    }

    if (!data) return <p className="muted">Carregando acessos...</p>;
    return (
      <section className="card shop-team">
        <header><div><h1>Gerenciar acessos</h1><p className="muted">Você só pode compartilhar as áreas e os fluxos de estoque liberados no seu próprio acesso. WhatsApp de envio (cobranças e notificações) e conexão de auditoria são recursos separados; liberar uma área não conecta um número.</p></div></header>
        {!data.users.length && <p className="muted">O criador ainda não cadastrou outros usuários.</p>}
        {data.users.map((user) => {
          const draft = drafts[user.id] || { perms: [], stockFlowIds: [], active: user.active };
          const permissionGroups = SHOP_PERMISSION_GROUPS.map(({ title, permissions }) => ({
            title,
            permissions: permissions.filter(([key]) => data.availablePerms.includes(key)),
          })).filter(({ permissions }) => permissions.length > 0);
          return (
            <article className="shop-team-user" key={user.id}>
              <div className="shop-team-user-head">
                <strong>{user.name}</strong><code>{user.login}</code>
                <label className="small"><input type="checkbox" checked={draft.active} onChange={(event) => setDrafts((rows) => ({ ...rows, [user.id]: { ...draft, active: event.target.checked } }))} /> Ativo</label>
              </div>
              <strong className="small">Áreas liberadas</strong>
              <div style={{ display: 'grid', gap: 14 }}>
                {permissionGroups.map(({ title, permissions }) => <section key={title} style={{ display: 'grid', gap: 7 }}>
                  <strong className="small">{title}</strong>
                  <div className="shop-team-options">
                    {permissions.map(([key, label, description]) => <label key={key} className="small">
                      <input type="checkbox" checked={draft.perms.includes(key)} onChange={(event) => setDrafts((rows) => ({
                        ...rows,
                        [user.id]: { ...draft, perms: event.target.checked ? [...draft.perms, key] : draft.perms.filter((perm) => perm !== key) },
                      }))} /> {label}
                      <small className="muted" style={{ display: 'block', marginLeft: 24 }}>{description}</small>
                    </label>)}
                  </div>
                </section>)}
              </div>
              {draft.perms.includes('estoque') && <><strong className="small">Fluxos de estoque</strong>
                <div className="shop-team-options">
                  {data.flows.map((flow) => <label key={flow.id} className="small">
                    <input type="checkbox" checked={draft.stockFlowIds.includes(flow.id)} onChange={(event) => setDrafts((rows) => ({
                      ...rows,
                      [user.id]: { ...draft, stockFlowIds: event.target.checked ? [...draft.stockFlowIds, flow.id] : draft.stockFlowIds.filter((id) => id !== flow.id) },
                    }))} /> {flow.name}{flow.isDefault ? ' (padrão)' : ''}
                  </label>)}
                </div>
              </>}
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !draft.perms.length} onClick={() => save(user.id)}>Salvar acesso</button>
            </article>
          );
        })}
      </section>
    );
  }

  const tabs = tabsFor(perms || [], isPrimary);
  const otherTab = tabs.find(([key]) => key !== 'pdv')?.[0];
  setWorkspaceMode(WORKSPACE_TABS.includes(tab));

  return (
    <div className="shop-shell shell">
      <aside className="sidebar shop-sidebar">
        <div className="sidebar-top shop-sidebar-brand">
            <strong title={info.name}>{info.name}</strong>
        </div>
        <nav role="tablist" aria-label="Menu principal" className="nav shop-app-nav">
            {tabs.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} aria-controls="shop-app-panel"
                className={`nav-link ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)}>
                <Icon name={TAB_ICONS[key] || 'list'} size={19} /><span>{label}</span>
              </button>
          ))}
        </nav>
        <div className="sidebar-user shop-sidebar-user">
            <div className="sidebar-user-info">
              <strong title={profile?.name}>{profile?.name || info.name}</strong>
              <code title={profile?.login}>{profile?.login}</code>
            </div>
            <button className="btn btn-ghost-light btn-sm" onClick={() => setAccountOpen(true)}>
              <Icon name="gear" size={16} /> Usuário e senha
            </button>
            <button className="btn btn-ghost-light btn-sm" onClick={logout}>
              <Icon name="logout" size={16} /> Sair
            </button>
        </div>
      </aside>
      <main className="main shop-main">
        <header className="shop-main-head">
            <strong className="shop-main-title">{info.name}</strong>
            <div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAccountOpen(true)}><Icon name="gear" size={16} /> Usuário</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={logout}><Icon name="logout" size={16} /> Sair</button>
            </div>
        </header>
        <section id="shop-app-panel" role="tabpanel" aria-label={tabs.find(([key]) => key === tab)?.[1] || 'Área do aplicativo'} className={`shop-app-panel ${['pdv', 'pedidos', 'auditoria'].includes(tab) ? 'shop-panel-wide' : ''}`}>
            {!perms ? <p className="muted">Carregando...</p>
              : !tabs.length ? <p className="muted">Seu acesso ainda não tem nenhuma área liberada. Fale com a loja.</p>
            : tab === 'produtos' ? <Products allow={perms} />
                : tab === 'equipe' ? <TeamManagement />
                  : tab === 'pedidos' ? <Orders key="shop-orders" allow={perms} />
                    : tab === 'pdv' ? <Orders key="shop-pdv" allow={perms} initialTab="pos" onClosePOS={otherTab ? () => setTab(otherTab) : null} />
                      : tab === 'api' ? <Api />
                        : tab === 'auditoria' ? <Audit canReply={auditCanSend} />
                          : tab === 'whatsapp' ? <>
                            {perms.includes('entregas') && <section className="card" style={{ marginBottom: 16 }}>
                              <h2>Entregas e notificações do catálogo</h2>
                              <p className="muted">Configure frete, formas de entrega e o WhatsApp que recebe os avisos de novos pedidos.</p>
                              <button type="button" className="btn btn-primary" onClick={() => setCatalogSettingsOpen(true)}>Configurar entregas e notificações</button>
                            </section>}
                            <WorkspaceSection key={tab} area={tab} />
                            {catalogSettingsOpen && <CatalogSettings storeId={appStoreId} onClose={() => setCatalogSettingsOpen(false)} />}
                          </>
                            : WORKSPACE_TABS.includes(tab) ? <WorkspaceSection key={tab} area={tab} /> : null}
        </section>
      </main>
      {accountOpen && <Modal title="Usuário e senha" onClose={() => setAccountOpen(false)}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div><strong>Nome</strong><div>{profile?.name}</div></div>
          <div><strong>Usuário de acesso</strong><div><code>{profile?.login}</code></div></div>
          <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--line)' }} />
          <form onSubmit={changePassword} style={{ display: 'grid', gap: 10 }}>
            <strong>Trocar senha</strong>
            <input className="input" type="password" value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
              placeholder="Senha atual" autoComplete="current-password" aria-label="Senha atual" />
            <input className="input" type="password" value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              placeholder="Nova senha (mínimo 6 caracteres)" autoComplete="new-password" aria-label="Nova senha" />
            <input className="input" type="password" value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              placeholder="Confirme a nova senha" autoComplete="new-password" aria-label="Confirme a nova senha" />
            <button className="btn btn-primary" disabled={passwordBusy || !passwordForm.currentPassword || passwordForm.newPassword.length < 6 || !passwordForm.confirmPassword}>
              {passwordBusy ? 'Salvando...' : 'Trocar senha'}
            </button>
          </form>
        </div>
      </Modal>}
    </div>
  );
}
