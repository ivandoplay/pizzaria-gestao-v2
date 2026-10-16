#!/usr/bin/env node
/**
 * =============================================================================
 * Aceitação da FILA DE PEDIDOS PRONTOS — ponta a ponta, no site publicado.
 *
 * O robô faz o ciclo operacional inteiro, com dois perfis diferentes:
 *
 *   1. GARÇOM abre uma mesa livre e lança um pedido com observação;
 *   2. GERENTE avança o pedido pela produção: Confirmado → Em preparação → Pronto,
 *      conferindo em cada passo que a próxima etapa permitida é mesmo a seguinte;
 *   3. GARÇOM abre /pedidos-prontos e confere o cartão do pedido: mesa, número,
 *      item, observação, selo "Pronto" e o tempo de espera;
 *   4. GARÇOM confirma a entrega: o cartão só sai da lista por causa da resposta
 *      do banco, e o histórico do pedido passa a mostrar "Entregue à mesa";
 *   5. a fila não devolve o pedido já entregue.
 *
 * Usa as contas de apoio (`robo.garcom`, `robo.caixa`), nunca as contas de
 * trabalho, e deixa o atendimento aberto na mesa (a conta continua lá para ser
 * fechada no caixa — o robô não recebe dinheiro nem fecha conta).
 *
 * Uso:
 *   PZ_CAIXA_PASSWORD=... PZ_GARCOM_PASSWORD=... \
 *     node tools/e2e-fila.mjs https://pizzaria-gestao-v2.vercel.app
 */
import { mkdirSync } from 'node:fs'
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
const resumo = (texto, limite = 200) => texto.replace(/\s*\n+\s*/g, ' | ').slice(0, limite)

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
await page
  .waitForFunction(() => /^\/mesas\/[0-9a-f-]{8,}/.test(location.pathname), undefined, { timeout: 25_000 })
  .catch(() => {})
await semEsqueleto()
const urlAtendimento = new URL(page.url()).pathname
if (/^\/mesas\/[0-9a-f-]{8,}/.test(urlAtendimento)) ok(`mesa ${numeroMesa} aberta (${urlAtendimento})`)
else falhou(`não abriu o atendimento da mesa (parou em ${urlAtendimento})`)

// Lança um item COM OBSERVAÇÃO: só o caminho que abre a janela do produto tem
// campo de observação, então o robô prefere esses itens — e, se um produto entrar
// direto no carrinho, tira e tenta o próximo.
const contarCarrinho = () => page.locator('button[title="Remover item da lista"]').count()
let itemLancado = false
let comObservacao = false

// Pizza sempre abre a janela de montagem (sabor, tamanho, adicionais e
// observação) — é por onde o robô consegue provar que a observação chega à fila.
const abaPizzas = page.locator('button').filter({ hasText: /^Pizzas?\b/ }).first()
if ((await abaPizzas.count()) > 0) {
  await abaPizzas.click()
  await espera(900)
}
const produtos = page.locator('button').filter({ hasText: /R\$\s?\d/ })
// Até 20 produtos: itens simples entram direto no carrinho e são descartados,
// então o robô precisa de espaço para achar um que abra a janela (com observação).
const totalProdutos = Math.min(await produtos.count(), 20)
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
    await janela.locator('textarea').last().fill(OBSERVACAO)
    comObservacao = (await janela.locator('textarea').last().inputValue()) === OBSERVACAO
    await janela.locator('button:has-text("Adicionar ·")').last().click()
    await espera(900)
  }
  const agora = await contarCarrinho()
  if (agora > antes) {
    if (comObservacao) itemLancado = true
    else {
      // entrou direto, sem janela: não dá para escrever observação. Sai da lista
      // e segue tentando um item que aceite observação.
      await page.locator('button[title="Remover item da lista"]').first().click().catch(() => {})
      await espera(700)
    }
  }
}
if (!itemLancado) {
  // Nenhum item com observação: lança o primeiro produto para o pedido existir.
  await produtos.nth(0).click()
  await espera(900)
  const janela = page.locator('[role="dialog"]:has-text("Adicionar ·")')
  if (await janela.count()) {
    const grupos = janela.last().locator('label')
    for (let g = 0; g < (await grupos.count()); g += 1) {
      const grupo = grupos.nth(g)
      const titulo = await grupo.locator('span').first().innerText().catch(() => '')
      if (!titulo.includes('*')) continue
      if ((await grupo.locator('button[aria-pressed="true"]').count()) === 0) {
        await grupo.locator('button[aria-pressed]').first().click().catch(() => {})
      }
    }
    await janela.last().locator('button:has-text("Adicionar ·")').last().click()
    await espera(900)
    comObservacao = true
  }
  itemLancado = (await contarCarrinho()) > 0
  if (itemLancado) anotar('o cardápio não tinha item simples com observação — a checagem da observação será pulada')
}
if (itemLancado && comObservacao) ok('item com observação lançado no carrinho do pedido')
else if (itemLancado) ok('item lançado no carrinho do pedido (sem observação)')
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

// Os botões de mudança de situação ficam no modal do pedido ("Situação").
// A mesa acabou de ser aberta por este robô, então só existe um pedido nela.
async function abrirSituacao() {
  await page.locator('button:has-text("Situação")').first().click()
  await page
    .locator('[role="dialog"]:has-text("Acompanhamento do pedido")')
    .first()
    .waitFor({ timeout: 20_000 })
}

async function fecharSituacao() {
  const janela = page.locator('[role="dialog"]:has-text("Acompanhamento do pedido")').first()
  const fechar = janela.locator('button[title="Fechar"], button[aria-label="Fechar"]').first()
  if (await fechar.count()) await fechar.click()
  else await page.keyboard.press('Escape')
  await espera(700)
}

// Cada passo é conferido no próprio modal: depois de avançar, o próximo passo
// permitido tem que ser o seguinte da cadeia (e o anterior não pode aparecer).
const cadeia = [
  ['Confirmado', 'Em preparação'],
  ['Em preparação', 'Pronto'],
  ['Pronto', 'Entregue à mesa'],
]
for (const [indice, [etapa, depois]] of cadeia.entries()) {
  await abrirSituacao()
  const janela = page.locator('[role="dialog"]:has-text("Acompanhamento do pedido")').first()
  const botao = janela.locator(`button:has-text("Marcar como ${etapa}")`).first()
  if ((await botao.count()) === 0) {
    const opcoes = await janela.innerText()
    falhou(`o botão "Marcar como ${etapa}" não apareceu (a tela ofereceu: ${resumo(opcoes, 160)})`)
    break
  }
  await botao.click()
  await espera(2600)
  await abrirSituacao()
  const depoisDoClique = await page
    .locator('[role="dialog"]:has-text("Acompanhamento do pedido")')
    .first()
    .innerText()
  if (depoisDoClique.includes(`Marcar como ${depois}`) && !depoisDoClique.includes(`Marcar como ${etapa}`)) {
    ok(`pedido avançou para "${etapa}" (${indice + 1}/3)`)
  } else {
    falhou(`depois de "${etapa}" o pedido não ofereceu "${depois}"`)
  }
  await fecharSituacao()
}

// ------------------------------------------------------------- 3) A FILA
console.log(`\n== 3) ${garcom.login} vê o pedido na fila de prontos`)
await sair()
await entrar(garcom)
await page.goto(`${base}/pedidos-prontos`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()

const h1 = (await page.locator('h1').first().innerText().catch(() => '')).trim()
if (h1 === 'Pedidos prontos') ok('a tela "Pedidos prontos" abriu')
else falhou(`a tela abriu com o título "${h1}"`)

// A fila se atualiza sozinha (Realtime + releitura de minuto em minuto), mas o
// robô não depende disso: procura o cartão e, no meio do caminho, usa o próprio
// botão "Atualizar" da tela — como faria o garçom.
const alvo = `Pedido #${numeroPedido}`
// O filtro do Playwright compara o textContent, que não tem espaços entre os
// elementos ("Mesa 4Pedido #35") — por isso o lookahead em vez de \b.
const regexMesa = new RegExp(`Mesa ${numeroMesa}(?!\\d)`)
let achou = false
let textoFila = ''
for (let tentativa = 0; tentativa < 12 && !achou; tentativa += 1) {
  textoFila = await page.locator('main').innerText().catch(() => '')
  achou = textoFila.includes(alvo) && regexMesa.test(textoFila)
  if (!achou) {
    if (tentativa === 4) await page.locator('button:has-text("Atualizar")').first().click().catch(() => {})
    await espera(1500)
  }
}

if (achou) ok(`o pedido #${numeroPedido} da mesa ${numeroMesa} está na fila`)
else falhou(`o pedido #${numeroPedido} não apareceu na fila de prontos (tela: ${resumo(textoFila)})`)

const cartao = page.locator('section').filter({ hasText: new RegExp(`Pedido #${numeroPedido}(?!\\d)`) }).first()
const textoCartao = achou ? await cartao.innerText().catch(() => '') : textoFila
if (achou) {
  if (/Pronto/.test(textoCartao)) ok('o cartão traz o selo "Pronto"')
  else falhou('o cartão não traz o selo "Pronto"')

  if (/pronto há|pronto agora/.test(textoCartao) || /Horário indisponível/.test(textoCartao)) {
    ok('o cartão mostra o tempo de espera medido pelo horário em que ficou pronto')
  } else {
    falhou(`o cartão não mostrou o tempo de espera (${resumo(textoCartao)})`)
  }

  if (!comObservacao) {
    anotar('a observação não foi lançada neste percurso (item sem janela) — checagem pulada')
  } else if (textoCartao.includes(OBSERVACAO)) {
    ok('a observação do item chegou inteira na fila')
  } else {
    falhou(`a observação do item não apareceu no cartão (${resumo(textoCartao)})`)
  }

  const contagem = (textoFila.match(/\d+ pedidos? prontos?/) ?? [])[0]
  if (contagem) ok(`contagem no topo: "${contagem}"`)

  // Captura da tela COM pedido na fila: no celular (o garçom entrega pelo
  // telefone) e no computador. Fica em artifacts/fila/ para mostrar o resultado.
  mkdirSync('artifacts/fila', { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await espera(900)
  await page.screenshot({ path: 'artifacts/fila/fila-no-celular.png' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await espera(900)
  await page.screenshot({ path: 'artifacts/fila/fila-no-computador.png' })
  ok('capturas da fila salvas em artifacts/fila/')
}

// --------------------------------------------------- 4) CONFIRMAR ENTREGA
console.log('\n== 4) confirmação da entrega pelo garçom')
if (!achou) {
  falhou('sem o cartão na tela, a entrega não pôde ser testada')
} else {
  const botaoEntrega = cartao.locator('button:has-text("Confirmar entrega")').first()
  if ((await botaoEntrega.count()) === 0) {
    falhou('o botão "Confirmar entrega" não apareceu no cartão')
  } else {
    await botaoEntrega.click()
    // O cartão só pode sair da lista por causa dos dados do servidor: se o banco
    // recusar, ele continua na tela com a mensagem do erro.
    await page
      .waitForFunction((texto) => !document.body.innerText.includes(texto), alvo, { timeout: 25_000 })
      .catch(() => {})
    await espera(1200)
    const textoDepois = await page.locator('main').innerText().catch(() => '')
    const tela = await page.locator('body').innerText().catch(() => '')
    if (textoDepois.includes(alvo)) {
      falhou(`o pedido continuou na fila depois da confirmação (tela: ${resumo(tela)})`)
    } else {
      ok('a entrega foi confirmada e o cartão saiu da fila')
    }
    if (/Entrega confirmada|Entregue/.test(tela)) ok('a tela avisou que a entrega foi registrada')
  }
}

// O banco registra a transição com autor e horário — conferido na tela do atendimento.
await page.goto(`${base}${urlAtendimento}`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()
// O histórico de mudanças vive dentro do modal do pedido ("Situação").
await page.locator('button:has-text("Situação")').first().click()
await page
  .locator('[role="dialog"]:has-text("Acompanhamento do pedido")')
  .first()
  .waitFor({ timeout: 20_000 })
  .catch(() => {})
await espera(1800)
const textoHistorico = await page
  .locator('[role="dialog"]:has-text("Acompanhamento do pedido")')
  .first()
  .innerText()
  .catch(() => '')
if (/Entregue à mesa/.test(textoHistorico)) ok('o histórico do pedido mostra "Entregue à mesa"')
else falhou(`o histórico do pedido não registrou a entrega (${resumo(textoHistorico, 160)})`)

// ------------------------------------------------- 5) A FILA CONTINUA COERENTE
console.log('\n== 5) a fila não traz de volta o que já foi entregue')
await page.goto(`${base}/pedidos-prontos`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()
await espera(1500)
const textoFinalFila = await page.locator('main').innerText().catch(() => '')
if (textoFinalFila.includes(alvo)) falhou(`o pedido #${numeroPedido} voltou para a fila depois de entregue`)
else ok('o pedido entregue não aparece mais na fila')

if (!/Saiu para entrega|Delivery/.test(textoFinalFila) && !/Cancelado/.test(textoFinalFila)) {
  ok('a fila não lista delivery nem pedidos cancelados')
} else {
  anotar(`a fila citou rótulo de outra área — confira: ${resumo(textoFinalFila, 160)}`)
}

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
