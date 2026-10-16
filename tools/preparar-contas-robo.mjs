/**
 * Deixa uma conta de robô pronta para uso, pelo caminho que o sistema oferece
 * de verdade — nada é escrito direto na tabela de usuários.
 *
 * O que ele faz, para cada conta informada:
 *   1. entra como administrador e garante que a conta está ATIVA (reativa se preciso);
 *   2. usa o botão "Senha" da tela de funcionários para gerar uma senha temporária;
 *   3. entra na conta com a senha temporária, cai na tela de troca obrigatória,
 *      define a senha definitiva e confirma que o sistema abre;
 *   4. sai e entra de novo com a senha definitiva — se entrar direto, a conta está pronta.
 *
 * Serve para deixar as contas usadas pelos outros robôs (`robo.caixa`,
 * `robo.garcom`) em estado conhecido, sem tocar nas contas reais de trabalho
 * (`admin`, `caixa`, `garcom`).
 *
 * Uso:
 *   PZ_ADMIN_LOGIN=admin PZ_ADMIN_PASSWORD=... \
 *     node tools/preparar-contas-robo.mjs <URL> robo.caixa='SenhaDefinitiva@2026!' [robo.garcom='...']
 *
 * A senha definitiva não fica guardada em nenhum arquivo do projeto.
 */
import { chromium } from 'playwright'

const base = process.argv[2]
const pares = process.argv.slice(3)
const loginAdmin = process.env.PZ_ADMIN_LOGIN ?? 'admin'
const senhaAdmin = process.env.PZ_ADMIN_PASSWORD

if (!base || pares.length === 0) {
  console.error("Uso: node tools/preparar-contas-robo.mjs <URL> login='SenhaDefinitiva' [login='...']")
  process.exit(2)
}
if (!senhaAdmin) {
  console.error('Defina PZ_ADMIN_PASSWORD (senha do administrador).')
  process.exit(2)
}

const contas = pares.map((par) => {
  const corte = par.indexOf('=')
  if (corte < 1) {
    console.error(`Informe a conta como login=senha (recebi "${par}").`)
    process.exit(2)
  }
  return { login: par.slice(0, corte), senha: par.slice(corte + 1) }
})

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
  if (await page.locator('button:has-text("Entrar com outra conta")').count()) {
    await page.locator('button:has-text("Entrar com outra conta")').click()
  }
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 })
  await page.fill('input[autocomplete="username"]', login)
  await page.fill('input[autocomplete="current-password"]', senha)
  await page.click('button[type="submit"]')
  await page
    .waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 30_000 })
    .catch(() => {})
  await espera(2200)
}

async function sair() {
  const botao = page.locator('button[title="Sair do sistema"]:visible, button[aria-label="Sair do sistema"]:visible').last()
  if (await botao.count()) {
    await botao.click()
    await page.locator('[role="dialog"] button:has-text("Sair")').last().click()
    await espera(1500)
  }
}

async function irParaFuncionarios() {
  await page.goto(`${base}/funcionarios`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
  await espera(900)
}

/** A linha da lista que contém o login (a primeira linha é o próprio administrador). */
function linhaDe(login) {
  return page.locator('li').filter({ hasText: login }).first()
}

for (const conta of contas) {
  console.log(`\n== Conta ${conta.login}`)
  await entrar(loginAdmin, senhaAdmin)

  // 1) ativa, se estiver desativada
  await irParaFuncionarios()
  let linha = linhaDe(conta.login)
  if ((await linha.count()) === 0) {
    falhou(`${conta.login} não está cadastrada — crie a conta na tela de funcionários antes`)
    continue
  }
  // Cuidado: `has-text` casa por trecho, e "Desativar" contém "Ativar" — no dia
  // 16/10/2026 isto desativou a conta de robô em vez de ativá-la. Sempre exato.
  const botaoAtivar = linha.getByRole('button', { name: 'Ativar', exact: true })
  if (await botaoAtivar.count()) {
    await botaoAtivar.click()
    await page.locator('[role="dialog"] button:has-text("Confirmar")').last().click()
    await espera(1500)
    await irParaFuncionarios()
    linha = linhaDe(conta.login)
    ok('conta reativada')
  }

  // 2) senha temporária pelo caminho do sistema
  await linha.getByRole('button', { name: 'Senha', exact: true }).first().click()
  await page.locator('[role="dialog"] button:has-text("Gerar senha temporária")').last().click()
  const janela = page.locator('[role="dialog"]:has-text("Senha temporária gerada")')
  await janela.first().waitFor({ timeout: 20_000 })
  const temporaria = (await janela.locator('p.num').first().innerText()).trim()
  if (temporaria.length < 8) falhou('a tela não mostrou a senha temporária')
  await page.locator('[role="dialog"]:has-text("Senha temporária gerada") button:has-text("Fechar")').last().click()
  await espera(800)
  ok(`senha temporária gerada (${temporaria.length} caracteres — não é guardada)`)

  // 3) primeiro acesso: a troca obrigatória tem que aparecer e ser concluída
  await sair()
  await entrar(conta.login, temporaria)
  // Atenção: a tela de troca obrigatória é renderizada NA MESMA URL (o guard troca
  // o conteúdo, não o endereço) — quem diz se ela apareceu é a própria tela.
  const naTelaDeTroca = (await page.locator('label:has-text("Senha que você usou agora")').count()) > 0
  const corpo = await page.locator('body').innerText()
  if (naTelaDeTroca) {
    ok('a conta caiu na troca obrigatória, como deve')
  } else if (/desativad|bloquead|sem permiss/i.test(corpo)) {
    falhou(`${conta.login} está bloqueada no sistema — reative a conta e rode de novo`)
  } else {
    falhou(`${conta.login} não passou pela troca obrigatória (parou em ${new URL(page.url()).pathname})`)
  }
  await page.fill('label:has-text("Senha que você usou agora") input', temporaria)
  await page.fill('label:has-text("Nova senha") input', conta.senha)
  await page.fill('label:has-text("Repita a nova senha") input', conta.senha)
  await page.locator('button[type="submit"]').click()
  await espera(4000)
  const depois = await page.locator('body').innerText()
  if (/Defina sua senha definitiva/i.test(depois)) falhou('a tela de troca continuou depois de enviar a senha nova')
  else ok('senha definitiva definida e o sistema abriu')

  // 4) a senha definitiva entra direto, sem pedir troca de novo
  await sair()
  await entrar(conta.login, conta.senha)
  const caminho = new URL(page.url()).pathname
  if (caminho.includes('/login') || caminho.includes('/trocar-senha')) {
    falhou(`a senha definitiva não entrou direto (parou em ${caminho})`)
  } else {
    ok(`pronta para os robôs: entra com a senha definitiva e para em ${caminho}`)
  }
  await sair()
}

await navegador.close()

console.log(
  falhas.length === 0
    ? '\nRESULTADO: contas prontas — senhas definitivas definidas pelo fluxo real do sistema.'
    : `\nRESULTADO: ${falhas.length} falha(s).`,
)
process.exit(falhas.length === 0 ? 0 : 1)
