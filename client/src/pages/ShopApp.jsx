import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, getShopToken, setShopToken } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import Products from './Products.jsx';
import Orders from './Orders.jsx';

const TABS = [['produtos', 'Produtos'], ['pedidos', 'Pedidos e clientes']];

// Aplicativo do lojista, instalável no celular: o nome e a cor vêm da configuração da loja e o endereço é o do próprio site da loja.
export default function ShopApp() {
  const { slug } = useParams();
  const toast = useToast();
  const q = slug ? `?u=${encodeURIComponent(slug)}` : '';
  const [info, setInfo] = useState(null);
  const [missing, setMissing] = useState(false);
  const [authed, setAuthed] = useState(Boolean(getShopToken()));
  const [tab, setTab] = useState('produtos');
  const [form, setForm] = useState({ login: '', password: '' });
  const [busy, setBusy] = useState(false);

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
      setAuthed(true);
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }

  if (missing) return <main style={{ padding: 32, textAlign: 'center' }}><h1>Aplicativo indisponível</h1><p className="muted">Confira o endereço com a loja.</p></main>;
  if (!info) return <main style={{ padding: 32 }}><p className="muted">Carregando...</p></main>;

  const bar = { background: info.color, color: '#0F2238', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' };

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

  return (
    <>
      <header style={bar}>
        <strong style={{ fontSize: 18 }}>{info.name}</strong>
        <nav style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
          {TABS.map(([key, label]) => (
            <button key={key} type="button" className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </nav>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShopToken(null); setAuthed(false); }}>Sair</button>
      </header>
      <main style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
        {tab === 'produtos' ? <Products /> : <Orders />}
      </main>
    </>
  );
}
