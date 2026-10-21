// Domínio próprio do portfólio (ex.: meusite.com.br).
// Guardamos sempre sem "https://", sem "www." e em minúsculas: "https://WWW.MeuSite.com.br/" vira "meusite.com.br".
// Quando alguém acessa "www.meusite.com.br" o servidor trata como o mesmo domínio (ver hostKey).

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

export function normalizeDomain(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#\s]/)[0]
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

export const isValidDomain = (d) => typeof d === 'string' && DOMAIN_RE.test(d);

// Host da requisição (sem porta e sem "www.") para procurar o dono do domínio.
export function hostKey(hostHeader) {
  return normalizeDomain(String(hostHeader || '').split(',')[0]);
}
