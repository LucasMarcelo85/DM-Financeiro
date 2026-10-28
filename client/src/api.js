export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Token de desbloqueio do PIN: fica só na memória desta tela (nunca em cookie nem localStorage), então atualizar a página ou abrir em outro aparelho pede o PIN de novo.
let pinToken = null;
export const setPinToken = (t) => { pinToken = t || null; };

// Loja ativa do painel (null = loja principal). Produtos, pedidos e portfólios usam `?store=`.
const STORE_KEY = 'dm:store';
export const getActiveStore = () => localStorage.getItem(STORE_KEY) || null;
export const setActiveStore = (id) => { if (id) localStorage.setItem(STORE_KEY, String(id)); else localStorage.removeItem(STORE_KEY); };
const SCOPED = /^\/(products|catalog|portfolios)(\/|\?|$)/;
const AUDIT_SCOPE_KEY = 'dm:audit-scope';
export const getActiveAuditScope = () => {
  const scope = sessionStorage.getItem(AUDIT_SCOPE_KEY) || 'main';
  return scope === 'app' || !/^(main|store:\d+)$/.test(scope) ? 'main' : scope;
};
export const setActiveAuditScope = (scope) => { if (scope && scope !== 'main') sessionStorage.setItem(AUDIT_SCOPE_KEY, scope); else sessionStorage.removeItem(AUDIT_SCOPE_KEY); };
const scoped = (url) => {
  const store = getActiveStore();
  if (store && SCOPED.test(url) && !/^\/portfolios\/domain/.test(url) && !/[?&]store=/.test(url)) {
    url = `${url}${url.includes('?') ? '&' : '?'}store=${store}`;
  }
  const scope = getActiveAuditScope();
  if (scope !== 'main' && /^\/audit\//.test(url) && !/[?&]scope=/.test(url)) {
    url = `${url}${url.includes('?') ? '&' : '?'}scope=${encodeURIComponent(scope)}`;
  }
  return url;
};

// Aplicativo do lojista (/app): o login é outro e as telas de Produtos e Pedidos reaproveitam as mesmas chamadas, redirecionadas para /shop-app.
const SHOP_KEY = 'dm:shop-token';
export const isShopMode = () => /^\/app(\/|$)/.test(window.location.pathname);
export const getShopToken = () => localStorage.getItem(SHOP_KEY);
export const setShopToken = (t) => { if (t) localStorage.setItem(SHOP_KEY, t); else localStorage.removeItem(SHOP_KEY); };
const SHOP_ROUTES = /^\/(products|catalog|instances|tokens|audit)(\/|\?|$)/;

async function request(method, url, body) {
  let res;
  const shop = isShopMode();
  const target = shop ? (SHOP_ROUTES.test(url) ? `/shop-app${url}` : url) : scoped(url);
  const auth = shop && getShopToken() ? { Authorization: `Bearer ${getShopToken()}` } : {};
  try {
    res = await fetch(`/api${target}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(pinToken ? { 'X-Pin-Token': pinToken } : {}), ...auth },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique sua internet e tente de novo.', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* resposta sem corpo */
  }
  if (!res.ok) {
    if (shop && res.status === 401 && getShopToken()) { setShopToken(null); window.dispatchEvent(new Event('dm:shop-logout')); }
    if (res.status === 402 && data?.code === 'PAYMENT_REQUIRED') window.dispatchEvent(new Event('dm:payment-required'));
    if (res.status === 423 && data?.code === 'PIN_REQUIRED') window.dispatchEvent(new Event('dm:pin-required')); // a aba foi travada de novo: a tela pede o PIN
    throw new ApiError(data?.error || 'Algo deu errado. Tente novamente.', res.status, data?.code);
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b = {}) => request('PUT', u, b),
  patch: (u, b = {}) => request('PATCH', u, b),
  del: (u, b) => request('DELETE', u, b),
};
