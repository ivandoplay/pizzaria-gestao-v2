/**
 * Primeiro acesso de uma conta com senha temporária (troca obrigatória).
 *
 * Uso:
 *   node tools/primeiro-acesso.mjs <URL> <login> <senha-temporaria> <senha-nova>
 *
 * Serve para duas coisas:
 *   1. quem recebeu senha temporária do administrador usa este caminho para
 *      definir a senha definitiva (a tela é a mesma do sistema — o robô só
 *      automatiza o preenchimento);
 *   2. provar que a troca obrigatória funciona de ponta a ponta: o robô confere
 *      que a senha temporária NÃO abre o sistema, troca, entra com a senha nova
 *      e confirma que a antiga deixou de valer.
 *
 * Não imprime nada além do que a tela mostra. Rode contra a URL publicada.
 */
import { chromium } from 'playwright'

const [url, login, senhaAtual, senhaNova] = process.argv.slice(2)
if (!url || !login || !senhaAtual || !senhaNova) {
  console.error('Uso: node tools/primeiro-acesso.mjs <URL> <login> <senha-temporaria> <senha-nova>')
  process.exit(2)
}
if (senhaNova.length < 8) {
  console.error('A senha nova precisa ter pelo menos 8 caracteres.')
  process.exit(2)
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const falhas = []
const ok = (t) => console.log(`  OK    ${t}`)
const falhou = (t) => {
  falhas.push(t)
  console.log(`  FALHA ${t}`)
}

const navegador = await chromium.launch()
const page = await (await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' })).newPage()

async function entrar(senha) {
  await page.goto(`${url}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 })
  if (await page.locator('button:has-text("Entrar com outra conta")').count()) {
    await page.locator('button:has-text("Entrar com outra conta")').click()
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 })
  }
  await page.fill('input[autocomplete="username"]', login)
  await page.fill('input[autocomplete="current-password"]', senha)
  await page.click('button[type="submit"]')
  await espera(4500)
}

async function sair() {
  const botao = page.locator('button[title="Sair do sistema"]:visible, button[aria-label="Sair do sistema"]:visible').last()
  if ((await botao.count()) === 0) return false
  await botao.click()
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  await page.locator('[role="dialog"] button:has-text("Sair")').last().click()
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 20000 }).catch(() => {})
  await espera(800)
  return true
}

console.log(`\n== Primeiro acesso de "${login}" em ${url}`)

await entrar(senhaAtual)
const primeiro = (await page.locator('h1').first().innerText().catch(() => '')).trim()
if (!/Defina sua senha definitiva/i.test(primeiro)) {
  falhou(`"${login}" não está com troca obrigatória pendente (título "${primeiro}")`)
  await navegador.close()
  process.exit(1)
}
ok('a senha temporária cai na tela de troca obrigatória')

await page.fill('label:has-text("Senha que você usou agora") input', senhaAtual)
await page.fill('label:has-text("Nova senha") input', senhaNova)
await page.fill('label:has-text("Repita a nova senha") input', senhaNova)
await page.locator('button[type="submit"]').click()
await espera(5000)

const depois = await page.locator('body').innerText()
if (/Defina sua senha definitiva/i.test(depois)) {
  const erro = depois.split('\n').filter((l) => /senha|erro|falh/i.test(l)).slice(0, 2).join(' | ')
  falhou(`a troca não concluiu${erro ? ` (${erro})` : ''}`)
} else {
  ok('senha definida e sistema liberado')
}

const saiu = await sair()
if (saiu) {
  // A tela de login cita "Mesas" na apresentação: a prova é o endereço.
  await entrar(senhaAtual)
  if (page.url().includes('/login')) ok('a senha temporária deixou de funcionar (login recusado)')
  else falhou(`a senha temporária continuou valendo (foi para ${page.url()})`)

  await entrar(senhaNova)
  if (!page.url().includes('/login')) {
    ok(`a senha definitiva entra direto (${new URL(page.url()).pathname}), sem pedir troca de novo`)
  } else {
    falhou('a senha definitiva não entrou no sistema')
  }
}

await navegador.close()
console.log(`\n=== Resultado: ${falhas.length} falha(s) ===`)
process.exit(falhas.length === 0 ? 0 : 1)
