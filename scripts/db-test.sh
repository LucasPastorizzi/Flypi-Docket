#!/usr/bin/env bash
# ============================================================================
# Roda a suíte de banco num Postgres nu — sem Docker, sem supabase start.
#
# Recria o banco do zero a cada execução. Não é zelo excessivo: teste de RLS
# que herda estado de uma execução anterior pode passar porque a linha que
# deveria vazar não existe mais, e esse é o falso negativo mais caro possível
# aqui.
#
# Uso:  scripts/db-test.sh [arquivo_de_teste.sql ...]
# Variáveis: PGHOST PGPORT PGUSER PGDATABASE (padrões abaixo)
# ============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-55432}"
export PGUSER="${PGUSER:-postgres}"
DB="${PGDATABASE:-flypi_docket_test}"
unset PGDATABASE

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$raiz"

psql -q -d postgres -v ON_ERROR_STOP=1 \
  -c "drop database if exists $DB with (force);" \
  -c "create database $DB;"

export PGDATABASE="$DB"

psql -q -v ON_ERROR_STOP=1 -c "create extension if not exists pgtap;"

# Ordem obrigatória: o ambiente emulado primeiro, porque as migrations criam
# FK para auth.users e concedem privilégio para os roles do Supabase.
for f in supabase/tests/helpers/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -f "$f"
done

for f in supabase/migrations/*.sql; do
  echo "-- migration: $(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -f "$f"
done

if [ "$#" -gt 0 ]; then
  testes=("$@")
else
  testes=(supabase/tests/*.sql)
fi

# Parse do TAP em bash em vez de pg_prove: pg_prove exige Perl com
# TAP::Harness, e uma dependência a mais na máquina de quem desenvolve não se
# justifica para contar linhas que começam com "not ok".
falhas=0
total=0
for t in "${testes[@]}"; do
  [ -e "$t" ] || continue
  echo
  echo "=== $(basename "$t") ==="
  saida="$(psql -q -t -A -v ON_ERROR_STOP=1 -f "$t" 2>&1)" || {
    echo "$saida"
    echo "ERRO FATAL ao executar $t"
    falhas=$((falhas + 1))
    continue
  }
  echo "$saida"
  n_falhas="$(printf '%s\n' "$saida" | grep -c '^not ok' || true)"
  n_ok="$(printf '%s\n' "$saida" | grep -c '^ok ' || true)"
  total=$((total + n_ok + n_falhas))
  falhas=$((falhas + n_falhas))

  # Divergência entre o plano e o que rodou é falha, não observação. Sem isto,
  # um teste acrescentado e um `plan()` esquecido fazem a suíte anunciar
  # sucesso enquanto o pgTAP avisa que o número não fecha — e o aviso passa
  # por comentário TAP, que nenhuma contagem de "not ok" pega.
  if printf '%s\n' "$saida" | grep -q 'Looks like you planned'; then
    echo ">>> PLANO DIVERGENTE: o arquivo declara um número de testes "
    echo ">>> diferente do que executou. Ajuste o plan()."
    falhas=$((falhas + 1))
  fi
done

echo
echo "============================================================"
if [ "$falhas" -eq 0 ] && [ "$total" -gt 0 ]; then
  echo "TODOS OS $total TESTES PASSARAM"
  exit 0
elif [ "$total" -eq 0 ]; then
  echo "NENHUM TESTE EXECUTADO — a suíte não pode passar vazia"
  exit 1
else
  echo "$falhas de $total TESTES FALHARAM"
  exit 1
fi
