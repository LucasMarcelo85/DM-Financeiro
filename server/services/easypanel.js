import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

const API_PATH = '/api/trpc';

function panelApiUrl(procedure) {
  if (!config.easypanel.url || !config.easypanel.apiKey) {
    throw new Error('Configure EASYPANEL_API_URL e EASYPANEL_API_KEY para automatizar domínios.');
  }
  const panelUrl = config.easypanel.url.replace(/\/api$/i, '');
  return `${panelUrl}${API_PATH}/${procedure}`;
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
    const message = payload?.error?.json?.message || payload?.error?.message;
    throw new Error(message || `A API do EasyPanel respondeu com HTTP ${response.status}.`);
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
