# DM Financeiro

SaaS para enviar **cobranças** e **lembretes** pelo WhatsApp (via Evolution API), com teste grátis de 3 dias e cobrança do plano por link da InfinitePay.

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

Teste automático do backend (cria um banco temporário, usa Evolution e InfinitePay simuladas):

```bash
SMOKE_DATABASE_URL="postgres://usuario:senha@localhost:5432/postgres" npm run smoke
```

## Banco de dados

`DATABASE_URL` no formato `postgres://USUARIO:SENHA@HOST:5432/BANCO?sslmode=disable`.

- Use um banco **só para este sistema**. O Prisma recusa criar tabelas em um banco que já tem outras (erro `P3005`).
- Senha com caracteres especiais (`@ : / ? # %`) precisa ser codificada (`@` vira `%40`).
- Tabelas: `users`, `instances`, `payments`, `contacts` (clientes), `schedules` (cobranças e lembretes agendados), `messages` (histórico) e `billing_payments` (cobranças marcadas como pagas).

## O que o sistema faz

- **Cadastro:** pessoa física (CPF) ou jurídica (CNPJ), validados. Toda conta entra com role `usuario` e 3 dias grátis.
- **Planos:** Bronze (1 WhatsApp, 1 modelo de contrato), Prata (1 WhatsApp, 3 contratos), Ouro (3 WhatsApps, 4 contratos). O admin lista e exclui usuários, troca o plano e dá acesso mensal (+30 dias).
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
3. Em **Ambiente**, preencha as variáveis do `.env.example` (sem aspas). As obrigatórias: `DATABASE_URL`, `APP_URL` (https), `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `INFINITEPAY_HANDLE`.
4. Faça o deploy. Ao iniciar, o container roda `prisma migrate deploy` (cria as tabelas) e depois liga o sistema. Não precisa de volume: tudo fica no PostgreSQL.

Se o PostgreSQL estiver no mesmo EasyPanel, use o nome interno do serviço no host da `DATABASE_URL`.

## Observações

- O webhook da InfinitePay (`/api/webhooks/infinitepay`) só é informado quando `APP_URL` começa com `https`. Em ambiente local o pagamento é confirmado pela página de retorno.
- **Contratos:** editor visual de modelos (tela cheia, páginas A4 retrato/paisagem) em `client/src/pages/ContractEditor.jsx`.
  - Criar do zero (em branco ou modelo pronto) ou **importar** `.docx` (Word), `.html`, `.txt`, `.json` (modelo exportado daqui) ou imagem (vira fundo). PDF e `.doc` antigo não são editáveis: abra no Word/Google Docs e salve como `.docx`. Na importação de `.docx`/HTML, cabeçalhos/rodapés e formatação no meio da frase (ex.: uma palavra em negrito) não são trazidos, e tabelas viram uma linha de texto por linha.
  - Elementos: título, subtítulo, texto, data (automática ou fixa), cápsula, imagem/logo, linha e retângulo. Arrastar, redimensionar, guias de alinhamento, fonte/tamanho/cor/alinhamento, camadas, travar, alinhar na página, blocos prontos (cabeçalho, assinaturas, rodapé), várias páginas, desfazer/refazer (Ctrl+Z / Ctrl+Y), salvamento automático.
  - **PDF / Imprimir** usa o diálogo do navegador ("Salvar como PDF"); **Exportar** baixa o modelo em `.json`.
  - Imagens são reduzidas no navegador e ficam dentro do contrato (limite de ~9 MB por contrato). O servidor valida e limpa o documento (`server/utils/contract.js`) e limita a quantidade de modelos por plano.
  - As fontes vêm do Google Fonts (`client/index.html`); se mudar a lista, atualize também `FONTS` em `client/src/lib/contract/model.js` e `FONT_KEYS` em `server/utils/contract.js`.
- Usa o formato da Evolution API v2. Se a sua for a v1, ajuste os corpos das requisições em `server/services/evolution.js`.
