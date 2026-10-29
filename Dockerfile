# syntax=docker/dockerfile:1

# ---------- Etapa 1: instala dependências, gera o Prisma e o front (Vite) ----------
FROM node:22-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# URL fictícia só para o "prisma generate" (ele não conecta no banco). Não vai para a imagem final.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

WORKDIR /app

COPY package.json package-lock.json ./
COPY postcss.config.cjs tailwind.config.cjs ./
COPY prisma ./prisma
RUN npm ci

COPY client ./client
RUN npm run build

# Remove o que só serve para construir (vite, concurrently...) e gera o cliente do Prisma de novo
# (o "prune" apaga o cliente gerado).
RUN npm prune --omit=dev \
 && npx prisma generate


# ---------- Etapa 2: imagem final, enxuta ----------
FROM node:22-bookworm-slim

# tini: encerra o container direto ao parar/redeployar. openssl: exigido pelo Prisma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001 \
    TRUST_PROXY=1 \
    APP_TIMEZONE=America/Sao_Paulo \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./
COPY prisma ./prisma
COPY server ./server
COPY scripts ./scripts
COPY docker-start.sh /usr/local/bin/docker-start.sh

# "sed" tira quebras de linha do Windows (CRLF), que impedem o script de rodar no Linux.
RUN sed -i 's/\r$//' /usr/local/bin/docker-start.sh \
 && chmod +x /usr/local/bin/docker-start.sh \
 && chown -R node:node /app

USER node

EXPOSE 3001

# O banco guarda tudo: não há pasta de dados para montar como volume.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["docker-start.sh"]