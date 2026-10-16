/**
 * Deixa uma conta de apoio (robô) pronta para uso, pelo caminho que o sistema
 * oferece de verdade — nada é escrito direto na tabela de usuários.
 *
 * Para cada conta informada, na ordem:
 *   1. entra como administrador;
 *   2. se a conta ainda não existir, cria pela tela de funcionários (com senha
 *      inicial escolhida aqui, que nasce com troca obrigatória pendente);
 *   3. se já existir e estiver desativada, reativa;
 *   4. se já existir, gera uma senha temporária pelo botão "Senha";
 *   5. entra com a senha temporária, confirma que a tela de TROCA OBRIGATÓRIA
 *      aparece, define a senha definitiva e confirma que o sistema abre;
 *   6. sai e entra de novo com a senha definitiva — se entrar direto, está pronta.
 *
 * Uso:
 *   PZ_ADMIN_LOGIN=admin PZ_ADMIN_PASSWORD=... \
 *     node tools/preparar-contas-robo.mjs <URL> "robo.caixa=SenhaDefinitiva@2026!:#manager" "robo.garcom=...#waiter"
 *
 * Formato de cada conta: `login=SenhaDefinitiva` (papel opcional depois de `:#`,
 * um de `admin`, `manager`, `waiter`; o padrão é `waiter`). As senhas não ficam
 * guardadas em nenhum arquivo do projeto.
 */
import { chromium } from 'playwright'

const base = process.argv[2]
const pares = process.argv.slice(3)
const loginAdmin = process.env.PZ_ADMIN_LOGIN ?? 'admin'
const senhaAdmin = process.env.PZ_ADMIN_PASSWORD

if (!base || pares.length === 0) {
  console.error('Uso: node tools/preparar-contas-robo.mjs <URL> "login=SenhaDefinitiva[#papel]" […]')
  process.exit(2)
}
if (!senhaAdmin) {
  console.error('Defina PZ_ADMIN_PASSWORD (senha do administrador).')
  process.exit(2)
}

const SENHA_INICIAL = 'Temporaria@2026'
const PAPEIS = ['admin', 'manager', 'waiter']

const contas = pares.map((par) => {
  const corte = par.indexOf('=')
  if (corte < 1) {
    console.error(`Informe a conta como login=senha (recebi "${par}").`)
    process.exit(2)
  }
  const login = par.slice(0, corte)
  const resto = par.slice(corte + 1)
  const [senha, papel = 'waiter'] = resto.split(':#')
  if (!PAPEIS.includes(papel)) {
    console.error(`Papel "${papel}" não existe (use ${PAPEIS.join(', ')}).`)
    process.exit(2)
  }
  return { login, senha, papel, nome: `Robô ${login.split('.').slice(-1)[0]}` }
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
    await espera(1600)
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
  console.log(`\n== Conta ${conta.login} (${conta.papel})`)
  await entrar(loginAdmin, senhaAdmin)
  await irParaFuncionarios()

  let linha = linhaDe(conta.login)
  let temporaria = SENHA_INICIAL
  let criadaAgora = false

  // 1) cria a conta, se ainda não existir
  if ((await linha.count()) === 0) {
    await page.locator('button:has-text("Novo funcionário")').first().click()
    const modal = page.locator('[role="dialog"]').first()
    await modal.first().waitFor({ timeout: 20_000 })
    await modal.locator('label:has-text("Nome completo") input').fill(conta.nome)
    await modal.locator('label:has-text("Login") input').fill(conta.login)
    await modal.locator('label:has-text("Função") select').selectOption(conta.papel)
    await modal.locator('label:has-text("Senha inicial") input').fill(SENHA_INICIAL)
    await page.locator('[role="dialog"] button:has-text("Criar funcionário")').click()
    await espera(5000)
    await irParaFuncionarios()
    linha = linhaDe(conta.login)
    if ((await linha.count()) === 0) {
      falhou(`${conta.login} não foi criada (veja a mensagem da tela de funcionários)`)
      continue
    }
    criadaAgora = true
    ok(`conta criada com senha inicial e troca obrigatória pendente`)
  }

  // 2) reativa, se estiver desativada — texto EXATO: "Desativar" contém "Ativar"
  if (await linha.getByRole('button', { name: 'Ativar', exact: true }).count()) {
    await linha.getByRole('button', { name: 'Ativar', exact: true }).click()
    await page.locator('[role="dialog"] button:has-text("Confirmar")').last().click()
    await espera(1500)
    await irParaFuncionarios()
    linha = linhaDe(conta.login)
    ok('conta reativada')
  }

  // 3) senha temporária pelo caminho do sistema (conta que já existia)
  if (!criadaAgora) {
    await linha.getByRole('button', { name: 'Senha', exact: true }).first().click()
    await page.locator('[role="dialog"] button:has-text("Gerar senha temporária")').last().click()
    const janela = page.locator('[role="dialog"]:has-text("Senha temporária gerada")')
    await janela.first().waitFor({ timeout: 20_000 })
    temporaria = (await janela.locator('p.num').first().innerText()).trim()
    if (temporaria.length < 8) falhou('a tela não mostrou a senha temporária')
    await page.locator('[role="dialog"]:has-text("Senha temporária gerada") button:has-text("Fechar")').last().click()
    await espera(800)
    ok(`senha temporária gerada (${temporaria.length} caracteres — não é guardada)`)
  }

  // 4) primeiro acesso: a troca obrigatória tem que aparecer e ser concluída
  //    Atenção: a tela de troca é renderizada NA MESMA URL (o guard troca o
  //    conteúdo, não o endereço) — quem diz se ela apareceu é a própria tela.
  await sair()
  await entrar(conta.login, temporaria)
  const naTelaDeTroca = (await page.locator('label:has-text("Senha que você usou agora")').count()) > 0
  const corpo = await page.locator('body').innerText()
  if (naTelaDeTroca) {
    ok('a conta caiu na troca obrigatória, como deve')
  } else if (/desativad|bloquead|sem permiss/i.test(corpo)) {
    falhou(`${conta.login} está bloqueada no sistema — reative a conta e rode de novo`)
    continue
  } else {
    falhou(`${conta.login} não passou pela troca obrigatória (parou em ${new URL(page.url()).pathname})`)
  }

  await page.fill('label:has-text("Senha que você usou agora") input', temporaria)
  await page.fill('label:has-text("Nova senha") input', conta.senha)
  await page.fill('label:has-text("Repita a nova senha") input', conta.senha)
  await page.locator('button[type="submit"]').click()
  await espera(4000)
  if (/Defina sua senha definitiva/i.test(await page.locator('body').innerText())) {
    falhou('a tela de troca continuou depois de enviar a senha nova')
  } else {
    ok('senha definitiva definida e o sistema abriu')
  }

  // 5) a senha definitiva entra direto, sem pedir troca de novo
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
