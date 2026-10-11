# DM Financeiro

SaaS para enviar **cobranças** e **lembretes** pelo WhatsApp (via Evolution API), com teste grátis de 3 dias e cobrança do plano por link da InfinitePay.

**Stack:** Node.js + Express + SQLite (backend) · React + Vite (frontend).

## Como rodar

```bash
npm install
cp .env.example .env     # preencha o .env (veja abaixo)
npm run dev              # API em :3001 e front em http://localhost:5173
```

Produção: `npm run build` e depois `npm start` (o próprio servidor entrega o front na porta definida em `PORT`).

Teste automático do backend (usa Evolution e InfinitePay simuladas, não precisa de nada configurado): `npm run smoke`.

## O que preencher no `.env`

| Variável | Para quê |
|---|---|
| `APP_URL` | Endereço público do sistema. Dev: `http://localhost:5173`. Produção: seu domínio com `https`. |
| `JWT_SECRET` | Frase longa e aleatória que assina o login. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Conta admin, criada sozinha na primeira execução. |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | Sua Evolution API (v2). |
| `INFINITEPAY_HANDLE` | Sua InfiniteTag, sem o `$`. |
| `PLAN_BRONZE_PRICE`, `PLAN_PRATA_PRICE`, `PLAN_OURO_PRICE` | Preço mensal de cada plano, em reais. |
| `TRIAL_DAYS` / `ACCESS_DAYS` | Dias de teste grátis (3) e dias liberados por pagamento (30). |

## Como funciona

- **Cadastro:** pessoa física (CPF) ou jurídica (CNPJ), validados. Toda conta entra com role `usuario` e 3 dias grátis.
- **Planos e limites:**

  | Plano | WhatsApps | Modelos de contrato |
  |---|---|---|
  | Bronze | 1 | 1 |
  | Prata | 1 | 3 |
  | Ouro | 3 | 4 |

  O admin vê a lista de usuários, exclui contas, troca o plano e dá acesso mensal (+30 dias).
- **Depois do teste:** o acesso é bloqueado e o usuário vai para a tela de plano. Ele paga pelo link da InfinitePay, volta ao sistema e o acesso é liberado por 30 dias. A confirmação é sempre checada direto com a InfinitePay (`payment_check`), nunca confiando só no que chega pelo navegador ou pelo webhook.
- **WhatsApp:** a instância se chama como o CPF/CNPJ do usuário (a 2ª e 3ª do plano Ouro ganham `-2` e `-3`). Luz verde = conectado, vermelha = desconectado, atualizada a cada poucos segundos.
- **Mensagens:** com link ou Pix, a mensagem sai em **2 blocos** (texto e, logo depois, só o link/chave), o que facilita copiar e colar. Sem link, sai em 1.

## Observações

- O webhook da InfinitePay (`/api/webhooks/infinitepay`) só é informado quando `APP_URL` começa com `https`. Em ambiente local o pagamento é confirmado pela página de retorno.
- A tela de **Contratos** está como "Em breve": os limites por plano já existem no backend, falta a criação dos modelos.
- Este projeto usa o formato da Evolution API v2. Se a sua for a v1, ajuste os corpos das requisições em `server/services/evolution.js`.
