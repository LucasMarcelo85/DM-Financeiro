import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

const API_PATH = '/api/trpc';

function panelApiUrl(procedure) {
  const missing = [
    ['EASYPANEL_API_URL', config.easypanel.url],
    ['EASYPANEL_API_KEY', config.easypanel.apiKey],
    ['EASYPANEL_PROJECT_NAME', config.easypanel.projectName],
    ['EASYPANEL_SERVICE_NAME', config.easypanel.serviceName],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Configure as variáveis ${missing.join(', ')} com os dados reais do EasyPanel.`);
  const panelUrl = config.easypanel.url.replace(/\/api$/i, '');
  return `${panelUrl}${API_PATH}/${procedure}`;
}

function responseError(payload) {
  const candidates = [
    payload?.error?.json?.message,
    payload?.error?.json?.errorMessage,
    payload?.error?.message,
    payload?.error?.data?.message,
    payload?.errorMessage,
    payload?.message,
    typeof payload?.error === 'string' ? payload.error : null,
  ];
  return candidates.find((message) => typeof message === 'string' && message.trim())?.trim();
}

async function callApi(procedure, input, method = 'POST') {
  const url = new URL(panelApiUrl(procedure));
  const options = {
    method,
    headers: { Authorization: config.easypanel.apiKey },
    signal: AbortSignal.timeout(15_000),
  };

  if (method === 'GET') {
    url.searchParams.set('input', JSON.stringify({ json: input }));
  } else {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify({ json: input });
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`A API do EasyPanel retornou uma resposta inválida (HTTP ${response.status}).`);
  }

  if (!response.ok || payload?.error) {
    const message = responseError(payload);
    throw new Error(`EasyPanel ${procedure} (HTTP ${response.status})${message ? `: ${message}` : '.'}`);
  }

  return payload?.result?.data?.json;
}

async function listServiceDomains() {
  const domains = await callApi('domains.listDomains', {
    projectName: config.easypanel.projectName,
    serviceName: config.easypanel.serviceName,
  }, 'GET');
  if (!Array.isArray(domains)) throw new Error('A API do EasyPanel retornou uma lista de domínios inválida.');
  return domains;
}

export async function addDomainToEasypanel(domain) {
  const domains = await listServiceDomains();
  if (domains.some((item) => String(item.host || '').toLowerCase() === domain.toLowerCase())) return;

  await callApi('domains.createDomain', {
    projectName: config.easypanel.projectName,
    serviceName: config.easypanel.serviceName,
    id: randomUUID(),
    https: true,
    host: domain,
    path: '/',
    middlewares: [],
    certificateResolver: 'letsencrypt',
    wildcard: false,
    destinationType: 'service',
    serviceDestination: {
      protocol: 'http',
      port: 3001,
      projectName: config.easypanel.projectName,
      serviceName: config.easypanel.serviceName,
    },
  });
}

export async function removeDomainFromEasypanel(domain) {
  const domains = await listServiceDomains();
  const existing = domains.find((item) => String(item.host || '').toLowerCase() === domain.toLowerCase());
  if (existing) {
    await callApi('domains.deleteDomain', {
      projectName: config.easypanel.projectName,
      serviceName: config.easypanel.serviceName,
      id: existing.id,
    });
  }
}
