// Endereço (slug) do portfólio: dominio/<usuário> e dominio/<usuário>/<página>.
// Só minúsculas, números e hífens, sem acento: "Padaria São João Ltda." vira "padaria-sao-joao-ltda".
export const SLUG_MAX = 60;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Primeiro trecho do endereço que já é uma tela do sistema (ou do servidor): nenhum usuário pode ficar com eles.
export const RESERVED_SLUGS = new Set([
  'api', 'assets', 'static', 'public', 'health', 'webhooks', 'favicon', 'robots', 'sitemap', 'index',
  'entrar', 'login', 'sair', 'cadastro', 'registro', 'whatsapp', 'clientes', 'cobrancas', 'cobranca', 'lembretes', 'lembrete',
  'contratos', 'contrato', 'auditoria', 'portfolio', 'portfolios', 'plano', 'planos', 'pagamento', 'admin',
  'app', 'inicio', 'dashboard', 'suporte', 'ajuda', 'termos', 'privacidade', 'p', 'u', 'null', 'undefined',
]);

export function slugify(input, max = SLUG_MAX) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

export const isValidSlug = (s) => typeof s === 'string' && s.length > 0 && s.length <= SLUG_MAX && SLUG_RE.test(s);
export const isReservedSlug = (s) => RESERVED_SLUGS.has(s);

// Primeiro endereço livre: "maria", "maria-2", "maria-3"...
// `taken`: Set com os endereços já usados. `reserved`: também evita os nomes de telas do sistema.
export function pickSlug(base, taken, { reserved = false } = {}) {
  const root = base || 'pagina';
  for (let n = 1; n < 10000; n++) {
    const tail = `-${n}`;
    const cand = n === 1 ? root : `${root.slice(0, SLUG_MAX - tail.length).replace(/-+$/, '')}${tail}`;
    if (!taken.has(cand) && !(reserved && RESERVED_SLUGS.has(cand))) return cand;
  }
  throw new Error('Não há endereço livre.');
}
