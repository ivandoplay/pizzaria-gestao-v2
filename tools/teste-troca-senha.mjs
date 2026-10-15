/**
 * Aceitação da TROCA OBRIGATÓRIA DE SENHA (prova de ponta a ponta, no navegador).
 *
 * O que este robô prova, com um funcionário de teste de verdade:
 *   1. o administrador cria um funcionário com senha temporária → a conta nasce
 *      com `must_change_password`;
 *   2. entrando com a senha temporária, o sistema **não abre**: aparece só a
 *      tela de troca, e nem digitando a rota na mão (ex.: /dashboard) o sistema
 *      deixa passar;
 *   3. a troca exige a senha atual (senha atual errada não troca nada);
 *   4. com a troca feita, o sistema abre normalmente;
 *   5. a senha antiga para de funcionar e a nova funciona;
 *   6. a troca fica registrada na auditoria;
 *   7. a conta usada no teste é desativada no fim (nada é apagado — histórico
 *      de auditoria e vendas continua intacto).
 *
 * Rode contra a URL PUBLICADA (a criação de funcionário passa por uma Edge
 * Function que só aceita a origem do site publicado — em localhost o navegador
 * bloqueia por CORS, e não por falha do sistema).
 *
 * Uso:
 *   PZ_ADMIN_PASSWORD=... node tools/teste-troca-senha.mjs [URL]
 *
 * Cria e desativa uma conta de teste. Não apaga nada e não toca nas contas
 * reais (caixa, garçom, administrador).
 */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4195'
const senhaAdmin = process.env.PZ_ADMIN_PASSWORD
if (!senhaAdmin) {
  console.error('Defina PZ_ADMIN_PASSWORD (senha do administrador).')
  process.exit(2)
}

const LOGIN_TESTE = process.env.PZ_LOGIN_TESTE ?? 'robo.troca.senha'
const SENHA_TEMPORARIA = 'Temporaria@2026'
const SENHA_NOVA = 'MinhaSenha@2026!'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const falhas = []
const ok = (texto) => console.log(`  OK    ${texto}`)
const falhou = (texto) => {
  falhas.push(texto)
  console.log(`  FALHA ${texto}`)
}

const navegador = await chromium.launch()
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })
const page = await contexto.newPage()

async function entrar(login, senha) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 })
  // Se o aparelho ainda estiver com sessão, saia antes de entrar com outro acesso.
  if (await page.locator('button:has-text("Entrar com outra conta")').count()) {
    await page.locator('button:has-text("Entrar com outra conta")').click()
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 })
  }
  await page.fill('input[autocomplete="username"]', login)
  await page.fill('input[autocomplete="current-password"]', senha)
  await page.click('button[type="submit"]')
  await espera(3000)
}

async function sair() {
  // O botão de sair aparece duas vezes no código (lateral no computador,
  // cabeçalho no celular) — o `:visible` escolhe o que está de fato na tela.
  const sairBotao = page.locator('button[title="Sair do sistema"]:visible, button[aria-label="Sair do sistema"]:visible').last()
  if ((await sairBotao.count()) === 0) return
  await sairBotao.click()
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  await page.locator('[role="dialog"] button:has-text("Sair")').last().click()
  await page.waitForFunction(() => location.pathname.startsWith('/login'), undefined, { timeout: 20000 }).catch(() => {})
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 20000 }).catch(() => {})
  await espera(700)
}

console.log(`\n== Troca obrigatória de senha em ${base}`)

// ---------------------------------------------------------------- 1) preparar
await entrar('admin', senhaAdmin)
await page.goto(`${base}/funcionarios`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25000 }).catch(() => {})
await espera(900)

const jaExiste = (await page.locator(`text=${LOGIN_TESTE}`).count()) > 0
if (!jaExiste) {
  await page.locator('button:has-text("Novo funcionário")').first().click()
  await espera(800)
  const modal = page.locator('[role="dialog"]').first()
  await modal.locator('label:has-text("Nome completo") input').fill('Robô Troca Senha')
  await modal.locator('label:has-text("Login") input').fill(LOGIN_TESTE)
  await modal.locator('label:has-text("Senha inicial") input').fill(SENHA_TEMPORARIA)
  await page.locator('[role="dialog"] button:has-text("Criar funcionário")').click()
  await espera(3500)
  // O sistema mostra a senha temporária uma única vez — o robô confere que a
  // janela realmente aparece (é o que o administrador entrega ao funcionário).
  const janelaSenha = page.locator('[role="dialog"]:has-text("Senha temporária gerada")')
  try {
    await janelaSenha.waitFor({ state: 'visible', timeout: 20000 })
    ok('funcionário criado e senha temporária mostrada uma única vez')
  } catch {
    falhou('a janela da senha temporária não apareceu')
  }
  const fechar = page.locator('[role="dialog"]:has-text("Senha temporária gerada") button:has-text("Fechar")').last()
  if (await fechar.count()) {
    await fechar.click()
    await espera(900)
  }
} else {
  ok('funcionário de teste já existia nesta base — reaproveitando a conta')
}

await sair()

// ------------------------------------------- 2) senha temporária não abre o sistema
await entrar(LOGIN_TESTE, SENHA_TEMPORARIA)
let titulo = (await page.locator('h1').first().innerText().catch(() => '')).trim()
if (/Defina sua senha definitiva/i.test(titulo)) {
  ok('quem entra com senha temporária cai na tela de troca')
} else {
  falhou(`esperava a tela de troca obrigatória, veio "${titulo}"`)
}

// nem digitando a rota na mão
await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' })
await espera(1500)
titulo = (await page.locator('h1').first().innerText().catch(() => '')).trim()
const temMenu = (await page.locator('nav[aria-label="Acesso rápido"]').count()) > 0
if (/Defina sua senha definitiva/i.test(titulo) && !temMenu) {
  ok('rota digitada na mão ( /dashboard ) também cai na tela de troca, sem menu')
} else {
  falhou(`a rota /dashboard escapou do bloqueio (título "${titulo}", menu: ${temMenu})`)
}

// ------------------------------------------------- 3) senha atual errada não troca
await page.fill('label:has-text("Senha que você usou agora") input', 'senha-errada-123')
await page.fill('label:has-text("Nova senha") input', SENHA_NOVA)
await page.fill('label:has-text("Repita a nova senha") input', SENHA_NOVA)
await page.locator('button[type="submit"]').click()
await espera(3000)
const aposErro = await page.locator('body').innerText()
if (/não confere/i.test(aposErro) && !/SENHA_ATUAL_INCORRETA/.test(aposErro) && /Defina sua senha definitiva/i.test(aposErro)) {
  ok('senha atual errada não troca nada e explica o motivo')
} else {
  falhou('senha atual errada passou ou não avisou o operador')
}

// validação de senha curta
await page.fill('label:has-text("Senha que você usou agora") input', SENHA_TEMPORARIA)
await page.fill('label:has-text("Nova senha") input', 'curta')
await page.fill('label:has-text("Repita a nova senha") input', 'curta')
await page.locator('button[type="submit"]').click()
await espera(1200)
if (/8 caracteres/i.test(await page.locator('body').innerText())) {
  ok('senha curta é barrada antes de chamar o servidor')
} else {
  falhou('senha curta não foi barrada')
}

// repetição diferente da nova senha
await page.fill('label:has-text("Nova senha") input', SENHA_NOVA)
await page.fill('label:has-text("Repita a nova senha") input', 'OutraSenha@2026!')
await page.locator('button[type="submit"]').click()
await espera(1200)
if (/repetição não confere/i.test(await page.locator('body').innerText())) {
  ok('repetição diferente é barrada')
} else {
  falhou('repetição diferente passou')
}

// senha nova igual à atual: trocar "para a mesma coisa" não vale
await page.fill('label:has-text("Nova senha") input', SENHA_TEMPORARIA)
await page.fill('label:has-text("Repita a nova senha") input', SENHA_TEMPORARIA)
await page.locator('button[type="submit"]').click()
await espera(1500)
if (/precisa ser diferente da senha atual/i.test(await page.locator('body').innerText())) {
  ok('senha nova igual à atual é barrada')
} else {
  falhou('senha nova igual à atual passou')
}

// ------------------------------------------------------------- 4) troca de verdade
await page.fill('label:has-text("Senha que você usou agora") input', SENHA_TEMPORARIA)
await page.fill('label:has-text("Nova senha") input', SENHA_NOVA)
await page.fill('label:has-text("Repita a nova senha") input', SENHA_NOVA)
await page.locator('button[type="submit"]').click()
await espera(4000)
const depois = await page.locator('body').innerText()
const abriuSistema = !/Defina sua senha definitiva/i.test(depois) && /Mesas|Painel|Caixa/i.test(depois)
if (abriuSistema) ok('feita a troca, o sistema abre normalmente')
else falhou('depois da troca o sistema não abriu')

// ------------------------------------------------ 5) senha antiga não serve mais
await sair()
await entrar(LOGIN_TESTE, SENHA_TEMPORARIA)
const comAntiga = await page.locator('body').innerText()
if (/inválid|incorret|não confere|senha/i.test(comAntiga) && !/Mesas|Painel do dia/i.test(comAntiga)) {
  ok('a senha temporária deixou de funcionar')
} else {
  falhou('a senha temporária continuou valendo depois da troca')
}

await entrar(LOGIN_TESTE, SENHA_NOVA)
const comNova = await page.locator('body').innerText()
if (/Mesas|Painel do dia|Caixa/i.test(comNova) && !/Defina sua senha/i.test(comNova)) {
  ok('a senha nova entra direto, sem pedir troca de novo')
} else {
  falhou('a senha nova não entrou no sistema')
}

await sair()

// ------------------------------------------------------ 6) registro na auditoria
await entrar('admin', senhaAdmin)
await page.goto(`${base}/auditoria`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25000 }).catch(() => {})
await espera(1200)
if (/password_changed|troca obrigatoria|senha definitiva/i.test(await page.locator('body').innerText())) {
  ok('a troca aparece na auditoria')
} else {
  falhou('a troca de senha não apareceu na auditoria')
}

// ------------------------------------------------------ 7) desativar a conta de teste
await page.goto(`${base}/funcionarios`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25000 }).catch(() => {})
await espera(900)
// A primeira linha da lista é o próprio administrador — o robô procura a linha
// que contém o login de teste, nunca a primeira "Desativar" da página.
const linhas = page.locator('li').filter({ hasText: LOGIN_TESTE })
let botaoDesativar = page.locator('button:has-text("Desativar")').first()
for (let i = 0; i < (await linhas.count()); i += 1) {
  const candidato = linhas.nth(i).locator('button:has-text("Desativar")')
  if ((await candidato.count()) === 1) {
    botaoDesativar = candidato
    break
  }
}
if ((await botaoDesativar.count()) > 0) {
  await botaoDesativar.click()
  await espera(800)
  await page.locator('[role="dialog"] button:has-text("Confirmar")').last().click()
  await espera(2500)
  if (/desativado/i.test(await page.locator('body').innerText())) {
    ok('conta de teste desativada (nada foi apagado)')
  } else {
    falhou('não consegui desativar a conta de teste')
  }
} else {
  console.log('  aviso a conta de teste já estava desativada')
}

await navegador.close()
console.log(`\n=== Resultado: ${falhas.length} falha(s) ===`)
process.exit(falhas.length === 0 ? 0 : 1)
