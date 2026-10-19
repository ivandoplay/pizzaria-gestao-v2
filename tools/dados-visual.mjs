#!/usr/bin/env node
/**
 * Cria um punhado de pedidos de delivery REAIS para a revisão visual das telas
 * "Caixa" e "Delivery" com conteúdo (a tela vazia não mostra nada).
 *
 * Nada é apagado: os pedidos ficam como qualquer pedido de demonstração
 * lançado no balcão e podem ser cancelados pelo caminho normal depois.
 *
 * Uso:
 *   PZ_CAIXA_PASSWORD=... node tools/dados-visual.mjs https://pizzaria-gestao-v2.vercel.app
 */
import { chromium } from 'playwright'

const base = process.argv[2]
if (!base) {
  console.error('Uso: node tools/dados-visual.mjs <URL>')
  process.exit(2)
}
const caixa = { login: process.env.PZ_CAIXA_LOGIN ?? 'robo.caixa', senha: process.env.PZ_CAIXA_PASSWORD }
if (!caixa.senha) {
  console.error('Defina PZ_CAIXA_PASSWORD.')
  process.exit(2)
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const navegador = await chromium.launch()
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })
const page = await ctx.newPage()
page.setDefaultTimeout(25_000)

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[autocomplete="username"]', caixa.login)
await page.fill('input[autocomplete="current-password"]', caixa.senha)
await page.click('button[type="submit"]')
await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 30_000 })
await espera(2000)

const clientes = [
  ['Maria do Socorro', '86988110001', 'Centro', 'Rua Grande', '412'],
  ['João Batista Lima', '86988110002', 'Fátima', 'Rua Coelho de Resende', '88'],
  ['Antônia Rodrigues', '86988110003', 'Dirceu Arcoverde', 'Quadra 12, casa 6', '12'],
]

for (const [nome, telefone, bairro, rua, numero] of clientes) {
  await page.goto(`${base}/delivery`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)
  await page.locator('button:has-text("Novo pedido")').first().click()
  const janela = page.locator('[role="dialog"]:has-text("Novo pedido de delivery")').last()
  await janela.waitFor({ timeout: 15_000 })
  // O rótulo do campo é um <label> que envolve o input: localizar por rótulo
  // evita depender da ordem dos campos (que muda quando a tela evolui).
  const campo = (rotulo) => janela.locator('label', { hasText: rotulo }).locator('input').first()
  await campo('Nome do cliente').fill(nome)
  await campo('Telefone com DDD').fill(telefone)
  await campo('Rua').fill(rua)
  await campo('Número').fill(numero)
  await campo('Bairro').fill(bairro)
  await espera(700)
  // Item: primeiro produto com preço na aba inicial
  const produto = janela.locator('button').filter({ hasText: /R\$\s?\d/ }).first()
  await produto.click()
  await espera(700)
  const montagem = page.locator('[role="dialog"]:has-text("Adicionar ·")').last()
  if (await montagem.count()) {
    const grupos = montagem.locator('label')
    for (let g = 0; g < (await grupos.count()); g += 1) {
      const grupo = grupos.nth(g)
      const titulo = await grupo.locator('span').first().innerText().catch(() => '')
      if (!titulo.includes('*')) continue
      if ((await grupo.locator('button[aria-pressed="true"]').count()) === 0) {
        await grupo.locator('button[aria-pressed]').first().click().catch(() => {})
      }
    }
    await montagem.locator('button:has-text("Adicionar ·")').last().click()
    await espera(800)
  }
  const registrar = janela.locator('button').filter({ hasText: /^Registrar pedido ·/ }).last()
  if (await registrar.isDisabled()) {
    const texto = await janela.locator('body, [role="dialog"]').first().innerText().catch(() => '')
    console.log(`NÃO criado para ${nome}: botão desabilitado — ${texto.replace(/\s+/g, ' ').slice(0, 200)}`)
    await page.screenshot({ path: '/home/user/falha-delivery.png' })
    await page.keyboard.press('Escape')
    continue
  }
  await registrar.click()
  await espera(3000)
  const sucesso = (await page.locator('body').innerText()).match(/Pedido #(\d+)/)
  console.log(`criado para ${nome}: ${sucesso ? '#' + sucesso[1] : '(sem número na tela)'}`)
}

await navegador.close()
