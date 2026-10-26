import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { copyText } from '../lib/portfolio/share.js';
import { dateBR } from '../lib/format.js';

const ENDPOINTS = [
  ['GET', '/api/v1/products', 'Lista os produtos (?limit=, ?offset=, ?active=true).'],
  ['GET', '/api/v1/products/{id}', 'Um produto.'],
  ['GET', '/api/v1/orders', 'Lista os pedidos (?status=novo|atendido, ?limit=, ?offset=).'],
  ['GET', '/api/v1/orders/{id}', 'Um pedido.'],
];

export default function Api() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [storeId, setStoreId] = useState('');
  const [created, setCreated] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get('/tokens').then(setData).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true);
    try {
      const r = await api.post('/tokens', { name, storeId: storeId || null });
      setCreated(r.token);
      setName('');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  async function revoke(t) {
    if (!window.confirm(`Revogar o token "${t.name}"? Quem usa esse token perde o acesso.`)) return;
    try { await api.del(`/tokens/${t.id}`); toast('Token revogado.'); load(); } catch (e) { toast(e.message, 'error'); }
  }

  const base = window.location.origin;
  return (
    <>
      <header className="page-head">
        <h1>API</h1>
        <p className="muted">Crie um token para acessar os produtos e pedidos da sua loja principal ou de uma loja específica. A API é somente leitura.</p>
      </header>

      {created && (
        <div className="banner banner-amber" style={{ flexWrap: 'wrap' }}>
          <div>
            <strong>Copie o token agora. Ele não será mostrado de novo.</strong>
            <code style={{ wordBreak: 'break-all' }}>{created}</code>
          </div>
          <button className="btn btn-primary btn-sm" onClick={async () => toast((await copyText(created)) ? 'Token copiado!' : 'Copie manualmente.')}>Copiar</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setCreated('')}>Já copiei</button>
        </div>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Novo token</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ maxWidth: 260 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Meu app)" maxLength={60} />
          <select className="input" style={{ maxWidth: 240 }} value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja do token">
            <option value="">Loja principal</option>
            {data?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn btn-primary" onClick={create} disabled={busy || !name.trim()}>Criar token</button>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Seus tokens</h2>
        {!data ? <p className="muted">Carregando...</p> : !data.tokens.length ? <p className="muted">Nenhum token criado.</p> : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {data.tokens.map((t) => (
              <li key={t.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{t.name}</strong>
                <code>{t.prefix}…</code>
                <span className="pill">{t.storeName}</span>
                <span className="muted small">{t.lastUsedAt ? `Usado em ${dateBR(t.lastUsedAt)}` : 'Nunca usado'}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => revoke(t)} style={{ marginLeft: 'auto' }}>Revogar</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Como usar</h2>
        <p className="muted small">Envie o token no cabeçalho <code>Authorization: Bearer SEU_TOKEN</code>.</p>
        <ul style={{ paddingLeft: 18 }}>
          {ENDPOINTS.map(([m, p, d]) => <li key={p}><code>{m} {base}{p}</code> — {d}</li>)}
        </ul>
        <pre style={{ overflowX: 'auto' }}><code>{`curl -H "Authorization: Bearer SEU_TOKEN" ${base}/api/v1/products`}</code></pre>
      </section>
    </>
  );
}
