#!/usr/bin/env node
/**
 * =============================================================================
 * Aceitação da REGRA DE DINHEIRO de 16/10/2026 — o GARÇOM vê, recebe e fecha.
 *
 * O robô faz o ciclo inteiro como garçom, no celular (é o aparelho dele):
 *
 *   1. entra com a conta de apoio do garçom;
 *   2. abre a última mesa livre do salão (a menos usada) e lança um item;
 *   3. confere que a tela da conta MOSTRA o valor (Total da conta / Recebido /
 *      Falta receber) — antes desta correção o garçom não via dinheiro nenhum;
 *   4. abre a janela "Receber", escolhe Dinheiro, informa quanto o cliente
 *      entregou e registra o recebimento (o valor entra no caixa do turno);
 *   5. fecha a conta quitada e libera a mesa;
 *   6. volta para /mesas e confere que a mesa está livre de novo.
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
const prefixo = process.env.PZ_PRINTS ?? 'artifacts/garcom-recebe'
const celular = { width: 390, height: 844 }

if (!garcom.senha) {
  console.error('Defina PZ_GARCOM_PASSWORD.')
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

const errosDeConsole = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errosDeConsole.push(msg.text())
})

async function entrar() {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  if (await page.locator('button:has-text("Entrar com outra conta")').count()) {
    await page.locator('button:has-text("Entrar com outra conta")').click()
  }
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 })
  await page.fill('input[autocomplete="username"]', garcom.login)
  await page.fill('input[autocomplete="current-password"]', garcom.senha)
  await page.click('button[type="submit"]')
  await page
    .waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 30_000 })
    .catch(() => {})
  await espera(2200)
  if ((await page.locator('text=Defina sua senha definitiva').count()) > 0) {
    throw new Error(`${garcom.login} está com troca de senha obrigatória pendente`)
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
for (const nomeAba of ['Bebidas', 'Porções']) {
  if (lancado) break
  const aba = page.locator('button').filter({ hasText: new RegExp(`^${nomeAba}\\b`) }).first()
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
  const avisoEnvio = (await page.locator('body').innerText()).match(/Pedido #[^]*?(produção\.)/)
  if (avisoEnvio) ok(`pedido lançado (${resumo(avisoEnvio[0], 60)})`)
  else aviso('sem confirmação textual do envio — seguindo pela conta')
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

console.log('\n== 4) o garçom registra o recebimento')
if ((valorFalta ?? 0) === 0) {
  aviso('a conta já estava quitada — pulando o registro e indo direto ao fechamento')
} else {
  const botaoReceber = page.locator('button:has-text("Receber")').first()
  if ((await botaoReceber.count()) === 0) {
    falhou('o botão "Receber" não aparece para o garçom')
  } else {
    await botaoReceber.click()
    const janela = page.locator('[role="dialog"]:has-text("Receber — pedido")').last()
    await janela.waitFor({ timeout: 15_000 }).catch(() => {})
    const textoJanela = await janela.innerText().catch(() => '')
    if (textoJanela.includes('Nenhum caixa aberto')) {
      falhou('a janela diz que não há caixa aberto — o garçom foi bloqueado pela gaveta que ele não lê')
    } else {
      ok('a janela de recebimento abre sem bloquear o garçom pelo caixa')
    }
    if (textoJanela.includes('Nenhuma forma de pagamento ativa')) {
      falhou('a janela não oferece forma de pagamento')
    } else {
      const dinheiroBtn = janela.locator('button[aria-pressed]').filter({ hasText: /Dinheiro/ }).first()
      await dinheiroBtn.click({ timeout: 10_000 }).catch(() => falhou('não consegui escolher a forma "Dinheiro"'))
      await espera(500)

      // Dinheiro exige quanto o cliente entregou. O sistema oferece o atalho com
      // o valor exato do pagamento (troco zero) — é o caminho mais rápido no salão.
      const exato = (valorFalta / 100).toFixed(2).replace('.', ',')
      const atalho = janela
        .locator('button')
        .filter({ hasText: new RegExp(`^R\\$\\s?${exato.replace('.', '\\.')}$`) })
        .first()
      if (await atalho.count()) {
        await atalho.click()
        ok(`valor entregue informado pelo atalho ${dinheiro(valorFalta)}`)
      } else {
        await janela.locator('input[inputmode="decimal"]').last().fill(exato)
        aviso(`atalho ${dinheiro(valorFalta)} não encontrado — digitei o valor entregue`)
      }
      await espera(500)
      await janela.screenshot({ path: `${prefixo}/2-receber.png` })

      const registrar = janela.locator('button:has-text("Registrar")').last()
      if (await registrar.isDisabled()) {
        falhou('o botão "Registrar" está desabilitado para o garçom (bloqueio de caixa ou de valor?)')
      } else {
        await registrar.click()
        await espera(3000)
        const faltaDepois = await lerValor('Falta receber')
        if (faltaDepois === 0) ok(`recebimento registrado — falta receber ${dinheiro(faltaDepois)}`)
        else falhou(`o recebimento não entrou: falta receber continua ${faltaDepois === null ? 'ilegível' : dinheiro(faltaDepois)}`)
        // A janela continua aberta de propósito (permite receber em partes):
        // quem fecha é o operador.
        const fecharJanela = janela.locator('button:has-text("Fechar")').first()
        if (await fecharJanela.count()) {
          await fecharJanela.click().catch(() => {})
          await espera(1200)
        }
      }
    }
    await page.screenshot({ path: `${prefixo}/3-conta-recebida.png`, fullPage: true })
  }
}

console.log('\n== 5) o garçom fecha a conta quitada')
await page
  .locator('[role="dialog"]:has-text("Receber — pedido")')
  .waitFor({ state: 'detached', timeout: 10_000 })
  .catch(() => aviso('a janela de recebimento continuou aberta'))
const botaoFechar = page.locator('button:has-text("Fechar conta")').first()
if ((await botaoFechar.count()) === 0) {
  falhou('o botão "Fechar conta" não aparece para o garçom')
} else {
  await botaoFechar.click()
  const janelaFechar = page.locator('[role="dialog"]:has-text("Fechar conta da mesa")').last()
  await janelaFechar.waitFor({ timeout: 15_000 }).catch(() => {})
  await janelaFechar.screenshot({ path: `${prefixo}/4-fechar.png` })
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
await page.screenshot({ path: `${prefixo}/5-depois-de-fechar.png`, fullPage: true })

console.log('\n== 6) a mesa está livre de novo')
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
  console.log(`TUDO CERTO: o garçom viu o valor, recebeu e fechou a conta da mesa ${numeroMesa} (${idSessao}).`)
  process.exit(0)
}
console.log(`${falhas.length} FALHA(S):\n - ${falhas.join('\n - ')}`)
process.exit(1)
