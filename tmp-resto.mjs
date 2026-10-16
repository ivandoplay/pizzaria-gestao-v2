import { chromium } from 'playwright'
const base = 'https://pizzaria-gestao-v2.vercel.app'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const nav = await chromium.launch()
const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })
const p = await ctx.newPage(); p.setDefaultTimeout(20000)
await p.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
if (await p.locator('button:has-text("Entrar com outra conta")').count()) await p.locator('button:has-text("Entrar com outra conta")').click()
await p.fill('input[autocomplete="username"]', 'robo.garcom')
await p.fill('input[autocomplete="current-password"]', 'Salao.Robo@2026!')
await p.click('button[type="submit"]'); await espera(2500)

for (const sessao of ['cb450d6c-12d4-4cd8-b04c-6ce1ae49fc9e', '3015bc20-376b-4106-896b-2a3677f8db2c']) {
  await p.goto(`${base}/mesas/${sessao}`, { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25000 }).catch(() => {})
  await espera(1800)
  console.log('\n=== sessão', sessao.slice(0, 8))
  for (let volta = 0; volta < 6; volta++) {
    const cartao = p.locator('li').filter({ has: p.locator('button:has-text("Receber")') }).first()
    const n = await cartao.count()
    if (n === 0) { console.log('sem mais botão Receber'); break }
    const numero = (await cartao.innerText()).match(/#(\d+)/)?.[1]
    await cartao.locator('button:has-text("Receber")').first().click()
    await espera(1600)
    const janela = p.locator('[role="dialog"]:has-text("Receber — pedido")').last()
    if ((await janela.count()) === 0) { console.log('#' + numero, 'não abriu a janela'); await p.keyboard.press('Escape'); continue }
    const texto = (await janela.innerText()).replace(/\s+/g, ' ')
    console.log(`#${numero} · janela: ${texto.slice(0, 150)}`)
    const atalho = janela.locator('button').filter({ hasText: /^R\$/ }).first()
    console.log('  atalhos:', (await janela.locator('button').filter({ hasText: /^R\$/ }).allInnerTexts()).join(' | '))
    if (await atalho.count()) { await atalho.click(); await espera(600) }
    const registrar = janela.locator('button').filter({ hasText: /^Registrar/ }).last()
    console.log('  registrar:', await registrar.innerText().catch(() => '-'), '| habilitado:', !(await registrar.isDisabled().catch(() => true)))
    if (await registrar.isDisabled().catch(() => true)) {
      const campos = await janela.locator('input').count()
      console.log('  campos na janela:', campos)
      await janela.locator('button:has-text("Fechar")').last().click().catch(() => {})
      await espera(700)
      continue
    }
    await registrar.click(); await espera(3000)
    await janela.locator('button:has-text("Fechar")').last().click().catch(() => {})
    await espera(900)
  }
  // tenta fechar
  const fechar = p.locator('button:has-text("Fechar conta")').first()
  await fechar.click(); await espera(1200)
  const j = p.locator('[role="dialog"]:has-text("Fechar conta da mesa")').last()
  const conf = j.locator('button:has-text("Confirmar fechamento")').last()
  console.log('  resumo:', (await j.innerText()).replace(/\s+/g, ' ').slice(0, 130))
  if (await conf.isDisabled().catch(() => true)) { console.log('  BLOQUEADO'); await p.keyboard.press('Escape') }
  else { await conf.click(); await espera(3000); console.log('  fechada →', new URL(p.url()).pathname) }
}
await nav.close()
