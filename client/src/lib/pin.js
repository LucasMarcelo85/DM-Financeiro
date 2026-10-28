// Abas do menu que podem ser protegidas pelo código PIN (as chaves são as mesmas do servidor: server/utils/pin.js).
export const PIN_TABS = [
  { key: 'inicio', label: 'Início' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'cobrancas', label: 'Cobranças' },
  { key: 'lembretes', label: 'Lembretes' },
  { key: 'contratos', label: 'Contratos' },
  { key: 'auditoria', label: 'Auditoria' },
  { key: 'portfolio', label: 'Portfólio' },
  { key: 'produtos', label: 'Produtos/Serviços' },
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'api', label: 'API' },
  { key: 'plano', label: 'Plano' },
  { key: 'admin', label: 'Administração (usuários e planos)', adminOnly: true },
];

export const tabLabel = (key) => PIN_TABS.find((t) => t.key === key)?.label || key;

// Qual aba protegível corresponde ao endereço atual (null = tela que não tem PIN, como Perfil).
export function tabOfPath(pathname) {
  const seg = pathname.split('/')[1] || '';
  if (seg === '') return 'inicio';
  if (seg === 'cobranca') return 'cobrancas';
  if (seg === 'lembrete') return 'lembretes';
  return PIN_TABS.some((t) => t.key === seg) ? seg : null;
}

export const isTabLocked = (user, pinUnlocked, tab) => Boolean(tab && user?.pin?.enabled && user.pin.tabs.includes(tab) && !pinUnlocked);

// Abas que o administrador pode liberar ou esconder em cada plano (mesmas chaves do servidor: server/plans.js).
export const PLAN_TABS = ['inicio', 'whatsapp', 'clientes', 'cobrancas', 'lembretes', 'contratos', 'auditoria', 'portfolio', 'produtos', 'pedidos', 'api'];
export const isTabInPlan = (user, tab) => !PLAN_TABS.includes(tab) || (user?.limits?.tabs || PLAN_TABS).includes(tab);
