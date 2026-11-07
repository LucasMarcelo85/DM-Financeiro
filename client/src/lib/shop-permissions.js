export const SHOP_PERMISSION_GROUPS = [
  {
    title: 'Clientes e cobranças',
    permissions: [
      ['contatos', 'Clientes de cobranças', 'Cadastro de clientes usado na área de cobranças e lembretes.'],
      ['cobrancas', 'Cobranças', 'Criar e acompanhar cobranças e lembretes; o envio de mensagens usa uma conexão WhatsApp de envio.'],
    ],
  },
  {
    title: 'Contratos',
    permissions: [
      ['contratos', 'Contratos', 'Criar, consultar e editar contratos disponíveis para esta loja.'],
    ],
  },
  {
    title: 'Auditoria do WhatsApp',
    permissions: [
      ['auditoria', 'Auditoria de conversas', 'Acessa conversas capturadas por uma conexão de auditoria, separada das conexões usadas para cobranças e notificações.'],
    ],
  },
  {
    title: 'Portfólio, produtos e vendas',
    permissions: [
      ['portfolio', 'Portfólio', 'Editar a página principal da loja e os conteúdos publicados nela.'],
      ['produtos', 'Produtos do portfólio e do PDV', 'Cadastrar, editar e publicar produtos usados no catálogo e no ponto de venda.'],
      ['estoque', 'Estoque', 'Consultar e movimentar estoque nos fluxos liberados.'],
      ['pedidos', 'Pedidos do portfólio e do PDV', 'Consultar e atualizar pedidos recebidos pelo catálogo ou registrados no PDV.'],
      ['clientes', 'Clientes do portfólio e do PDV', 'Consultar e gerenciar clientes vinculados aos pedidos e às vendas.'],
      ['arquivados', 'Pedidos arquivados', 'Consultar e restaurar pedidos arquivados.'],
      ['estrategia', 'Estratégia de vendas e regiões', 'Consultar relatórios e informações estratégicas das vendas.'],
      ['pdv', 'Frente de caixa (PDV)', 'Registrar vendas presenciais e operar o caixa.'],
    ],
  },
  {
    title: 'WhatsApp e notificações',
    permissions: [
      ['whatsapp', 'WhatsApp de envio', 'Gerenciar conexões e usar mensagens de envio, como conversas e cobranças.'],
      ['entregas', 'Entregas e notificações do catálogo', 'Configurar entregas e os avisos de novos pedidos; os avisos usam uma conexão WhatsApp de envio ou a reserva configurada pelo criador.'],
    ],
  },
  {
    title: 'Integrações',
    permissions: [
      ['api', 'API e webhooks', 'Consultar e administrar integrações e tokens desta loja.'],
      ['ia', 'Inteligência artificial', 'Usar os recursos de IA liberados; a credencial do provedor é configurada pelo usuário.'],
    ],
  },
];
