/**
 * Verificação de rolagem lateral no celular (garçom) e no computador.
 *
 * Mede `scrollWidth` contra `clientWidth` em cada tela. Se a página passa da
 * largura da tela, o dedo arrasta a tela inteira para o lado — erro clássico e
 * muito irritante em sistema de salão.
 *
 * Uso: node tools/checar-rolagem.mjs [URL]
 */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4194'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const PERFIS = [
  {
    nome: 'garcom',
    usuario: process.env.PZ_GARCOM_LOGIN ?? 'garcom',
    senha: process.env.PZ_GARCOM_PASSWORD,
    telas: ['/mesas', '/historico'],
  },
  {
    nome: 'caixa',
    usuario: process.env.PZ_CAIXA_LOGIN ?? 'caixa',
    senha: process.env.PZ_CAIXA_PASSWORD,
    telas: ['/mesas', '/caixa', '/controle-caixa', '/historico'],
  },
]

// Senhas vêm do ambiente (nunca do repositório): sem elas o robô avisa e para,
// em vez de tentar entrar com senha vazia e reportar falhas que não existem.
for (const perfil of PERFIS) {
  if (!perfil.senha) {
    console.error(`Defina PZ_${perfil.nome.toUpperCase()}_PASSWORD para rodar o robô.`)
    process.exit(2)
  }
}

const falhas = []
const navegador = await chromium.launch()
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function entrar(page, perfil) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 })
  await page.fill('input[autocomplete="username"]', perfil.usuario)
  await page.fill('input[autocomplete="current-password"]', perfil.senha)
  await page.click('button[type="submit"]')
  await page
    .waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 30000 })
    .catch(() => {})
  await espera(2200)
  // Conta com troca de senha obrigatória pendente: o sistema mostra APENAS a tela
  // de troca (na mesma URL), e o robô acabaria medindo sempre a mesma tela, dando
  // "tudo certo" sem ter visto nada. Melhor falhar com o motivo na cara.
  const telaDeTroca = await page.locator('text=Defina sua senha definitiva').count()
  if (telaDeTroca > 0) {
    throw new Error(
      `a conta ${perfil.usuario} está com troca de senha obrigatória pendente — ` +
        'conclua o primeiro acesso (tools/preparar-contas-robo.mjs ou tools/primeiro-acesso.mjs); ' +
        'sem isso o robô mediria a tela de troca em vez das telas do sistema',
    )
  }

}

for (const perfil of PERFIS) {
  const page = await contexto.newPage()
  await entrar(page, perfil)
  for (const rota of perfil.telas) {
    await page.goto(`${base}${rota}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25000 }).catch(() => {})
    await espera(800)
    const medida = await page.evaluate(() => ({
      cliente: document.documentElement.clientWidth,
      rolagem: document.documentElement.scrollWidth,
    }))
    const excesso = medida.rolagem - medida.cliente
    const linha = `${perfil.nome} ${rota}: tela ${medida.cliente}px, conteúdo ${medida.rolagem}px`
    if (excesso > 2) {
      falhas.push(`${linha} (${excesso}px de sobra)`)
      console.log(`  FALHA ${linha}`)
    } else {
      console.log(`  OK    ${linha}`)
    }
  }
  // A conta da mesa é a tela que o garçom mais usa — vale checar também.
  await page.goto(`${base}/mesas`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25000 }).catch(() => {})
  await espera(600)
  const cartoes = page.locator('button').filter({ hasText: /^Mesa \d/ })
  const total = await cartoes.count()
  for (let i = 0; i < Math.min(total, 12); i += 1) {
    const cartao = cartoes.nth(i)
    const ocupada = await cartao.evaluate((el) => /Ocupada|Aguardando|Atenção/.test(el.textContent ?? ''))
    if (!ocupada) continue
    await cartao.click()
    await espera(700)
    const abrir = page.locator('button').filter({ hasText: /^(Abrir|Acompanhar)/ }).first()
    if ((await abrir.count()) === 0) continue
    await abrir.click()
    await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25000 }).catch(() => {})
    await espera(1200)
    const medida = await page.evaluate(() => ({
      cliente: document.documentElement.clientWidth,
      rolagem: document.documentElement.scrollWidth,
      rota: location.pathname,
    }))
    const excesso = medida.rolagem - medida.cliente
    const linha = `${perfil.nome} ${medida.rota}: tela ${medida.cliente}px, conteúdo ${medida.rolagem}px`
    if (excesso > 2) {
      falhas.push(`${linha} (${excesso}px de sobra)`)
      console.log(`  FALHA ${linha}`)
    } else {
      console.log(`  OK    ${linha}`)
    }
    break
  }

  await page.close()
}

await navegador.close()
console.log(`\n${falhas.length === 0 ? 'Sem rolagem lateral em nenhuma tela.' : `FALHAS: ${falhas.length}`}`)
process.exit(falhas.length === 0 ? 0 : 1)
