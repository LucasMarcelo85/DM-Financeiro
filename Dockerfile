# syntax=docker/dockerfile:1

# ---------- Etapa 1: instala dependências e gera o front (Vite) ----------
FROM node:22-bookworm-slim AS build

# Ferramentas de compilação: só entram se o better-sqlite3 não tiver binário pronto
# para a arquitetura do servidor. Ficam apenas nesta etapa, não vão para a imagem final.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY client ./client
RUN npm run build

# Remove o que só é usado para construir (vite, concurrently...).
RUN npm prune --omit=dev


# ---------- Etapa 2: imagem final, enxuta ----------
FROM node:22-bookworm-slim

# tini: encerra o container direto ao parar/redeployar e fecha o banco com segurança.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001 \
    TRUST_PROXY=1 \
    DB_PATH=/app/data/dm-financeiro.db

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./
COPY server ./server

RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# O volume do EasyPanel chega como root: ajusta a permissão da pasta de dados
# e só então roda a aplicação como usuário comum (sem privilégios).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "chown -R node:node /app/data && exec setpriv --reuid=node --regid=node --init-groups node server/index.js"]