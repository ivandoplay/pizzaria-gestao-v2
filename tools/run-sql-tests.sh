#!/usr/bin/env bash
# =============================================================================
# Runner de testes do BANCO — executa as migrações e a suíte contra um
# PostgreSQL 17 local que emula o ambiente Supabase (tools/local_pg_shim.sql).
#
# Uso:  bash tools/run-sql-tests.sh
# Exit code 0 = todos os testes passaram.
# =============================================================================
set -euo pipefail

DB="${DB:-pizzaria_test}"
PSQL=(psql -q -v ON_ERROR_STOP=1 -d "$DB")
LOG_DIR="$(mktemp -d)"
FAILED=0

run() {  # run <rótulo> <arquivo>
  local label="$1" file="$2"
  if sudo -u postgres "${PSQL[@]}" -f "$file" >"$LOG_DIR/$(basename "$file").log" 2>&1; then
    echo "  ✔ $label"
  else
    echo "  ✘ $label  (veja o log abaixo)"
    grep -E "ASSERT FALHOU|ERROR|ERRO" "$LOG_DIR/$(basename "$file").log" | head -20 || true
    FAILED=1
  fi
}

echo "== Recriando o banco de testes ($DB) =="
sudo -u postgres psql -q -c "drop database if exists $DB;" -c "create database $DB owner postgres;"

echo "== Aplicando shim do ambiente Supabase =="
sudo -u postgres "${PSQL[@]}" -f tools/local_pg_shim.sql >"$LOG_DIR/shim.log" 2>&1

echo "== Aplicando migrações (na ordem) =="
for f in supabase/migrations/*.sql; do
  run "migração $(basename "$f")" "$f"
done

echo "== Aplicando seed estrutural =="
run "seed_structure" supabase/seed/seed_structure.sql

echo "== Preparando usuários/perfis de teste =="
run "00_setup" supabase/tests/00_setup.sql

echo "== Executando a suíte =="
for f in supabase/tests/0[1-9]_*.sql; do
  run "$(basename "$f")" "$f"
done

echo "== Teste de concorrência (processos paralelos reais) =="
if bash supabase/tests/07_concurrency.sh >"$LOG_DIR/concurrency.log" 2>&1; then
  echo "  ✔ 07_concurrency"
  grep -E "^  OK" "$LOG_DIR/concurrency.log" || true
else
  echo "  ✘ 07_concurrency"
  cat "$LOG_DIR/concurrency.log"
  FAILED=1
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "=============================================="
  echo " TODOS OS TESTES DE BANCO PASSARAM"
  echo "=============================================="
  echo "Asserções executadas: $(grep -rhoE 'NOTICE:.*OK' "$LOG_DIR" | wc -l)"
else
  echo "=============================================="
  echo " HOUVE FALHAS — veja os logs acima"
  echo "=============================================="
fi
exit "$FAILED"
