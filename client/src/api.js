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

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(pinToken ? { 'X-Pin-Token': pinToken } : {}) },
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
