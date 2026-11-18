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
MIGRATION_NAME="20261118130000_background_cleanup_indexes"
MIGRATION_FILE="prisma/migrations/$MIGRATION_NAME/migration.sql"
if migration_output="$(./node_modules/.bin/prisma migrate deploy 2>&1)"; then
  printf '%s\n' "$migration_output"
else
  migration_status=$?
  printf '%s\n' "$migration_output" >&2
  if printf '%s' "$migration_output" | grep -q 'P3009' \
    && printf '%s' "$migration_output" | grep -q "$MIGRATION_NAME"; then
    if [ ! -f "$MIGRATION_FILE" ]; then
      echo "[start] ERRO: arquivo da migração $MIGRATION_NAME não encontrado." >&2
      exit 1
    fi
    if grep -q 'CONCURRENTLY' "$MIGRATION_FILE"; then
      echo "[start] ERRO: a migração $MIGRATION_NAME ainda usa SQL antigo; atualize o código antes de iniciar." >&2
      exit 1
    fi
    if ! grep -q 'DROP INDEX IF EXISTS "instances_purpose_provider_idx"' "$MIGRATION_FILE"; then
      echo "[start] ERRO: a migração $MIGRATION_NAME não contém a correção segura para nova tentativa." >&2
      exit 1
    fi
    echo "[start] Recuperando a tentativa falha conhecida ($MIGRATION_NAME)..."
    if ! ./node_modules/.bin/prisma migrate resolve --rolled-back "$MIGRATION_NAME"; then
      echo "[start] ERRO ao liberar a tentativa falha da migração." >&2
      exit 1
    fi
    if ! ./node_modules/.bin/prisma migrate deploy; then
      echo "[start] ERRO ao reaplicar migrações após a recuperação." >&2
      exit 1
    fi
  else
    echo "[start] ERRO ao preparar o banco de dados." >&2
    echo "[start] - Confira a DATABASE_URL (usuário, senha, host e nome do banco)." >&2
    echo "[start] - P3009 em outra migração exige revisar o erro salvo em _prisma_migrations antes de resolvê-la." >&2
    echo "[start] - P3005 indica que o banco já tem tabelas fora do histórico do Prisma; não crie outro banco sem verificar os dados." >&2
    exit "$migration_status"
  fi
fi

echo "[start] Iniciando a aplicação..."
exec node server/index.js