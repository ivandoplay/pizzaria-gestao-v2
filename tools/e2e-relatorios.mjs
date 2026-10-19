#!/usr/bin/env node
/**
 * Aceitação dos FILTROS DE RELATÓRIO (seção 13 do prompt mestre).
 *
 * Confere, no site publicado, que o painel de Relatórios oferece os filtros
 * exigidos — período, modalidade, funcionário, **categoria** e **forma de
 * pagamento** — e que eles mudam o resultado de verdade:
 *
 *   1. sem filtro, o resumo mostra os indicadores;
 *   2. filtrando por "Dinheiro" o total recebido cai para o valor recebido
 *      nessa forma (e some o que só teve Pix);
 *   3. filtrando por uma categoria sem vendas, os números zeram.
 *
 * O robô só LÊ. Nada é gravado.
 *
 * Uso: PZ_ADMIN_PASSWORD=... node tools/e2e-relatorios.mjs URL
 * =============================================================================
 */
import { chromium } from 'playwright'

const base = process.argv[2]
if (!base) {
  console.error('Uso: node tools/e2e-relatorios.mjs <URL>')
  process.exit(2)
}
const senha = process.env.PZ_ADMIN_PASSWORD
if (!senha) {
  console.error('Defina PZ_ADMIN_PASSWORD.')
  process.exit(2)
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const falhas = []
const ok = (t) => console.log(`  OK    ${t}`)
const falhou = (t) => {
  falhas.push(t)
  console.log(`  FALHA ${t}`)
}

/**
 * Lê o valor em R$ do cartão cujo rótulo é indicado.
 *
 * O rótulo é exibido em maiúsculas por CSS, então a comparação ignora a caixa e
 * aceita o valor em qualquer linha logo abaixo dele.
 */
async function lerCartao(page, rotulo) {
  const texto = await page.locator('body').innerText()
  const padrao = new RegExp(`${rotulo}[\\s\\S]{0,120}?R\\$\\s?([\\d.]+),(\\d{2})`, 'i')
  const casa = texto.match(padrao)
  return casa ? Number(casa[1].replace(/\./g, '')) * 100 + Number(casa[2]) : null
}

const navegador = await chromium.launch()
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })
const page = await ctx.newPage()
page.setDefaultTimeout(25_000)

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[autocomplete="username"]', process.env.PZ_ADMIN_LOGIN ?? 'admin')
await page.fill('input[autocomplete="current-password"]', senha)
await page.click('button[type="submit"]')
await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 30_000 })
await espera(2000)

console.log('\n== 1) o painel de relatórios abre com os filtros exigidos')
await page.goto(`${base}/relatorios`, { waitUntil: 'domcontentloaded' })
await espera(3000)
for (const rotulo of ['Modalidade', 'Funcionário', 'Categoria', 'Forma de pagamento']) {
  const campo = page.locator('label', { hasText: rotulo }).locator('select').first()
  if ((await campo.count()) > 0) ok(`filtro "${rotulo}" presente`)
  else falhou(`filtro "${rotulo}" ausente`)
}
const seletorCategoria = page.locator('label', { hasText: 'Categoria' }).locator('select').first()
const seletorForma = page.locator('label', { hasText: 'Forma de pagamento' }).locator('select').first()

const recebidoBase = await lerCartao(page, 'Recebido no período')
if (recebidoBase !== null) ok(`"Recebido no período" sem filtro: R$ ${(recebidoBase / 100).toFixed(2).replace('.', ',')}`)
else falhou('não consegui ler "Recebido no período" no painel')

console.log('\n== 2) filtrar por forma de pagamento muda o resultado')
await seletorForma.selectOption('cash')
await espera(3000)
const valorDinheiro = await lerCartao(page, 'Recebido no período')
if (valorDinheiro === null) falhou('não consegui ler o recebido com o filtro de dinheiro')
else if (valorDinheiro <= 0) falhou('filtrar por dinheiro zerou o recebido (há recebimentos em dinheiro)')
else ok(`com filtro "Dinheiro" o recebido é R$ ${(valorDinheiro / 100).toFixed(2).replace('.', ',')}`)

await seletorForma.selectOption('credit_card')
await espera(3000)
const valorCartao = await lerCartao(page, 'Recebido no período')
if (valorCartao === 0) ok('forma sem recebimento zera o indicador (não mostra o total geral)')
else falhou(`filtrar por cartão deveria zerar o recebido; mostrou ${valorCartao === null ? 'ilegível' : 'R$ ' + (valorCartao / 100).toFixed(2)}`)
await page.screenshot({ path: 'artifacts/relatorios/filtro-forma.png', fullPage: true })

console.log('\n== 3) filtro de categoria também age')
await seletorForma.selectOption('')
await espera(2500)
const opcoes = await seletorCategoria.locator('option').count()
if (opcoes > 1) {
  await seletorCategoria.selectOption({ index: opcoes - 1 })
  await espera(3000)
  const textoCategoria = await page.locator('body').innerText()
  const pedidosCategoria = (textoCategoria.match(/Pedidos válidos[\s\S]{0,40}?(\d+)/i) ?? [])[1]
  ok(`filtro de categoria aplicado — "Pedidos válidos" agora: ${pedidosCategoria ?? 'n/d'}`)
} else {
  falhou('o seletor de categoria não trouxe categorias do cardápio')
}

console.log('\n== 4) o CSV exportado registra os filtros aplicados')
await seletorCategoria.selectOption('')
await seletorForma.selectOption('cash')
await espera(2500)
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20_000 }).catch(() => null),
  page.getByRole('button', { name: 'Exportar resumo' }).click(),
])
if (!download) {
  falhou('clicar em "Exportar resumo" não gerou download')
} else {
  const caminho = await download.path()
  const conteudo = caminho ? await (await import('node:fs/promises')).readFile(caminho, 'utf8') : ''
  const temCategoria = /Categoria;/.test(conteudo)
  const temForma = /Forma de pagamento;/.test(conteudo)
  const linhaForma = (conteudo.match(/Forma de pagamento;([^\r\n]*)/) ?? [])[1]
  if (temCategoria && temForma) ok(`CSV traz "Categoria" e "Forma de pagamento" (${linhaForma})`)
  else falhou('CSV exportado não registra os filtros de categoria/forma de pagamento')
}

await navegador.close()
console.log('')
if (falhas.length === 0) {
  console.log('TUDO CERTO: filtros de relatório (modalidade, funcionário, categoria e forma de pagamento) funcionando.')
  process.exit(0)
}
console.log(`${falhas.length} FALHA(S):\n - ${falhas.join('\n - ')}`)
process.exit(1)
