import { useCallback, useEffect, useState } from 'react';
import { api, isShopMode } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { copyText } from '../lib/portfolio/share.js';
import { dateBR } from '../lib/format.js';

const GROUPS = [
  {
    title: 'Produtos',
    description: 'Consulte produtos e serviços da loja vinculada ao token.',
    endpoints: [
      ['GET', '/api/v1/products', 'Lista (?limit=, ?offset=, ?active=true).'],
      ['GET', '/api/v1/products/{id}', 'Detalhes, fotos, variações, preços e estoque.'],
    ],
  },
  {
    title: 'Pedidos',
    description: 'Acesse pedidos ativos e dados de pagamento, inclusive o comprovante quando disponível.',
    endpoints: [
      ['GET', '/api/v1/orders', 'Lista (?status=novo|atendido, ?limit=, ?offset=).'],
      ['GET', '/api/v1/orders/{id}', 'Detalhes de um pedido.'],
    ],
  },
  {
    title: 'Clientes',
    description: 'Clientes que realizaram pedidos no catálogo da loja selecionada.',
    endpoints: [
      ['GET', '/api/v1/customers', 'Lista (?limit=, ?offset=).'],
      ['GET', '/api/v1/customers/{telefone}', 'Detalhes e pedidos recentes do cliente.'],
    ],
  },
];

const EVENT_NAMES = {
  'product.created': 'Produto cadastrado',
  'product.updated': 'Produto atualizado ou ativado/desativado',
  'product.deleted': 'Produto excluído',
  'order.created': 'Novo pedido recebido',
  'order.updated': 'Pedido atualizado',
  'order.paid': 'Pagamento confirmado',
  'customer.created': 'Novo cliente do catálogo',
  'customer.updated': 'Cliente do catálogo atualizado',
};

const DEFAULT_EVENTS = ['order.created', 'order.paid'];

export default function Api() {
  const shop = isShopMode();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [webhookData, setWebhookData] = useState(null);
  const [name, setName] = useState('');
  const [storeId, setStoreId] = useState('');
  const [created, setCreated] = useState('');
  const [hookSecret, setHookSecret] = useState('');
  const [hook, setHook] = useState({ name: '', url: '', storeId: '', events: DEFAULT_EVENTS });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tokens, webhooks] = await Promise.all([api.get('/tokens'), api.get('/tokens/webhooks')]);
      setData(tokens);
      setWebhookData(webhooks);
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true);
    try {
      const r = await api.post('/tokens', { name, storeId: storeId || null });
      setCreated(r.token);
      setName('');
      await load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  async function revoke(t) {
    if (!window.confirm(`Revogar o token "${t.name}"? Quem usa esse token perde o acesso.`)) return;
    try { await api.del(`/tokens/${t.id}`); toast('Token revogado.'); await load(); } catch (e) { toast(e.message, 'error'); }
  }

  async function createWebhook(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.post('/tokens/webhooks', { ...hook, storeId: hook.storeId || null });
      setHookSecret(result.secret);
      setHook({ name: '', url: '', storeId: '', events: DEFAULT_EVENTS });
      toast('Webhook cadastrado. As tentativas de entrega começam automaticamente.');
      await load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  async function removeWebhook(item) {
    if (!window.confirm(`Remover o webhook "${item.name}" e cancelar entregas pendentes?`)) return;
    try { await api.del(`/tokens/webhooks/${item.id}`); toast('Webhook removido.'); await load(); } catch (e) { toast(e.message, 'error'); }
  }

  const toggleEvent = (event) => setHook((current) => ({
    ...current,
    events: current.events.includes(event) ? current.events.filter((item) => item !== event) : [...current.events, event],
  }));
  const base = window.location.origin;
  const stores = webhookData?.stores || data?.stores || [];

  return (
    <>
      <header className="page-head">
        <h1>API e webhooks</h1>
        <p className="muted">{shop ? 'Gerencie tokens e webhooks com acesso restrito a este site.' : 'Conecte seus sistemas por token e receba eventos da loja em uma URL HTTPS.'}</p>
      </header>

      {created && (
        <div className="banner banner-amber" style={{ flexWrap: 'wrap' }}>
          <div><strong>Copie o token agora. Ele não será mostrado de novo.</strong><code style={{ wordBreak: 'break-all' }}>{created}</code></div>
          <button className="btn btn-primary btn-sm" onClick={async () => toast((await copyText(created)) ? 'Token copiado!' : 'Copie manualmente.')}>Copiar</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setCreated('')}>Já copiei</button>
        </div>
      )}

      {hookSecret && (
        <div className="banner banner-amber" style={{ flexWrap: 'wrap' }}>
          <div><strong>Guarde o segredo de assinatura. Ele só aparece uma vez.</strong><code style={{ wordBreak: 'break-all' }}>{hookSecret}</code><span>Valide a assinatura HMAC SHA-256 enviada no cabeçalho <code>X-DM-Signature</code>.</span></div>
          <button className="btn btn-primary btn-sm" onClick={async () => toast((await copyText(hookSecret)) ? 'Segredo copiado!' : 'Copie manualmente.')}>Copiar segredo</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setHookSecret('')}>Já guardei</button>
        </div>
      )}

      <section className="card api-section shadow-sm">
        <div>
          <h2>Criar token de acesso</h2>
          <p className="muted small">Cada token acessa somente uma loja e permite consultas de produtos, pedidos e clientes.</p>
        </div>
        <div className="api-form-row">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Meu sistema)" maxLength={60} aria-label="Nome do token" />
          {!shop && <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja do token">
            <option value="">Loja principal</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>}
          <button className="btn btn-primary" onClick={create} disabled={busy || !name.trim()}>Criar token</button>
        </div>
      </section>

      <section className="card api-section shadow-sm">
        <h2>Seus tokens</h2>
        {!data ? <p className="muted">Carregando...</p> : !data.tokens.length ? <p className="muted">Nenhum token criado.</p> : (
          <ul className="api-token-list">
            {data.tokens.map((token) => (
              <li key={token.id}>
                <div className="api-token-info"><strong>{token.name}</strong><code>{token.prefix}…</code><span className="pill">{token.storeName}</span><small className="muted">{token.lastUsedAt ? `Usado em ${dateBR(token.lastUsedAt)}` : 'Nunca usado'}</small></div>
                <button className="btn btn-ghost btn-sm" onClick={() => revoke(token)}>Revogar</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="api-docs grid grid-cols-1 gap-4 lg:grid-cols-3">
        {GROUPS.map((group) => (
          <article className="card shadow-sm" key={group.title}>
            <h2>{group.title}</h2>
            <p className="muted small">{group.description}</p>
            <ul>
              {group.endpoints.map(([method, path, description]) => (
                <li key={path}><code>{method} {base}{path}</code><span> — {description}</span></li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="card api-section shadow-sm">
        <h2>Webhooks de saída</h2>
        <p className="muted small">Quando um evento acontecer, enviaremos um POST JSON. O corpo possui um identificador único; use-o para evitar processar a mesma entrega mais de uma vez. Falhas recebem novas tentativas com intervalo crescente.</p>
        <form className="api-webhook-form" onSubmit={createWebhook}>
          <div className="api-form-row">
            <input className="input" value={hook.name} onChange={(e) => setHook((s) => ({ ...s, name: e.target.value }))} placeholder="Nome (ex.: Integração do site)" maxLength={60} aria-label="Nome do webhook" required />
            <input className="input api-webhook-url" type="url" value={hook.url} onChange={(e) => setHook((s) => ({ ...s, url: e.target.value }))} placeholder="https://seusistema.com/webhooks/dm" aria-label="URL HTTPS do webhook" required />
            {!shop && <select className="input" value={hook.storeId} onChange={(e) => setHook((s) => ({ ...s, storeId: e.target.value }))} aria-label="Loja do webhook">
              <option value="">Loja principal</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>}
          </div>
          <fieldset className="api-event-list">
            <legend>Eventos para receber</legend>
            {Object.entries(EVENT_NAMES).map(([event, title]) => (
              <label key={event}><input type="checkbox" checked={hook.events.includes(event)} onChange={() => toggleEvent(event)} /> <span>{title}</span><code>{event}</code></label>
            ))}
          </fieldset>
          <button className="btn btn-primary" disabled={busy || !hook.name.trim() || !hook.url.trim() || !hook.events.length || webhookData?.webhooks?.length >= webhookData?.limit}>
            {busy ? 'Salvando...' : `Adicionar webhook (${webhookData?.webhooks?.length || 0}/${webhookData?.limit || 10})`}
          </button>
        </form>

        {!webhookData ? <p className="muted">Carregando webhooks...</p> : !webhookData.webhooks.length ? <p className="muted">Nenhum webhook cadastrado ainda.</p> : (
          <ul className="api-webhook-list">
            {webhookData.webhooks.map((item) => {
              const latest = item.deliveries?.[0];
              return (
                <li key={item.id}>
                  <div className="api-webhook-info">
                    <strong>{item.name}</strong><span className="pill">{item.storeId ? stores.find((s) => s.id === item.storeId)?.name || 'Loja extra' : 'Loja principal'}</span>
                    <code className="api-webhook-destination">{item.url}</code>
                    <small className="muted">{item.events.map((event) => EVENT_NAMES[event] || event).join(' · ')}</small>
                    {latest && <small className={latest.status === 'delivered' ? 'api-delivery-ok' : 'api-delivery-error'}>Última entrega: {latest.status === 'delivered' ? 'enviada' : latest.status === 'queued' ? 'aguardando nova tentativa' : 'falhou'} · {latest.event}{latest.lastStatus ? ` · HTTP ${latest.lastStatus}` : ''}{latest.lastError ? ` · ${latest.lastError}` : ''}</small>}
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeWebhook(item)}>Remover</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card api-section shadow-sm">
        <h2>Autenticação e assinatura</h2>
        <p className="muted small">API REST: envie o token no cabeçalho <code>Authorization: Bearer SEU_TOKEN</code>. Os webhooks usam o cabeçalho <code>X-DM-Signature: sha256=...</code>, calculado como HMAC-SHA256 do corpo bruto com o segredo do webhook.</p>
        <pre className="api-code"><code>{`curl -H "Authorization: Bearer SEU_TOKEN" "${base}/api/v1/products"`}</code></pre>
      </section>
    </>
  );
}
