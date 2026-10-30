import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, getShopToken, setShopToken } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import Products from './Products.jsx';
import Orders from './Orders.jsx';
import Api from './Api.jsx';
import Audit from './Audit.jsx';
import CatalogSettings from '../components/CatalogSettings.jsx';
import InstanceManager from '../components/InstanceManager.jsx';

const TABS = [
  ['produtos', 'Produtos'],
  ['equipe', 'Gerenciar acessos'],
  ['pedidos', 'Pedidos e clientes'],
  ['pdv', 'Frente de caixa'],
  ['entregas', 'Entregas e WhatsApp'],
  ['api', 'API e webhooks'],
  ['auditoria', 'Auditoria'],
];
const tabsFor = (perms = [], isPrimary = false) => TABS.filter(([key]) => key === 'produtos'
  ? perms.includes(key) || perms.includes('estoque')
  : key === 'equipe'
    ? isPrimary
    : key === 'pedidos'
      ? ['pedidos', 'clientes', 'arquivados', 'estrategia'].some((perm) => perms.includes(perm))
      : perms.includes(key));
const firstTab = (perms, isPrimary) => tabsFor(perms, isPrimary)[0]?.[0] || '';
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
  const [perms, setPerms] = useState(null);
  const [isPrimary, setIsPrimary] = useState(false);
  const [tab, setTab] = useState('');
  const [auditCanSend, setAuditCanSend] = useState(false);
  const [catalogSettingsOpen, setCatalogSettingsOpen] = useState(false);
  const [form, setForm] = useState({ login: '', password: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authed) { setPerms(null); return; }
    let active = true;
    api.get('/shop-app/me').then((r) => {
      if (!active) return;
      setPerms(r.user.perms);
      setIsPrimary(Boolean(r.user.isPrimary));
      const allowedTabs = tabsFor(r.user.perms, r.user.isPrimary).map(([key]) => key);
      setTab((current) => allowedTabs.includes(current) ? current : firstTab(r.user.perms, r.user.isPrimary));
      setAuditCanSend(Boolean(r.app.auditSend));
    }).catch((e) => { if (active) toast(e.message, 'error'); });
    return () => { active = false; };
  }, [authed]);

  useEffect(() => {
    api.get(`/shop-app/info${q}`).then(setInfo).catch(() => setMissing(true));
  }, [q]);

  useEffect(() => {
    const out = () => setAuthed(false);
    window.addEventListener('dm:shop-logout', out);
    return () => window.removeEventListener('dm:shop-logout', out);
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
    try {
      const r = await api.post('/shop-app/login', { u: slug, login: form.login, password: form.password });
      setShopToken(r.token);
      setPerms(r.user.perms);
      setIsPrimary(Boolean(r.user.isPrimary));
      setTab(firstTab(r.user.perms, r.user.isPrimary));
      setAuditCanSend(Boolean(r.app.auditSend));
      setAuthed(true);
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
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
        <form onSubmit={login} style={{ maxWidth: 360, margin: '40px auto', padding: 16, display: 'grid', gap: 12 }}>
          <h1 style={{ margin: 0 }}>Entrar</h1>
          <input className="input" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} placeholder="Usuário" autoCapitalize="none" autoComplete="username" aria-label="Usuário" />
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Senha" autoComplete="current-password" aria-label="Senha" />
          <button className="btn btn-primary" disabled={busy || !form.login || !form.password}>{busy ? 'Entrando...' : 'Entrar'}</button>
        </form>
      </>
    );
  }

  const TEAM_PERMS = [
    ['produtos', 'Produtos'],
    ['estoque', 'Estoque'],
    ['pedidos', 'Pedidos'],
    ['clientes', 'Clientes'],
    ['arquivados', 'Arquivados'],
    ['estrategia', 'Estratégia'],
    ['pdv', 'Frente de caixa'],
    ['entregas', 'Entregas e WhatsApp'],
    ['api', 'API e webhooks'],
    ['auditoria', 'Auditoria'],
  ];

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
        <header><div><h1>Gerenciar acessos</h1><p className="muted">Você só pode compartilhar as áreas e os fluxos de estoque liberados no seu próprio acesso.</p></div></header>
        {!data.users.length && <p className="muted">O criador ainda não cadastrou outros usuários.</p>}
        {data.users.map((user) => {
          const draft = drafts[user.id] || { perms: [], stockFlowIds: [], active: user.active };
          const availablePerms = TEAM_PERMS.filter(([key]) => data.availablePerms.includes(key));
          return (
            <article className="shop-team-user" key={user.id}>
              <div className="shop-team-user-head">
                <strong>{user.name}</strong><code>{user.login}</code>
                <label className="small"><input type="checkbox" checked={draft.active} onChange={(event) => setDrafts((rows) => ({ ...rows, [user.id]: { ...draft, active: event.target.checked } }))} /> Ativo</label>
              </div>
              <strong className="small">Áreas liberadas</strong>
              <div className="shop-team-options">
                {availablePerms.map(([key, label]) => <label key={key} className="small">
                  <input type="checkbox" checked={draft.perms.includes(key)} onChange={(event) => setDrafts((rows) => ({
                    ...rows,
                    [user.id]: { ...draft, perms: event.target.checked ? [...draft.perms, key] : draft.perms.filter((perm) => perm !== key) },
                  }))} /> {label}
                </label>)}
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

  return (
    <>
      <header className="shop-app-bar" style={bar}>
        <strong style={{ fontSize: 18 }}>{info.name}</strong>
        <nav role="tablist" aria-label="Áreas do aplicativo" style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
          {tabs.length > 1 && tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </nav>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShopToken(null); setAuthed(false); }}>Sair</button>
      </header>
      <main id="shop-app-panel" role="tabpanel" style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
        {!perms ? <p className="muted">Carregando...</p>
          : !tabs.length ? <p className="muted">Seu acesso ainda não tem nenhuma área liberada. Fale com a loja.</p>
            : tab === 'produtos' ? <Products allow={perms} />
              : tab === 'equipe' ? <TeamManagement />
              : tab === 'pedidos' ? <Orders key="shop-orders" allow={perms} />
                : tab === 'pdv' ? <Orders key="shop-pdv" allow={perms} initialTab="pos" onClosePOS={otherTab ? () => setTab(otherTab) : null} />
                : tab === 'api' ? <Api />
                  : tab === 'auditoria' ? <Audit canReply={auditCanSend} />
                    : tab === 'entregas' ? <>
                      <section className="card">
                        <h2>WhatsApp conectado a este site</h2>
                        <p className="muted">A conexão criada aqui pertence somente a esta loja e pode ser usada para avisos de pedidos.</p>
                        <InstanceManager purpose="envio" />
                        <button type="button" className="btn btn-primary" onClick={() => setCatalogSettingsOpen(true)}>Configurar entregas, frete e notificações</button>
                      </section>
                      {catalogSettingsOpen && <CatalogSettings onClose={() => setCatalogSettingsOpen(false)} />}
                    </> : null}
      </main>
    </>
  );
}
