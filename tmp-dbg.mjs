import { chromium } from 'playwright'
const base = 'https://pizzaria-gestao-v2.vercel.app'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const nav = await chromium.launch()
const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' })
const p = await ctx.newPage(); p.setDefaultTimeout(20000)
await p.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
if (await p.locator('button:has-text("Entrar com outra conta")').count()) await p.locator('button:has-text("Entrar com outra conta")').click()
await p.fill('input[autocomplete="username"]', 'robo.garcom')
await p.fill('input[autocomplete="current-password"]', 'Salao.Robo@2026!')
await p.click('button[type="submit"]')
await espera(2500)
await p.goto(`${base}/mesas`, { waitUntil: 'domcontentloaded' })
await p.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25000 }).catch(() => {})
await espera(1500)
const info = await p.evaluate(() => {
  const grade = document.querySelector('.grade-navegavel')
  const cartoes = [...document.querySelectorAll('.grade-navegavel')]
  return {
    quantos: cartoes.length,
    exemplo: cartoes.slice(0, 3).map((c) => ({ tag: c.tagName, cls: c.className.slice(0, 60), texto: (c.textContent ?? '').replace(/\s+/g, ' ').slice(0, 70) })),
    ancora: grade ? (grade.tagName + ' | ' + [...grade.querySelectorAll('a[href^="/mesas/"]')].length) : 'sem .grade-navegavel',
  }
})
console.log(JSON.stringify(info, null, 1))
await nav.close()
