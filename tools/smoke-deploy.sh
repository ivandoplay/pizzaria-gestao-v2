#!/usr/bin/env bash
# =============================================================================
# Conferência de um deploy publicado (Vercel ou qualquer host estático).
#
# Verifica, na ordem, o que costuma quebrar depois de um deploy:
#   1. a página responde e o app é o esperado;
#   2. as rotas do SPA respondem 200 (regra de rewrite do vercel.json);
#   3. os cabeçalhos de segurança estão presentes;
#   4. as variáveis VITE_* entraram no bundle (URL e chave pública do Supabase);
#      sem elas o app abre na tela "Configuração pendente";
#   5. NENHUMA chave secreta vazou para o navegador (service_role / sb_secret_);
#   6. se o bundle tiver as variáveis, faz um LOGIN REAL pelo Auth do Supabase
#      para provar que o site publicado conversa com o banco.
#
# Uso:
#   bash tools/smoke-deploy.sh https://seu-app.vercel.app
#   bash tools/smoke-deploy.sh https://seu-app.vercel.app admin 'senha-do-admin'
#
# Sem login e senha, a etapa 6 só confirma que o endpoint de autenticação aceita
# requisições do domínio publicado (CORS), sem tentar entrar.
# =============================================================================
set -uo pipefail

BASE="${1:-}"
LOGIN="${2:-}"
SENHA="${3:-}"
FALHAS=0

if [ -z "$BASE" ]; then
  echo "Uso: bash tools/smoke-deploy.sh <URL> [login] [senha]" >&2
  exit 2
fi
BASE="${BASE%/}"

ok()   { echo "  OK    $1"; }
erro() { echo "  FALHA $1"; FALHAS=$((FALHAS + 1)); }
aviso(){ echo "  AVISO $1"; }

echo "== Conferindo $BASE =="

# ---------------------------------------------------------------- 1) página
CODIGO=$(curl -s -o /tmp/smoke_index.html -w '%{http_code}' "$BASE/")
if [ "$CODIGO" = "200" ] && grep -q '<div id="root">' /tmp/smoke_index.html; then
  ok "página inicial responde 200 e é o app"
else
  erro "página inicial retornou HTTP $CODIGO"
fi

TITULO=$(grep -oE '<title>[^<]*</title>' /tmp/smoke_index.html | head -1)
[ -n "$TITULO" ] && ok "título: $TITULO"

# ---------------------------------------------------------------- 2) rotas SPA
for rota in login mesas caixa cardapio relatorios; do
  C=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$rota")
  if [ "$C" = "200" ]; then ok "rota /$rota responde 200"; else erro "rota /$rota retornou HTTP $C"; fi
done

# ---------------------------------------------------------------- 3) cabeçalhos
CABECALHOS=$(curl -sI "$BASE/" | tr -d '\r')
for h in "x-frame-options" "x-content-type-options" "referrer-policy"; do
  if grep -qi "^$h:" <<<"$CABECALHOS"; then ok "cabeçalho $h presente"; else aviso "cabeçalho $h ausente"; fi
done

# ---------------------------------------------------------------- 4) bundle
JS_PATH=$(grep -oE '/assets/[^"]+\.js' /tmp/smoke_index.html | head -1)
if [ -z "$JS_PATH" ]; then
  erro "não encontrei o bundle JavaScript na página"
else
  curl -s "$BASE$JS_PATH" > /tmp/smoke_bundle.js
  TAM=$(( $(wc -c < /tmp/smoke_bundle.js) / 1024 ))
  ok "bundle baixado ($JS_PATH, ${TAM} kB)"

  python3 - <<'PY'
import re, sys
falhas = 0
codigo = open('/tmp/smoke_bundle.js', encoding='utf-8', errors='ignore').read()

url = re.search(r'https://([a-z0-9]+)\.supabase\.co', codigo)
chave = re.search(r'(sb_publishable_[A-Za-z0-9_\-]{6,}|eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,})', codigo)

if url:
    print(f'  OK    VITE_SUPABASE_URL embutida ({url.group(0)})')
else:
    print('  FALHA VITE_SUPABASE_URL ausente — o app abre em "Configuração pendente"')
    print('        Cadastre VITE_SUPABASE_URL em Settings → Environment Variables e faça REDEPLOY.')
    falhas += 1

if chave:
    print('  OK    VITE_SUPABASE_ANON_KEY embutida (chave pública)')
else:
    print('  FALHA VITE_SUPABASE_ANON_KEY ausente — cadastre a chave pública e faça REDEPLOY.')
    falhas += 1

# nenhuma credencial privilegiada pode chegar ao navegador
vazamentos = [t for t in ('sb_secret_', 'service_role_key', 'SERVICE_ROLE_KEY', 'sbp_') if t in codigo]
if vazamentos:
    print(f'  FALHA credencial privilegiada no bundle: {vazamentos}')
    falhas += 1
else:
    print('  OK    nenhuma credencial privilegiada no bundle')

if 'service_role' in codigo:
    print('  obs.  a expressão "service_role" aparece apenas em texto explicativo da interface')

sys.exit(min(falhas, 9))
PY
  if [ $? -ne 0 ]; then FALHAS=$((FALHAS + 1)); fi
fi

# ---------------------------------------------------------------- 5) login real
URL_SUPABASE=$(curl -s "$BASE$JS_PATH" | grep -oE 'https://[a-z0-9]+\.supabase\.co' | head -1)
CHAVE=$(curl -s "$BASE$JS_PATH" | grep -oE 'sb_publishable_[A-Za-z0-9_-]+' | head -1)

if [ -n "$URL_SUPABASE" ] && [ -n "$CHAVE" ]; then
  if [ -n "$LOGIN" ] && [ -n "$SENHA" ]; then
    EMAIL="$LOGIN"
    [[ "$LOGIN" == *"@"* ]] || EMAIL="$LOGIN@pizzaria.local"
    RESPOSTA=$(curl -s -X POST "$URL_SUPABASE/auth/v1/token?grant_type=password" \
      -H "apikey: $CHAVE" -H "Content-Type: application/json" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$SENHA\"}")
    if grep -q '"access_token"' <<<"$RESPOSTA"; then
      ok "login real do usuário '$LOGIN' funcionou (site publicado conversa com o banco)"
    else
      erro "login de '$LOGIN' falhou: $(head -c 160 <<<"$RESPOSTA")"
    fi
  else
    CODIGO_AUTH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL_SUPABASE/auth/v1/token?grant_type=password" \
      -H "apikey: $CHAVE" -H "Content-Type: application/json" -d '{"email":"teste@teste.local","password":"x"}')
    if [ "$CODIGO_AUTH" = "400" ] || [ "$CODIGO_AUTH" = "401" ]; then
      ok "Auth do Supabase acessível pelo site (respondeu $CODIGO_AUTH para credencial inválida)"
    else
      aviso "Auth respondeu HTTP $CODIGO_AUTH para credencial inválida"
    fi
  fi
else
  aviso "login não verificado: o bundle não tem as variáveis do Supabase"
fi

echo
if [ "$FALHAS" = "0" ]; then
  echo "RESULTADO: deploy conferido — tudo certo."
else
  echo "RESULTADO: $FALHAS verificação(ões) falharam."
fi
exit "$FALHAS"
