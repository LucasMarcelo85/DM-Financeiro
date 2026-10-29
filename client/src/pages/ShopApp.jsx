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
  ['pedidos', 'Pedidos e clientes'],
  ['entregas', 'Entregas e WhatsApp'],
  ['api', 'API e webhooks'],
  ['auditoria', 'Auditoria'],
];
const firstTab = (perms) => TABS.find(([key]) => key === 'produtos' ? perms.includes(key) : key === 'pedidos'
  ? ['pedidos', 'clientes', 'arquivados', 'estrategia'].some((perm) => perms.includes(perm))
  : perms.includes(key))?.[0] || '';
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
  const [tab, setTab] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [auditCanSend, setAuditCanSend] = useState(false);
  const [catalogSettingsOpen, setCatalogSettingsOpen] = useState(false);
  const [form, setForm] = useState({ login: '', password: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authed) { setPerms(null); return; }
    api.get('/shop-app/me').then((r) => {
      setPerms(r.user.perms);
      setTab(firstTab(r.user.perms));
      setContactWhatsapp(r.app.whatsapp || '');
      setAuditCanSend(Boolean(r.app.auditSend));
    }).catch((e) => toast(e.message, 'error'));
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
      setTab(firstTab(r.user.perms));
      setContactWhatsapp(r.app.whatsapp || '');
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

  const tabs = TABS.filter(([key]) => key === 'produtos'
    ? perms?.includes('produtos')
    : key === 'pedidos'
      ? ['pedidos', 'clientes', 'arquivados', 'estrategia'].some((p) => perms?.includes(p))
      : perms?.includes(key));

  return (
    <>
      <header className="shop-app-bar" style={bar}>
        <strong style={{ fontSize: 18 }}>{info.name}</strong>
        <nav style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
          {tabs.length > 1 && tabs.map(([key, label]) => (
            <button key={key} type="button" className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </nav>
        {contactWhatsapp && <a className="btn btn-ghost btn-sm" href={`https://wa.me/${contactWhatsapp}`} target="_blank" rel="noopener noreferrer">WhatsApp da loja</a>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShopToken(null); setAuthed(false); }}>Sair</button>
      </header>
      <main style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
        {!perms ? <p className="muted">Carregando...</p>
          : !tabs.length ? <p className="muted">Seu acesso ainda não tem nenhuma área liberada. Fale com a loja.</p>
            : tab === 'produtos' ? <Products />
              : tab === 'pedidos' ? <Orders allow={perms} />
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
