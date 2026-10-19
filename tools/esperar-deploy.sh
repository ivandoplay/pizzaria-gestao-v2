#!/usr/bin/env bash
# =============================================================================
# Espera um deploy publicado estar na versão que acabou de ser enviada.
#
# Por que existe: o bundle muda a cada build (o carimbo de versão entra no
# conteúdo), então comparar o nome do arquivo não serve mais. Aqui o script
# abre a tela de entrada do site e espera o rodapé mostrar o commit esperado —
# exatamente o que o operador vê quando quer saber se está na versão nova.
#
# Uso:
#   bash tools/esperar-deploy.sh https://pizzaria-gestao-v2.vercel.app            # espera o HEAD local
#   bash tools/esperar-deploy.sh https://pizzaria-gestao-v2.vercel.app 1ddd20a    # espera um commit específico
#   ESPERA=600 bash tools/esperar-deploy.sh <URL>                                 # tempo máximo em segundos
#
# Exige Playwright instalado (não é dependência do projeto):
#   npm i --no-save playwright && npx playwright install chromium && npx playwright install-deps chromium
# =============================================================================
set -uo pipefail

BASE="${1:-}"
ESPERADO="${2:-}"
ESPERA="${ESPERA:-600}"
INTERVALO="${INTERVALO:-15}"

if [ -z "$BASE" ]; then
  echo "Uso: bash tools/esperar-deploy.sh <URL> [commit]" >&2
  exit 2
fi
BASE="${BASE%/}"

if [ -z "$ESPERADO" ]; then
  ESPERADO=$(git rev-parse --short HEAD 2>/dev/null || echo "")
  if [ -z "$ESPERADO" ]; then
    echo "Não consegui descobrir o commit local — informe o commit como 2º argumento." >&2
    exit 2
  fi
fi

echo "== Esperando a versão '$ESPERADO' em $BASE (máx. ${ESPERA}s)"

FIM=$(( $(date +%s) + ESPERA ))
while [ "$(date +%s)" -lt "$FIM" ]; do
  VISTO=$(node - "$BASE" <<'JS' 2>/dev/null
import { chromium } from 'playwright'
const base = process.argv[2]
const b = await chromium.launch()
try {
  const p = await b.newPage()
  await p.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  // A tela é carregada sob demanda: esperar um tempo fixo dava leitura vazia
  // ("não consegui ler") quando o bundle demorava. Espera o texto aparecer.
  await p
    .waitForFunction(() => /versão [0-9a-f]{7}/.test(document.body.innerText), undefined, { timeout: 15000 })
    .catch(() => {})
  const texto = await p.locator('body').innerText()
  const m = texto.match(/versão ([0-9a-f]{7})/)
  process.stdout.write(m ? m[1] : '')
} catch {
  process.stdout.write('')
} finally {
  await b.close()
}
JS
)
  if [ "$VISTO" = "$ESPERADO" ]; then
    echo "  OK    o site publicado já está na versão $ESPERADO"
    exit 0
  fi
  echo "  ... versão publicada: ${VISTO:-'(não consegui ler)'} — aguardando $INTERVALO s"
  sleep "$INTERVALO"
done

echo "  FALHA passou do tempo de espera e a versão publicada ainda não é $ESPERADO" >&2
exit 1
