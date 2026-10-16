#!/usr/bin/env node
/**
 * =============================================================================
 * Fecha as contas de teste que os robôs deixam abertas na base.
 *
 * Por que existe: os robôs de aceitação abrem mesa de verdade (é o único jeito
 * de provar o fluxo) e alguns terminam de propósito com a conta aberta — o
 * `e2e-fila.mjs`, por exemplo, para no momento em que o pedido é entregue, e a
 * conta fica esperando o caixa. Depois de algumas rodadas o salão acumula mesas
 * abertas de teste, o que atrapalha a leitura da tela de Mesas.
 *
 * O que faz, por conta aberta, SEMPRE pelo caminho do sistema (nada de SQL):
 *   1. o caixa conduz cada pedido pendente até "Pronto";
 *   2. o garçom entrega pela fila de Pedidos prontos;
 *   3. o garçom registra os recebimentos que faltam (dinheiro, valor exato);
 *   4. o garçom fecha a conta quitada.
 *
 * Segurança: por padrão NÃO fecha nada — apenas lista o que encontrou e o que
 * faria. Para executar é preciso pedir explicitamente:
 *
 *   PZ_FECHAR=sim node tools/limpar-contas-teste.mjs <URL>
 *
 * Nunca apague nada: o fechamento é o mesmo caminho auditado do dia a dia.
 *
 * Uso completo:
 *   PZ_GARCOM_PASSWORD=... PZ_CAIXA_PASSWORD=... node tools/limpar-contas-teste.mjs <URL>
 *   PZ_FECHAR=sim PZ_GARCOM_PASSWORD=... PZ_CAIXA_PASSWORD=... node tools/limpar-contas-teste.mjs <URL>
 *
 * Opcional: PZ_MESAS=4,5,7 limita a limpeza a essas mesas (útil quando há uma
 * conta de demonstração que você quer manter aberta).
 * =============================================================================
 */
import { chromium } from 'playwright'

const base = process.argv[2]
if (!base) {
  console.error('Uso: node tools/limpar-contas-teste.mjs <URL>')
  process.exit(2)
}

const executar = (process.env.PZ_FECHAR ?? '').toLowerCase() === 'sim'
const soMesas = (process.env.PZ_MESAS ?? '')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)

const garcom = { login: process.env.PZ_GARCOM_LOGIN ?? 'robo.garcom', senha: process.env.PZ_GARCOM_PASSWORD }
const caixa = { login: process.env.PZ_CAIXA_LOGIN ?? 'robo.caixa', senha: process.env.PZ_CAIXA_PASSWORD }

if (!garcom.senha || !caixa.senha) {
  console.error('Defina PZ_GARCOM_PASSWORD e PZ_CAIXA_PASSWORD.')
  process.exit(2)
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const celular = { width: 390, height: 844 }
const falhas = []

async function entrar(page, conta) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  if (await page.locator('button:has-text("Entrar com outra conta")').count()) {
    await page.locator('button:has-text("Entrar com outra conta")').click()
  }
  await page.fill('input[autocomplete="username"]', conta.login)
  await page.fill('input[autocomplete="current-password"]', conta.senha)
  await page.click('button[type="submit"]')
  await espera(2500)
}

async function semEsqueleto(page) {
  await page
    .waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 })
    .catch(() => {})
  await espera(1200)
}

/** Números (#N) dos pedidos que ainda têm botão "Situação" disponível. */
async function pedidosPendentes(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('li')]
      .map((li) => {
        const numero = (li.textContent ?? '').match(/#(\d+)/)
        const temSituacao = [...li.querySelectorAll('button')].some((b) => /Situação/.test(b.textContent ?? ''))
        const status = (li.textContent ?? '').match(/RECEBIDO|CONFIRMADO|EM PREPARAÇÃO|PRONTO|ENTREGUE À MESA/i)?.[0] ?? ''
        return numero && temSituacao ? { numero: Number(numero[1]), status } : null
      })
      .filter(Boolean),
  )
}

async function avancarAtePronto(page, numero, mesa) {
  for (const rotulo of ['Confirmado', 'Em preparação', 'Pronto']) {
    await page.goto(`${base}/mesas/${page.__sessao}`, { waitUntil: 'domcontentloaded' })
    await semEsqueleto(page)
    const cartao = page.locator('li').filter({ hasText: `#${numero}` }).first()
    const situacao = cartao.locator('button:has-text("Situação")').first()
    if ((await situacao.count()) === 0) return
    await situacao.click()
    await espera(800)
    const opcao = page.locator(`button:has-text("Marcar como ${rotulo}")`).first()
    if (await opcao.count()) {
      await opcao.click()
      console.log(`    mesa ${mesa} · pedido #${numero} → ${rotulo}`)
      await espera(2200)
    }
    await page.keyboard.press('Escape')
    await espera(400)
  }
}

async function entregarNaFila(page, mesa) {
  await page.goto(`${base}/pedidos-prontos`, { waitUntil: 'domcontentloaded' })
  await semEsqueleto(page)
  for (let tentativa = 0; tentativa < 6; tentativa += 1) {
    const cartao = page.locator('section').filter({ hasText: new RegExp(`Mesa ${mesa}(?!\\d)`) }).first()
    const botao = cartao.locator('button:has-text("Confirmar entrega")').first()
    if ((await botao.count()) === 0) {
      const atualizar = page.locator('button:has-text("Atualizar")').first()
      if (await atualizar.count()) await atualizar.click()
      await espera(1500)
      continue
    }
    await botao.click()
    await espera(2500)
  }
}

async function receberTudo(page, mesa) {
  // Um pedido já quitado continua mostrando o botão "Receber" (para consultar os
  // recebimentos), e a janela dele abre com "Registrar R$ 0,00" desabilitado.
  // Por isso o laço percorre os pedidos POR NÚMERO e pula os que não têm saldo —
  // insistir no primeiro cartão da lista trava o processo no pedido já pago.
  const numeros = await page.evaluate(() =>
    [
      ...new Set(
        [...document.querySelectorAll('li')]
          .map((li) => (li.textContent ?? '').match(/#(\d+)/)?.[1])
          .filter(Boolean)
          .map(Number),
      ),
    ],
  )

  for (const numero of numeros) {
    const cartao = page.locator('li').filter({ hasText: `#${numero}` }).first()
    const receber = cartao.locator('button:has-text("Receber")').first()
    if ((await receber.count()) === 0) continue
    await receber.click()
    await espera(1500)
    const janela = page.locator('[role="dialog"]:has-text("Receber — pedido")').last()
    if ((await janela.count()) === 0) continue
    const registrar = janela.locator('button').filter({ hasText: /^Registrar/ }).last()
    if (await registrar.isDisabled().catch(() => true)) {
      // Sem saldo neste pedido — fecha e segue para o próximo.
      await janela.locator('button:has-text("Fechar")').last().click()
      await espera(700)
      continue
    }
    const atalho = janela.locator('button').filter({ hasText: /^R\$/ }).first()
    if (await atalho.count()) {
      await atalho.click()
      await espera(500)
    }
    await registrar.click()
    console.log(`    mesa ${mesa} · pedido #${numero} recebido (${await registrar.innerText().catch(() => '')})`)
    await espera(2800)
    await janela.locator('button:has-text("Fechar")').last().click().catch(() => {})
    await espera(700)
  }
}

async function fecharConta(page, mesa) {
  const abrir = page.locator('button:has-text("Fechar conta")').first()
  if ((await abrir.count()) === 0) return false
  await abrir.click()
  await espera(1200)
  const janela = page.locator('[role="dialog"]:has-text("Fechar conta da mesa")').last()
  const confirmar = janela.locator('button:has-text("Confirmar fechamento")').last()
  if (await confirmar.isDisabled().catch(() => true)) {
    const texto = (await janela.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 220)
    falhas.push(`mesa ${mesa}: não deu para fechar — ${texto}`)
    await page.keyboard.press('Escape')
    return false
  }
  await confirmar.click()
  await espera(3000)
  console.log(`    mesa ${mesa} · conta fechada (${new URL(page.url()).pathname})`)
  return true
}

// ---------------------------------------------------------------------------
// 1) Quem está aberto agora
// ---------------------------------------------------------------------------
const navegador = await chromium.launch()
const contextoGarcom = await navegador.newContext({ viewport: celular, isMobile: true, hasTouch: true, locale: 'pt-BR' })
const garcomPage = await contextoGarcom.newPage()
garcomPage.setDefaultTimeout(25_000)
const contextoCaixa = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })
const caixaPage = await contextoCaixa.newPage()
caixaPage.setDefaultTimeout(25_000)

await entrar(garcomPage, garcom)
await entrar(caixaPage, caixa)

await garcomPage.goto(`${base}/mesas`, { waitUntil: 'domcontentloaded' })
await semEsqueleto(garcomPage)

// Cada mesa ocupada tem um atalho "Ver conta e receber" que navega para a
// sessão — é o link que diz qual é o atendimento aberto (o cartão em si é um
// botão, e o link é irmão dele, não filho).
const encontradas = await garcomPage.evaluate(() =>
  [...document.querySelectorAll('a[href^="/mesas/"]')]
    .map((link) => {
      const cartao = link.closest('div') ?? link.parentElement
      const numero = Number((cartao?.textContent ?? '').match(/Mesa (\d+)/)?.[1] ?? 0)
      return numero > 0 ? { numero, sessao: link.getAttribute('href').replace('/mesas/', '') } : null
    })
    .filter(Boolean),
)
// A filtragem por mesa acontece aqui fora: `soMesas` é do Node e não existe
// dentro do navegador onde o evaluate roda.
const abertas = encontradas.filter((mesa) => soMesas.length === 0 || soMesas.includes(mesa.numero))

console.log(`\nContas abertas encontradas: ${abertas.length}`)
for (const mesa of abertas) console.log(`  mesa ${mesa.numero} · sessão ${mesa.sessao.slice(0, 8)}`)

if (!executar) {
  console.log('\nSimulação: nada foi fechado. Para executar de verdade, repita com PZ_FECHAR=sim.')
  await navegador.close()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 2) Fecha cada uma pelo caminho normal
// ---------------------------------------------------------------------------
for (const mesa of abertas) {
  console.log(`\n== mesa ${mesa.numero}`)
  caixaPage.__sessao = mesa.sessao
  garcomPage.__sessao = mesa.sessao

  await caixaPage.goto(`${base}/mesas/${mesa.sessao}`, { waitUntil: 'domcontentloaded' })
  await semEsqueleto(caixaPage)
  const pendentes = await pedidosPendentes(caixaPage)
  for (const pedido of pendentes) {
    if (/ENTREGUE À MESA/i.test(pedido.status)) continue
    await avancarAtePronto(caixaPage, pedido.numero, mesa.numero)
  }

  await entregarNaFila(garcomPage, mesa.numero)

  await garcomPage.goto(`${base}/mesas/${mesa.sessao}`, { waitUntil: 'domcontentloaded' })
  await semEsqueleto(garcomPage)
  await receberTudo(garcomPage, mesa.numero)
  await fecharConta(garcomPage, mesa.numero)
}

console.log('\n== conferência final')
await garcomPage.goto(`${base}/mesas`, { waitUntil: 'domcontentloaded' })
await semEsqueleto(garcomPage)
const restantes = await garcomPage.evaluate(() =>
  [...document.querySelectorAll('a[href^="/mesas/"]')]
    .map((link) => {
      const cartao = link.closest('div') ?? link.parentElement
      return (cartao?.textContent ?? '').match(/Mesa (\d+)/)?.[1] ?? '?'
    }),
)
console.log(restantes.length === 0 ? '  nenhuma mesa aberta' : `  ainda abertas: ${restantes.join(', ')}`)

if (falhas.length > 0) {
  console.log('\nOcorrências:')
  for (const falha of falhas) console.log(`  - ${falha}`)
}

await navegador.close()
process.exit(falhas.length > 0 || restantes.length > 0 ? 1 : 0)
