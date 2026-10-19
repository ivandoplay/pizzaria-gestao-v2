#!/usr/bin/env node
/**
 * =============================================================================
 * Aceitação do RECEBIMENTO EM PARTES e do DESCONTO (achados A1 e A7).
 *
 * O robô faz o ciclo inteiro como garçom, no celular (é o aparelho dele):
 *
 *   1. entra com a conta de apoio do garçom;
 *   2. abre a última mesa livre do salão (a menos usada) e lança um item;
 *   3. confere que a tela da conta MOSTRA o valor (Total da conta / Recebido /
 *      Falta receber) — antes desta correção o garçom não via dinheiro nenhum;
 *   4. confere que o fechamento é RECUSADO com pedido em andamento (regra da
 *      migração 0012) — a tela precisa dizer o motivo antes do clique;
 *   5. o CAIXA (conta de apoio, em outra aba) conduz a produção até "pronto";
 *   6. o garçom entrega pela fila de Pedidos prontos;
 *   7. só então recebe em dinheiro e fecha a conta quitada;
 *   8. volta para /mesas e confere que a mesa está livre de novo.
 *
 * O robô não abre nem fecha caixa: ele usa o turno que estiver aberto — o banco
 * é quem entra com o valor no turno em curso e recusa, com mensagem clara, se
 * ninguém tiver aberto o caixa.
 *
 * Uso:
 *   PZ_GARCOM_PASSWORD=... node tools/e2e-garcom-recebe.mjs http://localhost:4175
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4175'
const garcom = {
  login: process.env.PZ_GARCOM_LOGIN ?? 'robo.garcom',
  senha: process.env.PZ_GARCOM_PASSWORD,
}
const caixa = {
  login: process.env.PZ_CAIXA_LOGIN ?? 'robo.caixa',
  senha: process.env.PZ_CAIXA_PASSWORD,
}
const prefixo = process.env.PZ_PRINTS ?? 'artifacts/parcial-desconto'
const celular = { width: 390, height: 844 }

if (!garcom.senha || !caixa.senha) {
  console.error('Defina PZ_GARCOM_PASSWORD e PZ_CAIXA_PASSWORD.')
  process.exit(2)
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const falhas = []
const ok = (texto) => console.log(`  OK    ${texto}`)
const falhou = (texto) => {
  falhas.push(texto)
  console.log(`  FALHA ${texto}`)
}
const aviso = (texto) => console.log(`  aviso ${texto}`)
const resumo = (texto, limite = 160) => texto.replace(/\s+/g, ' ').trim().slice(0, limite)
const dinheiro = (centavos) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`

mkdirSync(prefixo, { recursive: true })

const navegador = await chromium.launch()
const contexto = await navegador.newContext({
  viewport: celular,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'pt-BR',
})
const page = await contexto.newPage()
page.setDefaultTimeout(20_000)

/**
 * O caixa trabalha em OUTRO aparelho (computador do balcão) — e é ele quem
 * conduz a produção. Abrir um segundo contexto é o mais próximo do salão real:
 * duas sessões independentes, como a pizzaria funciona.
 */
const contextoCaixa = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })
const pageCaixa = await contextoCaixa.newPage()
pageCaixa.setDefaultTimeout(20_000)

const errosDeConsole = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errosDeConsole.push(msg.text())
})

async function entrar(perfil = garcom, alvo = page) {
  await alvo.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  if (await alvo.locator('button:has-text("Entrar com outra conta")').count()) {
    await alvo.locator('button:has-text("Entrar com outra conta")').click()
  }
  await alvo.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 })
  await alvo.fill('input[autocomplete="username"]', perfil.login)
  await alvo.fill('input[autocomplete="current-password"]', perfil.senha)
  await alvo.click('button[type="submit"]')
  await alvo
    .waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 30_000 })
    .catch(() => {})
  await espera(2200)
  if ((await alvo.locator('text=Defina sua senha definitiva').count()) > 0) {
    throw new Error(`${perfil.login} está com troca de senha obrigatória pendente`)
  }
}

async function semEsqueleto() {
  await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
  await espera(600)
}

/**
 * Lê, na faixa de resumo da conta, o valor do cartão com o rótulo indicado.
 * Os rótulos são maiúsculos por CSS, então a comparação ignora a caixa.
 */
async function lerValor(rotulo) {
  const etiqueta = page.locator('p.rotulo').filter({ hasText: new RegExp(`^${rotulo}$`, 'i') }).first()
  if ((await etiqueta.count()) === 0) return null
  const texto = await etiqueta
    .evaluate((el) => (el.parentElement?.parentElement ?? el.parentElement ?? el).innerText)
    .catch(() => '')
  const casa = texto.match(/R\$\s?([\d.]+),(\d{2})/)
  if (!casa) return null
  return Number(casa[1].replace(/\./g, '')) * 100 + Number(casa[2])
}

console.log(`\n== 1) ${garcom.login} entra e abre uma mesa livre`)
await entrar()
await page.goto(`${base}/mesas`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()

const livres = page.locator('button').filter({ hasText: 'Iniciar atendimento' })
if ((await livres.count()) === 0) {
  falhou('nenhuma mesa livre no salão — o teste precisa de uma mesa disponível')
  await navegador.close()
  process.exit(1)
}
let escolhida = 0
let numeroMesa = 0
for (let i = 0; i < (await livres.count()); i += 1) {
  const numero = Number(((await livres.nth(i).innerText()).match(/Mesa (\d+)/) ?? [])[1] ?? 0)
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
const urlConta = new URL(page.url()).pathname
if (/^\/mesas\/[0-9a-f-]{8,}/.test(urlConta)) ok(`mesa ${numeroMesa} aberta (${urlConta})`)
else falhou(`não abriu o atendimento da mesa (parou em ${urlConta})`)
const idSessao = urlConta.split('/').pop()

console.log('\n== 2) lança um item no carrinho e envia para a produção')
const contarCarrinho = () => page.locator('button[title="Remover item da lista"]').count()
let lancado = false
let numeroPedido = 0
for (const nomeAba of ['Bebidas', 'Porções']) {
  if (lancado) break
  const aba = page.locator('button').filter({ hasText: new RegExp(`^${nomeAba}\b`) }).first()
  if ((await aba.count()) > 0) {
    await aba.click()
    await espera(800)
  }
  const produtos = page.locator('button').filter({ hasText: /R\$\s?\d/ })
  const limite = Math.min(await produtos.count(), 8)
  for (let i = 0; i < limite && !lancado; i += 1) {
    const antes = await contarCarrinho()
    await produtos.nth(i).click()
    await espera(700)
    const janelaProduto = page.locator('[role="dialog"]:has-text("Adicionar ·")')
    if (await janelaProduto.count()) {
      const janela = janelaProduto.last()
      const grupos = janela.locator('label')
      for (let g = 0; g < (await grupos.count()); g += 1) {
        const grupo = grupos.nth(g)
        const titulo = await grupo.locator('span').first().innerText().catch(() => '')
        if (!titulo.includes('*')) continue
        if ((await grupo.locator('button[aria-pressed="true"]').count()) === 0) {
          await grupo.locator('button[aria-pressed]').first().click().catch(() => {})
        }
      }
      await janela.locator('button:has-text("Adicionar ·")').last().click()
      await espera(800)
    }
    if ((await contarCarrinho()) > antes) lancado = true
  }
}
if (!lancado) falhou('não consegui lançar nenhum item no carrinho')
else ok('item lançado no carrinho')

const enviar = page.locator('button:has-text("Enviar pedido para a produção")').first()
if (await enviar.count()) {
  await enviar.click().catch(() => {})
  await espera(2600)
  const avisoEnvio = (await page.locator('body').innerText()).match(/Pedido #(\d+)/)
  if (avisoEnvio) {
    numeroPedido = Number(avisoEnvio[1])
    ok(`pedido #${numeroPedido} lançado`)
  } else {
    aviso('sem confirmação textual do envio — seguindo pela conta')
  }
} else {
  falhou('não achei o botão "Enviar pedido para a produção"')
}

console.log('\n== 3) a conta mostra DINHEIRO para o garçom (regra de 16/10/2026)')
await semEsqueleto()
const textoResumo = (await page.locator('body').innerText()).toLowerCase()
for (const rotulo of ['total da conta', 'recebido', 'falta receber']) {
  if (textoResumo.includes(rotulo)) ok(`a faixa mostra "${rotulo}"`)
  else falhou(`a faixa NÃO mostra "${rotulo}" — o garçom continua sem ver o valor`)
}
const valorTotal = await lerValor('Total da conta')
const valorFalta = await lerValor('Falta receber')
if (valorTotal && valorTotal > 0) ok(`total da conta lido na tela: ${dinheiro(valorTotal)}`)
else falhou(`não consegui ler um total de conta > 0 (li ${valorTotal})`)
if (valorFalta !== null) ok(`falta receber lido na tela: ${dinheiro(valorFalta)}`)
else falhou('não consegui ler "Falta receber" na tela')
await page.screenshot({ path: `${prefixo}/1-conta-com-valor.png`, fullPage: true })

console.log('\n== 4) fechamento RECUSADO com pedido em andamento (migração 0012)')
{
  const botaoFechar = page.locator('button:has-text("Fechar conta")').first()
  if ((await botaoFechar.count()) === 0) {
    falhou('o botão "Fechar conta" não aparece para o garçom')
  } else {
    await botaoFechar.click()
    const janela = page.locator('[role="dialog"]:has-text("Fechar conta da mesa")').last()
    await janela.waitFor({ timeout: 15_000 }).catch(() => {})
    const texto = await janela.innerText().catch(() => '')
    if (/pedido em andamento/i.test(texto)) ok('a janela explica que há pedido em andamento')
    else falhou(`a janela não avisou da pendência (${resumo(texto)})`)
    if (/Prontos aguardando entrega|Em produção/.test(texto)) ok('a janela mostra o resumo operacional dos pedidos')
    else falhou('a janela não mostrou o resumo operacional')
    const confirmar = janela.locator('button:has-text("Confirmar fechamento")').last()
    if (await confirmar.isDisabled()) ok('o fechamento está bloqueado enquanto o pedido não é entregue')
    else falhou('o "Confirmar fechamento" ficou habilitado com pedido em andamento')
    await janela.screenshot({ path: `${prefixo}/3b-fechamento-bloqueado.png` })
    await janela.locator('button:has-text("Voltar")').first().click().catch(() => {})
    await espera(800)
  }
}

console.log('\n== 5) o caixa conduz a produção até o pedido ficar pronto')
await entrar(caixa, pageCaixa)
await pageCaixa.goto(`${base}/mesas/${idSessao}`, { waitUntil: 'domcontentloaded' })
await pageCaixa.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
await espera(1500)
for (const passo of ['Confirmado', 'Em preparação', 'Pronto']) {
  const abrirSituacao = pageCaixa.locator('button:has-text("Situação")').first()
  if ((await abrirSituacao.count()) === 0) {
    falhou(`o caixa não encontrou o botão "Situação" para marcar ${passo}`)
    break
  }
  await abrirSituacao.click()
  const janela = pageCaixa.locator('[role="dialog"]').last()
  await janela.waitFor({ timeout: 15_000 }).catch(() => {})
  const botao = janela.locator(`button:has-text("Marcar como ${passo}")`).first()
  if ((await botao.count()) === 0) {
    falhou(`não achei "Marcar como ${passo}" para o caixa`)
    await pageCaixa.keyboard.press('Escape')
    break
  }
  await botao.click()
  await espera(2000)
  await pageCaixa.keyboard.press('Escape').catch(() => {})
  await espera(600)
}
ok('produção conduzida pelo caixa até "Pronto"')

console.log('\n== 6) o garçom entrega pela fila de Pedidos prontos')
await page.goto(`${base}/pedidos-prontos`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()
let entregue = false
for (let tentativa = 0; tentativa < 5 && !entregue; tentativa += 1) {
  // O filtro do Playwright compara o textContent, que não tem espaços entre os
  // elementos ("Mesa 12Pedido #26") — por isso o lookahead em vez de \b, e o
  // número do pedido junto para não confundir a mesa 1 com a 12.
  const cartao = page
    .locator('section')
    .filter({ hasText: new RegExp(`Mesa ${numeroMesa}(?!\\d)`) })
    .filter({ hasText: `Pedido #${numeroPedido}` })
    .first()
  if ((await cartao.count()) === 0) {
    await page.locator('button:has-text("Atualizar")').first().click().catch(() => {})
    await espera(1800)
    continue
  }
  const botao = cartao.locator('button:has-text("Confirmar entrega")').first()
  if ((await botao.count()) === 0) {
    await espera(1800)
    continue
  }
  await botao.click()
  await espera(2600)
  entregue = true
}
if (entregue) ok(`pedido da mesa ${numeroMesa} entregue pela fila`)
else falhou(`não consegui entregar o pedido da mesa ${numeroMesa} pela fila`)

await page.goto(`${base}/mesas/${idSessao}`, { waitUntil: 'domcontentloaded' })
await semEsqueleto()
{
  const abrir = page.locator('button:has-text("Fechar conta")').first()
  if ((await abrir.count()) > 0) {
    await abrir.click()
    const janela = page.locator('[role="dialog"]:has-text("Fechar conta da mesa")').last()
    await janela.waitFor({ timeout: 15_000 }).catch(() => {})
    const texto = await janela.innerText().catch(() => '')
    if (/pedido em andamento/i.test(texto)) falhou('a entrega não zerou a pendência da conta')
    else ok('depois da entrega a pendência zerou (o fechamento não é mais bloqueado por pedido)')
    await janela.locator('button:has-text("Voltar")').first().click().catch(() => {})
    await espera(800)
  }
}

console.log('\n== 7) recebimento PARCIAL: o saldo tem de cair exatamente o que entrou')
{
  const abrir = page.locator('button:has-text("Receber")').first()
  if ((await abrir.count()) === 0) {
    falhou('o botão "Receber" não aparece para o garçom')
  } else {
    await abrir.click()
    const janela = page.locator('[role="dialog"]:has-text("Receber — pedido")').last()
    await janela.waitFor({ timeout: 15_000 }).catch(() => {})
    const pix = janela.locator('button[aria-pressed]').filter({ hasText: /Pix/ }).first()
    if ((await pix.count()) === 0) falhou('não achei a forma "Pix" na janela de recebimento')
    await pix.click({ timeout: 10_000 }).catch(() => {})
    await espera(500)
    const campo = janela.locator('input[inputmode="decimal"]').first()
    await campo.fill('1,00')
    await espera(400)
    const registrar = janela.locator('button:has-text("Registrar")').last()
    if (await registrar.isDisabled()) {
      falhou('o botão "Registrar" ficou desabilitado para um pagamento parcial de R$ 1,00')
    } else {
      await registrar.click()
      await espera(3200)
      const faltaAgora = await lerValor('Falta receber')
      const esperado = (valorTotal ?? 0) - 100
      if (faltaAgora === esperado) {
        ok(`depois de receber R$ 1,00, "Falta receber" mostrou ${dinheiro(faltaAgora)} (esperado: ${dinheiro(esperado)})`)
      } else {
        falhou(`saldo errado depois do recebimento parcial: tela ${faltaAgora === null ? 'ilegível' : dinheiro(faltaAgora)}, esperado ${dinheiro(esperado)}`)
      }
      const recebidoAgora = await lerValor('Recebido')
      if (recebidoAgora === 100) ok('a faixa "Recebido" mostra exatamente R$ 1,00')
      else falhou(`a faixa "Recebido" mostra ${recebidoAgora === null ? 'ilegível' : dinheiro(recebidoAgora)} em vez de R$ 1,00`)
      await janela.screenshot({ path: `${prefixo}/2-recebimento-parcial.png` })
      await janela.locator('button:has-text("Fechar")').first().click().catch(() => {})
      await espera(1200)
    }
  }
}

console.log('\n== 8) o CAIXA aplica 10% de desconto e o total cai')
{
  await pageCaixa.reload({ waitUntil: 'domcontentloaded' })
  await pageCaixa.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
  await espera(1500)
  const botaoDesconto = pageCaixa
    .locator('button:has-text("Desconto")')
    .filter({ hasNotText: 'Remover' })
    .first()
  if ((await botaoDesconto.count()) === 0) {
    falhou('o caixa não vê o botão "Desconto" no pedido')
  } else {
    await botaoDesconto.click()
    const janela = pageCaixa.locator('[role="dialog"]:has-text("Desconto — pedido")').last()
    await janela.waitFor({ timeout: 15_000 }).catch(() => {})
    await janela.locator('input[inputmode="decimal"]').first().fill('10')
    await janela.locator('input').last().fill('Cliente recorrente (robô de aceitação)')
    await espera(400)
    await janela.screenshot({ path: `${prefixo}/3-desconto.png` })
    await janela.locator('button:has-text("Aplicar desconto")').last().click()
    await espera(3200)
    const fechou = (await pageCaixa.locator('[role="dialog"]:has-text("Desconto — pedido")').count()) === 0
    if (fechou) ok('o desconto foi aplicado sem erro na tela do caixa')
    else falhou('a janela de desconto continuou aberta (erro ao aplicar)')
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await semEsqueleto()
  const totalComDesconto = await lerValor('Total da conta')
  const esperado = Math.round(((valorTotal ?? 0) * 0.9))
  if (totalComDesconto === esperado) {
    ok(`total caiu de ${dinheiro(valorTotal)} para ${dinheiro(totalComDesconto)} (10%)`)
  } else {
    falhou(`total depois do desconto: ${totalComDesconto === null ? 'ilegível' : dinheiro(totalComDesconto)}, esperado ${dinheiro(esperado)}`)
  }
  const faltaComDesconto = await lerValor('Falta receber')
  if (faltaComDesconto === esperado - 100) {
    ok(`"Falta receber" acompanhou o desconto: ${dinheiro(faltaComDesconto)}`)
  } else {
    falhou(`"Falta receber" depois do desconto: ${faltaComDesconto === null ? 'ilegível' : dinheiro(faltaComDesconto)}, esperado ${dinheiro(esperado - 100)}`)
  }
}

console.log('\n== 9) o garçom recebe o restante e a conta fecha')
{
  const abrir = page.locator('button:has-text("Receber")').first()
  if ((await abrir.count()) === 0) {
    falhou('o botão "Receber" desapareceu depois do desconto')
  } else {
    await abrir.click()
    const janela = page.locator('[role="dialog"]:has-text("Receber — pedido")').last()
    await janela.waitFor({ timeout: 15_000 }).catch(() => {})
    const dinheiroBtn = janela.locator('button[aria-pressed]').filter({ hasText: /Dinheiro/ }).first()
    await dinheiroBtn.click().catch(() => falhou('não consegui escolher "Dinheiro"'))
    await espera(500)
    const atalho = janela.locator('button').filter({ hasText: /^R\$\s?/ }).first()
    if (await atalho.count()) await atalho.click()
    else await janela.locator('input[inputmode="decimal"]').last().fill('1,00')
    await espera(400)
    await janela.locator('button:has-text("Registrar")').last().click()
    await espera(3000)
    const faltaFinal = await lerValor('Falta receber')
    if (faltaFinal === 0) ok('recebimento do restante registrado — falta receber R$ 0,00')
    else falhou(`depois do restante, falta receber = ${faltaFinal === null ? 'ilegível' : dinheiro(faltaFinal)}`)
    await janela.locator('button:has-text("Fechar")').first().click().catch(() => {})
    await espera(1200)
  }
}

const botaoFechar = page.locator('button:has-text("Fechar conta")').first()
if ((await botaoFechar.count()) === 0) {
  falhou('o botão "Fechar conta" não aparece para o garçom')
} else {
  await botaoFechar.click()
  const janelaFechar = page.locator('[role="dialog"]:has-text("Fechar conta da mesa")').last()
  await janelaFechar.waitFor({ timeout: 15_000 }).catch(() => {})
  const confirmar = janelaFechar.locator('button:has-text("Confirmar fechamento")').last()
  if (await confirmar.isDisabled().catch(() => true)) {
    falhou('o "Confirmar fechamento" está desabilitado — a conta não ficou quitada?')
    await page.keyboard.press('Escape')
  } else {
    await confirmar.click()
    await espera(3200)
    const urlDepois = new URL(page.url()).pathname
    if (urlDepois === '/mesas') ok('conta fechada e mesa liberada (voltou para /mesas)')
    else falhou(`depois de fechar, a tela parou em ${urlDepois}`)
  }
}

console.log('\n== 10) a mesa está livre de novo')
await semEsqueleto()
const livresDepois = page.locator('button').filter({ hasText: 'Iniciar atendimento' })
let mesaVoltou = false
for (let i = 0; i < (await livresDepois.count()); i += 1) {
  if (((await livresDepois.nth(i).innerText()).match(/Mesa (\d+)/) ?? [])[1] === String(numeroMesa)) mesaVoltou = true
}
if (mesaVoltou) ok(`mesa ${numeroMesa} de volta à lista de livres`)
else falhou(`mesa ${numeroMesa} não voltou para a lista de livres`)

if (errosDeConsole.length) aviso(`${errosDeConsole.length} erro(s) de console (o primeiro: ${resumo(errosDeConsole[0], 120)})`)

await navegador.close()

console.log('')
if (falhas.length === 0) {
  console.log(`TUDO CERTO: recebimento em partes e desconto conferidos na mesa ${numeroMesa} (${idSessao}).`)
  process.exit(0)
}
console.log(`${falhas.length} FALHA(S):\n - ${falhas.join('\n - ')}`)
process.exit(1)
