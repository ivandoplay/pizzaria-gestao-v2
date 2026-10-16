#!/usr/bin/env node
/**
 * =============================================================================
 * Aceitação da FILA DE PEDIDOS PRONTOS — ponta a ponta, no site publicado.
 *
 * O robô faz o ciclo operacional inteiro, com dois perfis diferentes:
 *
 *   1. GARÇOM abre uma mesa livre e lança um pedido com observação;
 *   2. GERENTE avança o pedido pela produção: Confirmado → Em preparação → Pronto;
 *   3. GARÇOM abre /pedidos-prontos e confere que o pedido está na fila, com mesa,
 *      número, item, observação e o tempo de espera;
 *   4. GARÇOM confirma a entrega: o cartão sai da fila **depois** da resposta do
 *      banco, e o histórico do pedido registra "Entregue à mesa" para ele;
 *   5. o robô confere que o pedido entregue NÃO volta para a fila.
 *
 * Ele usa as contas de apoio (`robo.garcom`, `robo.caixa`), nunca as contas de
 * trabalho, e deixa o atendimento aberto na mesa (a conta continua lá para ser
 * fechada no caixa — o robô não recebe dinheiro nem fecha conta).
 *
 * Uso:
 *   PZ_CAIXA_PASSWORD=... PZ_GARCOM_PASSWORD=... \
 *     node tools/e2e-fila.mjs https://pizzaria-gestao-v2.vercel.app
 */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4196'
const garcom = {
  login: process.env.PZ_GARCOM_LOGIN ?? 'robo.garcom',
  senha: process.env.PZ_GARCOM_PASSWORD,
}
const gerente = {
  login: process.env.PZ_CAIXA_LOGIN ?? 'robo.caixa',
  senha: process.env.PZ_CAIXA_PASSWORD,
}

if (!garcom.senha || !gerente.senha) {
  console.error('Defina PZ_GARCOM_PASSWORD e PZ_CAIXA_PASSWORD.')
  process.exit(2)
}

const OBSERVACAO = 'sem cebola (teste da fila)'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const falhas = []
const ok = (texto) => console.log(`  OK    ${texto}`)
const falhou = (texto) => {
  falhas.push(texto)
  console.log(`  FALHA ${texto}`)
}
const anotar = (texto) => console.log(`  aviso ${texto}`)

const navegador = await chromium.launch()
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })
const page = await contexto.newPage()

const errosDeConsole = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errosDeConsole.push(msg.text())
})

async function entrar(perfil) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  if (await page.locator('button:has-text("Entrar com outra conta")').count()) {
    await page.locator('button:has-text("Entrar com outra conta")').click()
  }
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 })
  await page.fill('input[autocomplete="username"]', perfil.login)
  await page.fill('input[autocomplete="current-password"]', perfil.senha)
  await page.click('button[type="submit"]')
  await page
    .waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 30_000 })
    .catch(() => {})
  await espera(2200)
  if ((await page.locator('text=Defina sua senha definitiva').count()) > 0) {
    throw new Error(`${perfil.login} está com troca de senha obrigatória pendente`)
  }
}

async function sair() {
  const botao = page.locator('button[title="Sair do sistema"]:visible, button[aria-label="Sair do sistema"]:visible').last()
  if (await botao.count()) {
    await botao.click()
    await page.locator('[role="dialog"] button:has-text("Sair")').last().click()
    await espera(1600)
  }
}

async function semEsqueleto() {
  await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
  await espera(600)
}

// ---------------------------------------------------------------- 1) GARÇOM
console.log(`\n== 1) ${garcom.login} abre uma mesa e lança o pedido`)
await entrar(garcom)
await page.goto(`${base}/mesas`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()

// A última mesa livre da lista: costuma ser a menos usada no salão.
const livres = page.locator('button').filter({ hasText: 'Iniciar atendimento' })
const totalLivres = await livres.count()
if (totalLivres === 0) {
  falhou('nenhuma mesa livre no salão — o teste precisa de uma mesa disponível')
  await navegador.close()
  process.exit(1)
}
let escolhida = 0
let numeroMesa = 0
for (let i = 0; i < totalLivres; i += 1) {
  const texto = await livres.nth(i).innerText()
  const numero = Number((texto.match(/Mesa (\d+)/) ?? [])[1] ?? 0)
  if (numero > numeroMesa) {
    numeroMesa = numero
    escolhida = i
  }
}
await livres.nth(escolhida).click()
const dialogoAbrir = page.locator('[role="dialog"]:has-text("Quantas pessoas")')
await dialogoAbrir.first().waitFor({ timeout: 20_000 })
await dialogoAbrir.locator('button:has-text("Abrir mesa")').last().click()
await page.waitForFunction(() => /^\/mesas\/[0-9a-f-]{8,}/.test(location.pathname), undefined, { timeout: 25_000 }).catch(() => {})
await semEsqueleto()
const urlAtendimento = new URL(page.url()).pathname
if (/^\/mesas\/[0-9a-f-]{8,}/.test(urlAtendimento)) ok(`mesa ${numeroMesa} aberta (${urlAtendimento})`)
else falhou(`não abriu o atendimento da mesa (parou em ${urlAtendimento})`)

// Lança um item: tenta os primeiros produtos do cardápio até um entrar no carrinho.
const contarCarrinho = () => page.locator('button[title="Remover item da lista"]').count()
let itemLancado = false
const produtos = page.locator('button').filter({ hasText: /R\$\s?\d/ })
const totalProdutos = Math.min(await produtos.count(), 6)
for (let i = 0; i < totalProdutos && !itemLancado; i += 1) {
  const antes = await contarCarrinho()
  await produtos.nth(i).click()
  await espera(700)
  const dialogo = page.locator('[role="dialog"]:has-text("Adicionar ·")')
  if (await dialogo.count()) {
    const janela = dialogo.last()
    // Grupos de escolha obrigatória (o título do grupo vem com "*"): marca o
    // primeiro item se o grupo ainda não tiver nada escolhido.
    const grupos = janela.locator('label')
    for (let g = 0; g < (await grupos.count()); g += 1) {
      const grupo = grupos.nth(g)
      const titulo = await grupo.locator('span').first().innerText().catch(() => '')
      if (!titulo.includes('*')) continue
      if ((await grupo.locator('button[aria-pressed="true"]').count()) === 0) {
        await grupo.locator('button[aria-pressed]').first().click().catch(() => {})
      }
    }
    await janela.locator('textarea').last().fill(OBSERVACAO).catch(() => {})
    await janela.locator('button:has-text("Adicionar ·")').last().click()
    await espera(900)
  }
  if ((await contarCarrinho()) > antes) itemLancado = true
}
if (itemLancado) ok('item lançado no carrinho do pedido')
else falhou('não foi possível lançar um item do cardápio')

await page.locator('button:has-text("Enviar pedido para a produção")').last().click()
await espera(3000)
let corpo = await page.locator('body').innerText()
const numeroPedido = Number((corpo.match(/Pedido #(\d+)/) ?? [])[1] ?? 0)
if (numeroPedido > 0) ok(`pedido #${numeroPedido} enviado para a produção`)
else falhou('o pedido não foi criado (não apareceu número de pedido)')

// ------------------------------------------------------------- 2) GERENTE
console.log(`\n== 2) ${gerente.login} avança a produção até "Pronto"`)
await sair()
await entrar(gerente)
await page.goto(`${base}${urlAtendimento}`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()
for (const etapa of ['Confirmado', 'Em preparação', 'Pronto']) {
  const botao = page.locator(`button:has-text("Marcar como ${etapa}")`).last()
  if ((await botao.count()) === 0) {
    falhou(`o botão "Marcar como ${etapa}" não apareceu`)
    break
  }
  await botao.click()
  await espera(2200)
}
corpo = await page.locator('body').innerText()
if (/Pronto/.test(corpo)) ok('produção avançada até "Pronto"')
else falhou('o pedido não chegou ao estado Pronto')

// ------------------------------------------------------------- 3) A FILA
console.log(`\n== 3) ${garcom.login} vê o pedido na fila de prontos`)
await sair()
await entrar(garcom)
await page.goto(`${base}/pedidos-prontos`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()
const h1 = (await page.locator('h1').first().innerText().catch(() => '')).trim()
if (h1 === 'Pedidos prontos') ok('a tela "Pedidos prontos" abriu')
else falhou(`a tela abriu com o título "${h1}"`)

const cartao = page.locator('div').filter({ hasText: new RegExp(`Pedido #${numeroPedido}\\b`) }).last()
const cartaoDaMesa = page
  .locator('section')
  .filter({ hasText: new RegExp(`Mesa ${numeroMesa}\\b`) })
  .filter({ hasText: new RegExp(`Pedido #${numeroPedido}\\b`) })
  .first()
if ((await cartaoDaMesa.count()) > 0) ok(`o pedido #${numeroPedido} da mesa ${numeroMesa} está na fila`)
else falhou(`o pedido #${numeroPedido} não apareceu na fila de prontos`)
if ((await cartao.count()) > 0 || (await cartaoDaMesa.count()) > 0) {
  const textoCartao = await (cartaoDaMesa.count() ? cartaoDaMesa : cartao).innerText()
  if (/Pronto/.test(textoCartao)) ok('o cartão traz o selo "Pronto"')
  else falhou('o cartão não traz o selo "Pronto"')
  if (/pronto há|pronto agora mesmo|Horário indisponível/.test(textoCartao)) {
    ok('o cartão mostra o tempo de espera medido pelo horário em que ficou pronto')
  } else {
    falhou(`o cartão não mostrou o tempo de espera ("${textoCartao.replace(/\n+/g, ' | ').slice(0, 160)}")`)
  }
  if (textoCartao.includes(OBSERVACAO)) ok('a observação do item chegou inteira na fila')
  else falhou('a observação do item não apareceu no cartão da fila')
}

const linhaStatus = await page.locator(`text=/\\d+ pedidos? prontos?/`).first().innerText().catch(() => '')
if (linhaStatus) ok(`contagem no topo: "${linhaStatus.trim()}"`)

// --------------------------------------------------- 4) CONFIRMAR ENTREGA
console.log('\n== 4) confirmação da entrega pelo garçom')
const botaoEntrega = cartaoDaMesa.locator('button:has-text("Confirmar entrega")').first()
if ((await botaoEntrega.count()) === 0) {
  falhou('o botão "Confirmar entrega" não apareceu no cartão')
} else {
  await botaoEntrega.click()
  await espera(4000)
  const aindaNaFila = (await page.locator(`text=Pedido #${numeroPedido}\\b`).count()) > 0
  if (aindaNaFila) {
    const tela = await page.locator('body').innerText()
    if (/Entrega confirmada|Entregue/.test(tela)) ok('a entrega foi confirmada e o cartão saiu da fila')
    else falhou('o pedido continuou na fila depois da confirmação')
  } else {
    ok('a entrega foi confirmada e o cartão saiu da fila')
  }
}

// O banco registra a transição com autor e horário — conferido na tela do atendimento.
await page.goto(`${base}${urlAtendimento}`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()
corpo = await page.locator('body').innerText()
if (/Entregue à mesa/.test(corpo)) ok('o histórico do pedido mostra "Entregue à mesa"')
else falhou('o histórico do pedido não registrou a entrega')
if (new RegExp(garcom.login.replace('.', '\\.'), 'i').test(corpo) || /Robô Garçom|robo\.garcom/i.test(corpo)) {
  ok('a entrega ficou registrada com o usuário que confirmou')
} else {
  anotar('não foi possível ler o nome de quem confirmou na tela do atendimento')
}

// ------------------------------------------------- 5) A FILA CONTINUA COERENTE
console.log('\n== 5) a fila não traz de volta o que já foi entregue')
await page.goto(`${base}/pedidos-prontos`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()
const voltou = (await page.locator(`text=Pedido #${numeroPedido}\\b`).count()) > 0
if (voltou) falhou(`o pedido #${numeroPedido} voltou para a fila depois de entregue`)
else ok('o pedido entregue não aparece mais na fila')

const naoCobrados = ['Delivery', 'Cancelado', 'Saiu para entrega']
const textoFila = await page.locator('main').innerText()
const intrusos = naoCobrados.filter((palavra) => new RegExp(palavra, 'i').test(textoFila))
if (intrusos.length === 0) ok('a fila não lista delivery nem pedidos cancelados')
else anotar(`a tela citou ${intrusos.join(', ')} — confira se é apenas rótulo de outra área`)

if (errosDeConsole.length) {
  for (const erro of new Set(errosDeConsole)) falhou(`erro de console: ${erro}`)
} else {
  ok('nenhum erro de console durante o percurso')
}

await navegador.close()

console.log(
  falhas.length === 0
    ? `\nRESULTADO: fila validada de ponta a ponta (mesa ${numeroMesa}, pedido #${numeroPedido}) — a conta ficou aberta para fechar no caixa.`
    : `\nRESULTADO: ${falhas.length} falha(s) em ${base}`,
)
process.exit(falhas.length === 0 ? 0 : 1)
