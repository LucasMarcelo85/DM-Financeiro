# DM Gerenciador

Plataforma de gestão para pequenos negócios, lojas, clínicas, agências e prestadores de serviços. Reúne clientes, cobranças e lembretes pelo WhatsApp, contratos, portfólios, catálogo de produtos e pedidos, com planos e teste grátis configuráveis.

**Stack:** Node.js + Express + **PostgreSQL com Prisma** (backend) · React + Vite (frontend).

## Como rodar

```bash
npm install
cp .env.example .env     # preencha o .env (principalmente DATABASE_URL)
npm run db:deploy        # cria as tabelas no PostgreSQL
npm run dev              # API em :3001 e front em http://localhost:5173
```

Produção sem Docker: `npm run build`, `npm run db:deploy` e `npm start`.

Comandos do banco: `npm run db:deploy` (aplica as migrações), `npm run db:migrate` (cria uma nova migração depois de editar `prisma/schema.prisma`, só em desenvolvimento), `npm run db:studio` (visualizar os dados).

Teste automático do backend (cria um banco temporário, usa Evolution, Meta e InfinitePay simuladas):

```bash
SMOKE_DATABASE_URL="postgres://usuario:senha@localhost:5432/postgres" npm run smoke
```

## Banco de dados

`DATABASE_URL` no formato `postgres://USUARIO:SENHA@HOST:5432/BANCO?sslmode=disable`.

- Use um banco **só para este sistema**. O Prisma recusa criar tabelas em um banco que já tem outras (erro `P3005`).
- Senha com caracteres especiais (`@ : / ? # %`) precisa ser codificada (`@` vira `%40`).
- Tabelas: `users`, `instances`, `payments`, `contacts` (clientes), `schedules` (cobranças e lembretes agendados), `messages` (histórico) e `billing_payments` (cobranças marcadas como pagas).

## O que o sistema faz

- **Cadastro:** pessoa física (CPF) ou jurídica (CNPJ), validados. Toda conta entra com role `usuario` e teste grátis pelos dias configurados no painel admin.
- **Planos** (valor mensal; configurável em `PLAN_*_PRICE`):

  | | Bronze | Prata | Ouro |
  |---|---|---|---|
  | Mensal | R$ 34,90 | R$ 54,90 | R$ 64,90 |
  | WhatsApps para cobranças | 1 | 1 | 3 |
  | Números para auditoria | 1 | 3 | 5 |
  | Modelos de contrato | 2 | 7 | 20 |
  | Páginas de portfólio | 1 | 2 | 7 |
  | Responder pela auditoria | não | não | sim |

  Períodos: **mensal** (1 mensalidade, 30 dias), **semestral** (paga 5 mensalidades, 183 dias) e **anual** (paga 9 mensalidades, 365 dias). A tela de planos mostra o valor total de cada período lado a lado, sem destacar o desconto. Cada pagamento guarda o período e os dias que libera. O admin lista e exclui usuários, troca o plano e dá acesso mensal (+30 dias).
- **Depois do teste:** o acesso é bloqueado até o pagamento pelo link da InfinitePay (confirmado direto com a InfinitePay). O envio automático também pausa enquanto não houver acesso.
- **WhatsApp:** a instância se chama como o CPF/CNPJ. Luz verde = conectado, vermelha = desconectado.
- **Clientes:** salvos uma vez (nome e WhatsApp) e escolhidos por busca ao criar cobranças e lembretes. Um cliente novo digitado no formulário já é salvo automaticamente.
- **Cobranças e lembretes:** *avulsos* (uma vez) ou *mensais* (todo mês, no mesmo dia; dia 31 vira o último dia em meses curtos). O usuário escolhe o vencimento, quantos dias **antes** enviar (no dia, 1, 2, 3, 5, 7 ou até 30) e o **horário**. Também dá para **enviar agora**. A mensagem aceita `{nome}`, `{valor}` e `{vencimento}`, trocados na hora do envio.
- **Link ou Pix:** sai em uma **segunda mensagem**, para copiar e colar com um toque.
- **Envio automático:** o sistema verifica a cada 30 s (`SCHEDULER_INTERVAL_SECONDS`). Se o WhatsApp estiver desconectado, tenta de novo a cada 15 min, até 4 vezes. Se o horário passar mais de 6 horas (sistema parado, por exemplo), **não** envia a cobrança atrasada e registra a falha. O envio não duplica, mesmo com mais de uma cópia do sistema rodando.
- **Visualização:** cobranças e lembretes em **lista** (com filtros) ou **calendário** mensal. Cada item pode ser enviado agora, pausado, editado ou excluído.
- **Cobrança paga:** em *Cobranças*, o botão ✓ marca como paga. O usuário escolhe qual vencimento foi pago (nas mensais, qualquer um dos últimos meses) e o **dia em que o cliente pagou**. Dá para desfazer. Uma cobrança já paga **não é enviada de novo** no horário agendado. Excluir a cobrança ou o cliente mantém o pagamento no faturamento.
- **Faturamento:** aba *Faturamento* em Cobranças, com o total recebido nos últimos **30, 60 e 90 dias** e **por intervalo de datas** (conta pelo dia do pagamento), gráfico de barras e lista dos pagamentos recebidos.
- **Como cada cliente paga:** nota de **1 a 5 estrelas** pela média de atraso nos últimos 12 pagamentos: 5 = paga em dia (ou antes), 4 = atrasa 1 dia, 3 = 2 dias, 2 = 3 dias, 1 = 4 dias ou mais. Mostra também o dia do mês em que o cliente costuma pagar e o atraso médio, na aba Faturamento e em cada cobrança da lista.
- **Início:** clientes cadastrados, valor total das cobranças mensais, previsto no mês, mensagens enviadas, próximos envios e histórico.

## Deploy no EasyPanel

1. Crie o serviço **App** a partir do repositório, com build **Dockerfile** (na raiz).
2. Em **Domínios**, aponte para a porta `3001`.
3. Em **Ambiente**, preencha as variáveis do `.env.example` (sem aspas). As obrigatórias: `DATABASE_URL`, `APP_URL` (https), `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `INFINITEPAY_HANDLE`. Para habilitar a cotação dos Correios no catálogo, configure também `SUPERFRETE_TOKEN` e `SUPERFRETE_USER_AGENT` no ambiente do servidor; os usuários não precisam cadastrar tokens individuais.
4. Faça o deploy. Ao iniciar, o container roda `prisma migrate deploy` (cria as tabelas) e depois liga o sistema. Não precisa de volume: tudo fica no PostgreSQL.

Para criar os dados de demonstração do administrador ID 1, faça um novo build/redeploy da imagem e, no terminal do container, execute `npm run seed:admin-demo -- --confirm-admin-demo-seed`. O script está incluído na imagem e usa a `DATABASE_URL` do serviço; ele não roda automaticamente na inicialização.

Se o PostgreSQL estiver no mesmo EasyPanel, use o nome interno do serviço no host da `DATABASE_URL`.

Para cadastrar domínios personalizados automaticamente, configure também `EASYPANEL_API_URL`, `EASYPANEL_API_KEY`, `EASYPANEL_PROJECT_NAME` e `EASYPANEL_SERVICE_NAME`. Use a URL base do painel (com ou sem `/api`), um token da API e os nomes exatos do projeto e do serviço App que escuta na porta `3001`; não deixe os nomes de exemplo do `.env.example`. Ao salvar ou verificar um domínio, o sistema o registra no EasyPanel e habilita HTTPS; ao removê-lo, também o remove do painel.

## Observações

- O webhook da InfinitePay (`/api/webhooks/infinitepay`) só é informado quando `APP_URL` começa com `https`. Em ambiente local o pagamento é confirmado pela página de retorno.
- **Contratos:** editor visual de modelos (tela cheia, páginas A4 retrato/paisagem) em `client/src/pages/ContractEditor.jsx`.
  - Criar do zero (em branco ou modelo pronto) ou **importar** `.docx` (Word), `.html`, `.txt`, `.json` (modelo exportado daqui) ou imagem (vira fundo). PDF e `.doc` antigo não são editáveis: abra no Word/Google Docs e salve como `.docx`. Na importação de `.docx`/HTML, cabeçalhos/rodapés e formatação no meio da frase (ex.: uma palavra em negrito) não são trazidos, e tabelas viram uma linha de texto por linha.
  - Elementos: título, subtítulo, texto, data (automática ou fixa), cápsula, imagem/logo, linha e retângulo. Arrastar, redimensionar, guias de alinhamento, fonte/tamanho/cor/alinhamento, camadas, travar, alinhar na página, blocos prontos (cabeçalho, assinaturas, rodapé), várias páginas, desfazer/refazer (Ctrl+Z / Ctrl+Y), salvamento automático.
  - **PDF / Imprimir** usa o diálogo do navegador ("Salvar como PDF"); **Exportar** baixa o modelo em `.json`.
  - Imagens são reduzidas no navegador e ficam dentro do contrato (limite de ~9 MB por contrato). O servidor valida e limpa o documento (`server/utils/contract.js`) e limita a quantidade de modelos por plano.
  - As fontes vêm do Google Fonts (`client/index.html`); se mudar a lista, atualize também `FONTS` em `client/src/lib/contract/model.js` e `FONT_KEYS` em `server/utils/contract.js`.
- **Produtos e serviços:** as imagens são reduzidas no navegador e aceitam PNG, JPG, WebP, GIF e HEIC/HEIF. Em *Produtos e serviços > Organizar categorias e opções*, cada usuário salva categorias, tipos de variação e nomes de preço para reutilizar. Cada variação descreve uma característica (como cor ou tamanho), sem preço próprio; o valor opcional é informado na forma de preço, cujo nome é personalizável.
- **Pedidos e PDV:** pedidos do catálogo ficam ativos por até 90 dias e depois são arquivados automaticamente por 20 dias antes da remoção. O PDV registra a origem da venda, atualiza o estoque dentro da transação do pedido, aceita dinheiro, cartão, Pix ou pagamento misto e pode imprimir um comprovante identificado como não fiscal. Os pedidos podem ser filtrados por origem; clientes podem ser cadastrados, editados e excluídos manualmente, com confirmação por PIN para edição e exclusão quando a conta tiver PIN configurado.
- **Clientes e estratégia:** os perfis de clientes não são apagados pela rotina automática de limpeza. A aba *Estratégia* preserva os resumos de vendas e permite filtrar até 90 dias, comparar clientes e visualizar regiões aproximadas pelo DDD. No aplicativo da loja, o administrador escolhe individualmente se cada acesso pode ver a Estratégia, Clientes ou a Frente de caixa.
- Usa o formato da Evolution API v2. Se a sua for a v1, ajuste os corpos das requisições em `server/services/evolution.js`.

## Auditoria de conversas

Tela **Auditoria** (`client/src/pages/Audit.jsx`): o usuário conecta números (só para auditar, separados dos WhatsApps de cobrança) e acompanha **ao vivo** todas as conversas, incluindo grupos.

- **Somente leitura.** Só o plano **Ouro** pode responder dentro da auditoria (`auditSend` em `server/plans.js`). A conexão de auditoria é criada com `readMessages: false`, então nada é marcado como lido no celular.
- **Ao vivo por três caminhos** (se um falhar, os outros cobrem):
  1. **Webhook** da Evolution/Meta → empurrado para a tela por Server-Sent Events (`GET /api/audit/stream`).
  2. **Consulta rápida** da tela a cada 4 s (`GET /api/audit/updates?after=`), que funciona mesmo se um proxy barrar o tempo real.
  3. **Busca automática do servidor** na Evolution (`server/services/audit-sync.js`): a cada `AUDIT_SYNC_SECONDS` (padrão 15) com alguém na tela, a cada `AUDIT_SYNC_IDLE_SECONDS` (padrão 300) sem ninguém. A **primeira busca traz o histórico todo** (até 1000 conversas e 500 mensagens por conversa) sem clicar em nada; `AUDIT_SYNC_SECONDS=0` desliga.
- **Requisitos da Evolution para o histórico e a busca automática:** ela precisa guardar os dados. No `.env` da Evolution: `DATABASE_ENABLED=true`, `DATABASE_SAVE_DATA_INSTANCE=true`, `DATABASE_SAVE_DATA_NEW_MESSAGE=true`, `DATABASE_SAVE_DATA_CONTACTS=true`, `DATABASE_SAVE_DATA_CHATS=true`. Sem isso `findChats/findMessages` voltam vazios. Para o histórico anterior à conexão, o número precisa ser conectado (QR) já com a auditoria ligada (`syncFullHistory`).
- **Não lidas por mensagem:** uma mensagem recebida é "não lida" até o auditor abrir a conversa, o dono responder (pelo celular ou pela tela) ou o WhatsApp avisar que foi lida. O histórico importado entra como lido. O contador de cada conversa é recalculado, e o título da aba mostra quantas conversas têm não lidas.
- **Filtros e busca:** Todas / Contatos / Grupos, por número, por etiqueta, "não lidas". A busca exige **todas as palavras** (no nome, número ou em qualquer mensagem), aceita frase entre aspas e ignora acentos e maiúsculas.
- **Nomes:** nome do contato (`pushName`), assunto do grupo e nome de quem falou em cada grupo (`audit_contacts`), atualizados por eventos e pela busca automática.
- **Mídia:** fotos, figurinhas, áudios, vídeos e documentos. O webhook é configurado com `base64: true` (o arquivo vem no evento); se não vier, fotos/áudios/figurinhas são baixados na hora via `getBase64FromMediaMessage` e vídeos/documentos quando alguém abre. Ficam em `audit_media` (máx. `AUDIT_MEDIA_MAX_MB`, padrão 20) porque o WhatsApp apaga os arquivos antigos. O endpoint `GET /api/audit/messages/:id/media` só serve ao dono, aceita Range (avançar em vídeo/áudio), serve SVG e documentos só como download e cai para a miniatura se o arquivo sumiu.
- **Ordem:** a lista é pela mensagem mais recente; dentro da conversa, por horário real (mensagem que chega atrasada entra no lugar certo). Data no futuro (relógio errado) é limitada a "agora".
- Etiquetas coloridas por usuário, **bloco de anotações** por conversa (salva sozinho) e mensagens editadas no WhatsApp atualizam o texto.
- **API oficial da Meta:** recebe só as mensagens novas, em `POST /api/webhooks/meta` (assinatura `X-Hub-Signature-256` com o **App Secret**, obrigatório na auditoria). Use a URL e o token de verificação do botão **Webhook** da conexão e assine o campo `messages`. As mídias são baixadas com o token quando alguém abre.
- Remover o número apaga as conversas, mídias, etiquetas e anotações dele. Use apenas em números que o usuário tem autorização para acompanhar (LGPD).

## WhatsApp: QR Code ou API oficial da Meta

Cada conexão (de **cobranças** ou de **auditoria**) pode usar **QR Code** (Evolution API) ou a **API oficial** (WhatsApp Cloud API). Campos da API oficial (`instances` no banco): Phone Number ID, ID da conta do WhatsApp Business (WABA), token de acesso, App Secret e token de verificação do webhook.

- Ao salvar, o sistema confere o token na Graph API da Meta. **Token e App Secret ficam criptografados** (AES-256-GCM) com `ENCRYPTION_KEY` (ou `JWT_SECRET`) e nunca voltam para o navegador. Defina uma `ENCRYPTION_KEY` fixa: se ela mudar, os tokens salvos precisam ser cadastrados de novo.
- As cobranças automáticas saem por qualquer conexão de envio conectada (QR Code ou API oficial).
- Regra da Meta: mensagem de texto livre só é aceita até 24 h depois da última mensagem do cliente; fora disso a Meta exige um modelo (template) aprovado, o que ainda não está implementado.
- A versão da Graph API fica em `META_API_VERSION` (padrão `v21.0`).

## Portfólio

Tela **Portfólio** (menu, logo abaixo de Auditoria): o usuário cria páginas públicas com a própria marca e envia o link.

- **Editor** (`client/src/pages/PortfolioEditor.jsx`, no mesmo estilo do de contratos): cor e fontes do tema, **banner**, **logo**, **imagem**, **galeria**, **vídeo** (YouTube, Vimeo ou arquivo `.mp4`/`.webm` por link https), **títulos e textos**, **botões com link** (site, WhatsApp, telefone ou e-mail), divisor e espaço. Arrastar para reordenar, desfazer/refazer, salvamento automático e visualização como no celular ou no computador. Começa em branco ou por um modelo pronto.
- **Domínio próprio:** em *Portfólio > Domínio próprio* o usuário cadastra o domínio dele (ex.: `usuario.com.br`). A página principal passa a abrir em `usuario.com.br` e as demais em `usuario.com.br/<página>`, em vez de `sistema.com.br/<usuário>` (o endereço antigo continua funcionando). O IP do servidor vem da variável `SERVER_IP` do `.env`: o usuário cria no DNS dele um registro **tipo A** (nome `@`, e `www` se quiser) apontando para esse IP e clica em *Verificar agora*. O domínio só passa a atender depois que o DNS aponta para `SERVER_IP` (ou é um CNAME para o `APP_URL`); sem `SERVER_IP` o domínio é aceito sem conferir. Em domínio próprio só as rotas públicas do portfólio respondem (sem login nem painel). Durante o teste grátis, esse recurso fica bloqueado.
  - **HTTPS:** o servidor não emite certificados. Na EasyPanel, adicione o domínio do usuário na aba *Domínios* do serviço (o Traefik emite o certificado). Com Caddy, use `on_demand_tls { ask https://SISTEMA/api/public/domain-check }`: a rota responde 200 só para domínio verificado.
  - **Cloudflare:** com a nuvem laranja (proxy) o registro A não mostra o IP do servidor e a verificação falha; use a nuvem cinza (somente DNS).
- **Endereço:** `dominio/<nome completo ou razão social>` abre a **página principal**; as demais ficam em `dominio/<nome>/<página>`. O endereço do usuário é criado na primeira página, sem acento e em minúsculas (`Padaria São João Ltda.` vira `padaria-sao-joao-ltda`), e **não muda mais**, para os links já enviados não quebrarem. Se outro usuário já tiver o mesmo nome, vira `-2`, `-3`. Nomes de telas do sistema (`admin`, `contratos`, `portfolio`...) são reservados.
- **Limite por plano:** Bronze 1 página, Prata 2, Ouro 7 (o admin tem o limite do Ouro).
- **Compartilhar:** **Copiar link**, enviar por WhatsApp ou e-mail e o compartilhamento do aparelho. O link mostra título, descrição e imagem no WhatsApp e nas redes sociais.
- **Publicar:** a página nasce como rascunho (só o dono vê). Publicada, qualquer pessoa abre sem login, **enquanto o dono tiver acesso ao sistema** (teste grátis ou plano pago).
- **Segurança:** o servidor reconstrói o documento só com campos conhecidos. Links dos botões só `http`/`https`, vídeo só dos provedores acima e imagens PNG, JPG, WebP ou GIF (SVG é recusado).

## Contratos com variáveis do cliente

Nos textos do contrato (e no texto antes da data) o usuário pode usar variáveis, que viram os dados do cliente escolhido:

- **Cliente:** `{{cliente.nome}}`, `{{cliente.documento}}` (CPF/CNPJ), `{{cliente.email}}`, `{{cliente.telefone}}`, `{{cliente.endereco}}` (montado com rua, número, complemento, bairro, cidade/UF e CEP), `{{cliente.cep}}`, `{{cliente.rua}}`, `{{cliente.numero}}`, `{{cliente.complemento}}`, `{{cliente.bairro}}`, `{{cliente.cidade}}`, `{{cliente.estado}}`, `{{cliente.observacoes}}`.
- **Minha empresa** (dados do usuário logado): `{{empresa.nome}}`, `{{empresa.documento}}`, `{{empresa.email}}`, `{{empresa.telefone}}`.
- **Data:** `{{data.hoje}}`, `{{data.hoje_curta}}`, `{{data.dia}}`, `{{data.mes}}`, `{{data.ano}}`.

No editor: botão **Variável** (paleta) e a lista no painel de propriedades inserem a variável no cursor (ou numa nova caixa). **Ver com cliente** mostra o contrato preenchido e o **PDF / Imprimir** já sai com os dados dele; o que o cliente não tem cadastrado sai como `________` e é listado em um aviso. Na lista de contratos, **Gerar para cliente** abre o contrato já preenchido. O cadastro de cliente ganhou CPF/CNPJ e endereço (opcionais) para isso. Uma variável escrita errada (ex.: `{{cliente.xyz}}`) fica visível no texto.

## Administração de usuários

- A lista mostra o **telefone** (link para o WhatsApp) e a **última atividade**: a última vez que o usuário *alterou* algo (cadastrar, salvar, enviar, excluir...) e em que área. Só olhar telas ou atualizações automáticas não contam; a gravação é feita no máximo a cada 30 s.
- **Dar acesso mensal** (+30 dias) e **Dar teste** (+dias de teste configurados no painel admin) ficam registrados em `access_events`.
- **Retroceder** desfaz a última liberação do administrador (uma por vez, da mais nova para a mais antiga). Se o usuário pagou depois, o pagamento é preservado: só saem os dias que o admin tinha dado.
