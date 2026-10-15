import { chromium } from 'playwright'
const base = process.argv[2]
const admin = process.env.PZ_ADMIN_PASSWORD
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const contas = [
  { login: 'robo.caixa', nome: 'Robô Caixa (teste automatizado)', senha: process.env.SENHA_CAIXA, funcao: 'Caixa' },
  { login: 'robo.garcom', nome: 'Robô Garçom (teste automatizado)', senha: process.env.SENHA_GARCOM, funcao: 'Garçom' },
]
const b = await chromium.launch()
const registrar = (pg) => {
  pg.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300)) })
  pg.on('response', (r) => { if (r.url().includes('/functions/v1/')) console.log('EDGE:', r.status(), r.url().slice(-40)) })
}
const pg = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })).newPage()
registrar(pg)
await pg.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await pg.waitForSelector('input[autocomplete="username"]', { timeout: 30000 })
if (await pg.locator('button:has-text("Entrar com outra conta")').count()) {
  await pg.locator('button:has-text("Entrar com outra conta")').click()
  await pg.waitForSelector('input[autocomplete="username"]', { timeout: 30000 })
}
await pg.fill('input[autocomplete="username"]', 'admin')
await pg.fill('input[autocomplete="current-password"]', admin)
await pg.click('button[type="submit"]')
await espera(5000)
console.log('login admin:', pg.url())

for (const conta of contas) {
  await pg.goto(`${base}/funcionarios`, { waitUntil: 'domcontentloaded' })
  await pg.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25000 }).catch(() => {})
  await espera(1200)
  if (await pg.locator(`text=${conta.login}`).count()) {
    console.log(`${conta.login}: já existe`)
    continue
  }
  await pg.locator('button:has-text("Novo funcionário")').first().click()
  await espera(900)
  const modal = pg.locator('[role="dialog"]').first()
  await modal.locator('label:has-text("Nome completo") input').fill(conta.nome)
  await modal.locator('label:has-text("Login") input').fill(conta.login)
  await modal.locator('label:has-text("Função") select').selectOption(conta.funcao === 'Caixa' ? 'manager' : 'waiter')
  await modal.locator('label:has-text("Senha inicial") input').fill(conta.senha)
  await pg.locator('[role="dialog"] button:has-text("Criar funcionário")').click()
  try {
    await pg.locator('[role="dialog"]:has-text("Senha temporária gerada")').waitFor({ state: 'visible', timeout: 20000 })
    console.log(`${conta.login}: criado (senha temporária confirmada na tela)`)
  } catch {
    const texto = (await pg.locator('body').innerText()).replace(/\n+/g, ' | ')
    console.log(`${conta.login}: FALHOU ->`, texto.slice(-700))
  }
  const fechar = pg.locator('[role="dialog"]:has-text("Senha temporária gerada") button:has-text("Fechar")').last()
  if (await fechar.count()) { await fechar.click(); await espera(800) }
}
await b.close()
