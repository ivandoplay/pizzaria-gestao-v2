#!/usr/bin/env bash
# =============================================================================
# Executa SQL em um projeto Supabase na nuvem, sem instalar a CLI.
#
# Útil para: aplicar migrações em ordem, rodar consultas de conferência e
# aplicar a suíte de testes (supabase/tests/*.sql) contra o banco real.
#
# Uso:
#   export SUPABASE_ACCESS_TOKEN=...   # token pessoal (Account → Access Tokens)
#   export SUPABASE_PROJECT_REF=...    # ex.: abcdefghijklmnop
#   bash tools/supabase-cloud-sql.sh supabase/migrations/20260101000001_foundation.sql
#   echo "select current_user" | bash tools/supabase-cloud-sql.sh -
#
# NUNCA coloque o token em arquivo versionado: use variável de ambiente.
# O token dá acesso administrativo à sua conta Supabase — trate como senha.
# =============================================================================
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?defina SUPABASE_ACCESS_TOKEN (token pessoal do Supabase)}"
: "${SUPABASE_PROJECT_REF:?defina SUPABASE_PROJECT_REF (ref do projeto)}"

ARQUIVO="${1:--}"

python3 - "$SUPABASE_ACCESS_TOKEN" "$SUPABASE_PROJECT_REF" "$ARQUIVO" <<'PY'
import json, sys, urllib.error, urllib.request

token, ref, origem = sys.argv[1], sys.argv[2], sys.argv[3]
sql = sys.stdin.read() if origem == '-' else open(origem, encoding='utf-8').read()

if not sql.strip():
    print('nada a executar (SQL vazio)', file=sys.stderr)
    sys.exit(2)

requisicao = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/{ref}/database/query',
    data=json.dumps({'query': sql}).encode(),
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    method='POST',
)

try:
    with urllib.request.urlopen(requisicao, timeout=300) as resposta:
        corpo = resposta.read().decode()
    print(corpo if corpo.strip() else '(ok, sem linhas retornadas)')
except urllib.error.HTTPError as erro:
    # Falha em qualquer instrução aborta o arquivo inteiro (equivale a ON_ERROR_STOP=1),
    # então "sem erro" significa que todo o SQL passou — inclusive as asserções dos testes.
    print(f'ERRO HTTP {erro.code}', file=sys.stderr)
    print(erro.read().decode()[:2000], file=sys.stderr)
    sys.exit(1)
PY
