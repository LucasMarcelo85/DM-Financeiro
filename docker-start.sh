#!/bin/sh
# Inicialização do container: cria/atualiza as tabelas do banco (Prisma) e liga a aplicação.
set -e

# Algumas plataformas entregam o valor com aspas literais (ex.: "postgres://..."): remove.
strip_quotes() { printf '%s' "$1" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }

if [ -z "$DATABASE_URL" ]; then
  echo "[start] ERRO: a variável DATABASE_URL não foi definida." >&2
  echo "[start] Exemplo: postgres://usuario:senha@host:5432/banco?sslmode=disable" >&2
  exit 1
fi
DATABASE_URL="$(strip_quotes "$DATABASE_URL")"
export DATABASE_URL

echo "[start] Aplicando migrações do banco (prisma migrate deploy)..."
if ! ./node_modules/.bin/prisma migrate deploy; then
  echo "[start] ERRO ao preparar o banco de dados." >&2
  echo "[start] - Confira a DATABASE_URL (usuário, senha, host e nome do banco)." >&2
  echo "[start] - Se aparecer o erro P3005, o banco já tem outras tabelas: crie um banco novo só para este sistema." >&2
  exit 1
fi

echo "[start] Iniciando a aplicação..."
exec node server/index.js