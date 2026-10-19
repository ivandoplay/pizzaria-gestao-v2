#!/usr/bin/env node
/**
 * =============================================================================
 * Aceitação do CLIENTE RECORRENTE e do FILTRO POR FORMA DE PAGAMENTO.
 *
 * Duas exigências do prompt mestre que faltavam e passaram a existir em 19/10:
 *
 *   §8.1 — "permitir localizar clientes recorrentes por telefone". O robô digita
 *          o telefone de um cliente que já tem entrega e confere que a tela
 *          mostra o cartão “Cliente recorrente” e que o botão preenche
 *          rua, número e bairro com os dados da última entrega.
 *   §5.5 — histórico com filtro por forma de pagamento. O robô filtra por
 *          "Dinheiro" (tem histórico), confere que volta pedido, e por uma forma
 *          sem recebimento, conferindo que a tela diz que não há pedido.
 *
 * O robô NÃO cria pedido: abre o formulário, confere os campos e fecha. Nenhum
 * dado de produção é alterado.
 *
 * Uso:
 *   PZ_CAIXA_PASSWORD=... node tools/e2e-recorrente.mjs https://pizzaria-gestao-v2.vercel.app
 *   PZ_TELEFONE=86988110001 (padrão) — telefone de um cliente já cadastrado
 * =============================================================================
 */
import { chromium } from 'playwright'

const base = process.argv[2]
if (!base) {
  console.error('Uso: node tools/e2e-recorrente.mjs <URL>')
  process.exit(2)
}
const senha = process.env.PZ_CAIXA_PASSWORD
if (!senha) {
  console.error('Defina PZ_CAIXA_PASSWORD.')
  process.exit(2)
}
const telefone = process.env.PZ_TELEFONE ?? '86988110001'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const falhas = []
const ok = (t) => console.log(`  OK    ${t}`)
const falhou = (t) => {
  falhas.push(t)
  console.log(`  FALHA ${t}`)
}

const navegador = await chromium.launch()
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })
const page = await ctx.newPage()
page.setDefaultTimeout(25_000)

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[autocomplete="username"]', process.env.PZ_CAIXA_LOGIN ?? 'robo.caixa')
await page.fill('input[autocomplete="current-password"]', senha)
await page.click('button[type="submit"]')
await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 30_000 })
await espera(2000)

console.log('\n== 1) cliente recorrente reconhecido pelo telefone (seção 8.1)')
await page.goto(`${base}/delivery`, { waitUntil: 'domcontentloaded' })
await espera(2000)
await page.locator('button:has-text("Novo pedido")').first().click()
const janela = page.locator('[role="dialog"]:has-text("Novo pedido de delivery")').last()
await janela.waitFor({ timeout: 20_000 })
const campoTelefone = janela.locator('label', { hasText: 'Telefone com DDD' }).locator('input').first()
await campoTelefone.fill(telefone)
await espera(2500)

const cartao = janela.locator('text=Cliente recorrente').first()
if (await cartao.count()) {
  ok(`cartão "Cliente recorrente" apareceu para o telefone ${telefone}`)
} else {
  falhou('o cartão "Cliente recorrente" NÃO apareceu para um telefone que já tem entrega')
}

const usar = janela.locator('button:has-text("Usar o endereço anterior")').first()
if ((await usar.count()) === 0) {
  falhou('o botão "Usar o endereço anterior" não apareceu')
} else {
  await usar.click()
  await espera(900)
  const rua = await janela.locator('label', { hasText: 'Rua' }).locator('input').first().inputValue()
  const numero = await janela.locator('label', { hasText: 'Número' }).locator('input').first().inputValue()
  const bairro = await janela.locator('label', { hasText: 'Bairro' }).locator('input').first().inputValue()
  if (rua.trim()) ok(`rua preenchida: "${rua}"`)
  else falhou('a rua não foi preenchida com o endereço anterior')
  if (numero.trim()) ok(`número preenchido: "${numero}"`)
  else falhou('o número não foi preenchido')
  if (bairro.trim()) ok(`bairro preenchido: "${bairro}"`)
  else falhou('o bairro não foi preenchido')
  await janela.screenshot({ path: 'artifacts/recorrente/cartao.png' })
}
await page.keyboard.press('Escape')
await espera(700)

console.log('\n== 2) telefone desconhecido não inventa cliente')
await page.locator('button:has-text("Novo pedido")').first().click()
await janela.waitFor({ timeout: 20_000 })
await janela.locator('label', { hasText: 'Telefone com DDD' }).locator('input').first().fill('11999990000')
await espera(2500)
if ((await janela.locator('text=Cliente recorrente').count()) === 0) {
  ok('telefone sem histórico não mostra cartão de cliente recorrente')
} else {
  falhou('apareceu cartão de cliente recorrente para um telefone que nunca pediu')
}
await page.keyboard.press('Escape')
await espera(700)

console.log('\n== 3) histórico filtrado por forma de pagamento (seção 5.5)')
await page.goto(`${base}/historico`, { waitUntil: 'domcontentloaded' })
await espera(2600)
const filtroForma = page.locator('label', { hasText: 'Forma de pagamento' }).locator('select').first()
if ((await filtroForma.count()) === 0) {
  falhou('o filtro "Forma de pagamento" não existe no histórico')
} else {
  await filtroForma.selectOption('cash')
  await espera(2600)
  const linhasDinheiro = await page.locator('tbody tr').count()
  if (linhasDinheiro > 0) ok(`filtro por Dinheiro devolveu ${linhasDinheiro} pedido(s)`)
  else falhou('filtro por Dinheiro não devolveu nenhum pedido (há recebimentos em dinheiro no histórico)')

  await filtroForma.selectOption('credit_card')
  await espera(2600)
  const vazio = await page.locator('text=Nenhum pedido no período').count()
  const linhasCartao = await page.locator('tbody tr').count()
  if (vazio > 0 || linhasCartao === 0) ok('forma sem recebimento mostra o estado vazio (não lista tudo)')
  else falhou(`filtro por Cartão de crédito listou ${linhasCartao} pedido(s) sem recebimento nessa forma`)

  await page.screenshot({ path: 'artifacts/recorrente/historico-filtro.png', fullPage: true })
}

await navegador.close()
console.log('')
if (falhas.length === 0) {
  console.log('TUDO CERTO: cliente recorrente e filtro por forma de pagamento funcionando no site publicado.')
  process.exit(0)
}
console.log(`${falhas.length} FALHA(S):\n - ${falhas.join('\n - ')}`)
process.exit(1)
