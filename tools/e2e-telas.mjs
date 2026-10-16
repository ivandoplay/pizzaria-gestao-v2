#!/usr/bin/env node
/**
 * =============================================================================
 * Conferência de INTERFACE contra um endereço publicado (ou local).
 *
 * Para cada perfil (administrador, caixa e garçom) o script entra de verdade no
 * sistema, percorre as telas que aquele perfil tem direito e verifica:
 *   · a tela termina de carregar (sem erro na tela e sem esqueleto preso);
 *   · o título esperado aparece;
 *   · nenhum erro de JavaScript no console e nenhuma requisição falhando;
 *   · o perfil sem permissão é barrado na tela administrativa.
 * Ao final grava uma captura de cada tela em `artifacts/e2e/` para conferência
 * visual e imprime um resumo (o código de saída é 1 se algo falhar).
 *
 * NÃO altera dado nenhum do sistema: só lê as telas e faz login/logout.
 *
 * Como rodar (o Playwright não é dependência do projeto):
 *   npm i --no-save playwright && npx playwright install chromium
 *   PZ_ADMIN_PASSWORD='...' PZ_CAIXA_PASSWORD='...' PZ_GARCOM_PASSWORD='...' \
 *     node tools/e2e-telas.mjs https://pizzaria-gestao-v2.vercel.app
 *
 * As senhas NUNCA ficam no arquivo — vêm do ambiente.
 * =============================================================================
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BASE = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '')
const SAIDA = path.resolve('artifacts/e2e')

const PERFIS = [
  {
    nome: 'administrador',
    login: process.env.PZ_ADMIN_LOGIN ?? 'admin',
    senha: process.env.PZ_ADMIN_PASSWORD,
    destino: '/dashboard',
    telas: [
      ['painel', '/dashboard', 'Painel'],
      ['mesas', '/mesas', 'Mesas'],
      ['prontos', '/pedidos-prontos', 'Pedidos prontos'],
      ['caixa', '/caixa', 'Caixa'],
      ['delivery', '/delivery', 'Delivery'],
      ['cardapio', '/cardapio', 'Cardápio'],
      ['funcionarios', '/funcionarios', 'Funcionários'],
      ['relatorios', '/relatorios', 'Relatórios'],
      ['historico', '/historico', 'Histórico'],
      ['caixa-controle', '/caixa-controle', 'Caixa'],
      ['auditoria', '/auditoria', 'Auditoria'],
      ['configuracoes', '/configuracoes', 'Configura'],
    ],
    proibidas: [],
  },
  {
    nome: 'caixa',
    login: process.env.PZ_CAIXA_LOGIN ?? 'caixa',
    senha: process.env.PZ_CAIXA_PASSWORD,
    destino: '/caixa',
    telas: [
      ['caixa', '/caixa', 'Caixa'],
      ['mesas', '/mesas', 'Mesas'],
      ['prontos', '/pedidos-prontos', 'Pedidos prontos'],
      ['delivery', '/delivery', 'Delivery'],
      ['historico', '/historico', 'Histórico'],
      ['caixa-controle', '/caixa-controle', 'Caixa'],
    ],
    proibidas: [['/relatorios', 'Relatórios'], ['/cardapio', 'Cardápio'], ['/funcionarios', 'Funcionários']],
  },
  {
    nome: 'garcom',
    login: process.env.PZ_GARCOM_LOGIN ?? 'garcom',
    senha: process.env.PZ_GARCOM_PASSWORD,
    destino: '/mesas',
    telas: [
      ['mesas', '/mesas', 'Mesas'],
      ['prontos', '/pedidos-prontos', 'Pedidos prontos'],
    ],
    proibidas: [['/relatorios', 'Relatórios'], ['/caixa', 'Caixa'], ['/cardapio', 'Cardápio']],
  },
]

const falhas = []
const avisos = []
const registrar = (tipo, perfil, tela, texto) => {
  const linha = `[${perfil}/${tela}] ${texto}`
  if (tipo === 'falha') {
    falhas.push(linha)
    console.log(`  FALHA ${linha}`)
  } else {
    avisos.push(linha)
    console.log(`  aviso ${linha}`)
  }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

async function entrar(page, perfil) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 })
  await page.fill('input[autocomplete="username"]', perfil.login)
  await page.fill('input[autocomplete="current-password"]', perfil.senha)
  await page.click('button[type="submit"]')
  await page.waitForFunction(
    () => !location.pathname.startsWith('/login'),
    undefined,
    { timeout: 30_000 },
  ).catch(() => {})
  await espera(2500)
  if (new URL(page.url()).pathname.startsWith('/login')) {
    const erro = await page.locator('.text-red-900, [role="alert"]').first().innerText().catch(() => '')
    throw new Error(`login de ${perfil.login} não passou da tela de entrada ${erro ? `(${erro.trim()})` : ''}`)
  }
}

async function conferirTela(page, perfil, [id, rota, tituloEsperado], errosDeConsole) {
  errosDeConsole.length = 0
  await page.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded' })

  // Espera a tela TERMINAR de carregar em vez de dormir um tempo fixo: assim o
  // teste mede o aplicativo, não a pressa (ou o soluço) da máquina de teste.
  await page.waitForSelector('h1', { timeout: 20_000 }).catch(() => {})
  const semEsqueleto = await page
    .waitForFunction(() => document.querySelectorAll('.esqueleto').length === 0, undefined, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  await espera(600) // deixa a animação de entrada terminar antes da captura

  const caminho = new URL(page.url()).pathname
  if (caminho !== rota) registrar('falha', perfil.nome, id, `foi parar em ${caminho} em vez de ${rota}`)

  const corpo = await page.locator('body').innerText().catch(() => '')
  if (/Something went wrong|Algo deu errado|Não foi possível carregar/i.test(corpo)) {
    registrar('falha', perfil.nome, id, 'a tela mostrou um bloco de erro')
  }
  if (!semEsqueleto) {
    registrar('falha', perfil.nome, id, 'ficou mais de 20 s no esqueleto de carregamento')
  }
  const titulo = await page.locator('h1').first().innerText().catch(() => '')
  if (!titulo) registrar('falha', perfil.nome, id, 'sem título (h1) na tela')
  else if (!titulo.toLowerCase().includes(tituloEsperado.toLowerCase())) {
    registrar('aviso', perfil.nome, id, `título "${titulo}" (esperava conter "${tituloEsperado}")`)
  }

  const falhasRede = await page.evaluate(() => window.__falhasDeRede ?? [])
  for (const f of falhasRede) registrar('falha', perfil.nome, id, `requisição falhou: ${f}`)
  for (const erro of errosDeConsole) registrar('falha', perfil.nome, id, `erro no console: ${erro}`)

  const arquivo = path.join(SAIDA, perfil.nome, `${id}.png`)
  await page.screenshot({ path: arquivo, fullPage: true })
  console.log(`  OK    ${perfil.nome}/${id} → ${titulo || '(sem título)'}`)
}

async function conferirBloqueio(page, perfil, [rota, titulo]) {
  await page.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('.esqueleto').length === 0, undefined, { timeout: 20_000 }).catch(() => {})
  await espera(400)
  const corpo = await page.locator('body').innerText().catch(() => '')
  const tituloNaTela = await page.locator('h1').first().innerText().catch(() => '')
  if (tituloNaTela === titulo) {
    registrar('falha', perfil.nome, `bloqueio${rota}`, `o perfil entrou em ${titulo}, que deveria ser restrito`)
  } else {
    console.log(`  OK    ${perfil.nome} barrado em ${rota} (${corpo.split('\n')[0]?.slice(0, 60) ?? ''})`)
  }
}

/**
 * Percurso funcional do salão: abre os mesmos diálogos que o garçom usa no
 * atendimento (abrir mesa, montar pedido, conferir a conta) e fecha tudo
 * SEM confirmar. Nenhuma escrita é enviada ao banco — serve para provar que a
 * interface continua funcional depois da revisão visual.
 */
async function percursoDoSalao(page, perfil, errosDeConsole) {
  const problemas = []
  const anotar = (texto) => { problemas.push(texto); registrar('falha', perfil.nome, 'percurso', texto) }

  await page.goto(`${BASE}/mesas`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1', { timeout: 20_000 }).catch(() => {})
  await page.waitForFunction(() => document.querySelectorAll('.esqueleto').length === 0, undefined, { timeout: 20_000 }).catch(() => {})
  await espera(600)

  // 1) Diálogo de abrir mesa (o botão só abre; nada é confirmado)
  const ocupada = page.locator('article, li, div').filter({ hasText: /^Mesa \d+/ }).first()
  await page.locator('button:has-text("Iniciar atendimento")').first().click({ timeout: 8000 }).catch(() => {})
  await espera(900)
  const dialogo = page.locator('[role="dialog"]').first()
  if (await dialogo.count() === 0) anotar('o diálogo de abrir mesa não apareceu')
  else {
    const texto = await dialogo.innerText()
    if (!/pessoas|Quantidade/i.test(texto)) anotar('o diálogo de abrir mesa não pede a quantidade de pessoas')
    await page.keyboard.press('Escape')
    await espera(400)
  }
  void ocupada

  // 2) Mesa ocupada → conta do atendimento → compositor de pedido
  const mesa1 = page.locator('text=Mesa 1').first()
  if (await mesa1.count() === 0) {
    console.log('  aviso percurso: nenhuma mesa ocupada no momento — pulando compositor')
    return
  }
  await mesa1.click()
  await espera(2600)
  await page.waitForFunction(() => document.querySelectorAll('.esqueleto').length === 0, undefined, { timeout: 20_000 }).catch(() => {})
  if (!/atendimento|Mesa 1/i.test(await page.locator('body').innerText())) anotar('a tela do atendimento não abriu')

  await page.locator('button:has-text("Adicionar"), button:has-text("Novo pedido"), button:has-text("Lançar pedido")').first().click({ timeout: 8000 }).catch(() => {})
  await espera(1600)
  const compositor = page.locator('[role="dialog"]').first()
  if (await compositor.count() === 0) anotar('o compositor de pedido não abriu')
  else {
    const texto = await compositor.innerText()
    if (!/Cardápio|Buscar|sacola|Pedido/i.test(texto)) anotar('o compositor abriu sem os elementos esperados')
    await page.keyboard.press('Escape')
    await espera(500)
  }

  // 3) Fechar/receber a conta: só abre o painel de pagamento para conferir os nomes das formas
  const botaoConta = page.locator('button:has-text("Fechar conta"), button:has-text("Receber"), button:has-text("Conta")').first()
  if (await botaoConta.count() > 0) {
    await botaoConta.click().catch(() => {})
    await espera(1600)
    const painel = page.locator('[role="dialog"]').first()
    if (await painel.count() > 0) {
      const texto = await painel.innerText()
      if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(texto)) anotar('o painel de pagamento mostrou um identificador cru (UUID) em vez do nome da forma')
      if (!/Dinheiro|Pix|Cart/i.test(texto)) anotar('o painel de pagamento não listou as formas de pagamento')
      await page.keyboard.press('Escape')
    }
  }

  for (const erro of errosDeConsole) anotar(`erro no console durante o percurso: ${erro}`)
  if (problemas.length === 0) console.log('  OK    percurso funcional do salão (abrir mesa, montar pedido, conferir conta)')
}

/**
 * Teclado do computador: `Enter` dentro de um campo confirma a ação principal
 * da janela — e NUNCA confirma uma ação destrutiva (fechar conta, cancelar,
 * desativar, estornar). A prova usa só caminhos de validação: nada é gravado.
 */
async function conferirEnterConfirma(page, anotar) {
  const problemas = []
  await page.goto(`${BASE}/funcionarios`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('.esqueleto').length === 0, undefined, { timeout: 25_000 }).catch(() => {})
  await espera(900)

  // 1) Enter no formulário de novo funcionário: dispara o botão principal.
  await page.locator('button:has-text("Novo funcionário")').first().click()
  await espera(700)
  const dialogo = page.locator('[role="dialog"]').first()
  if ((await dialogo.count()) === 0) {
    problemas.push('a janela de novo funcionário não abriu')
  } else {
    await dialogo.locator('input').first().fill('Robo de Teste')
    await page.keyboard.press('Enter')
    await espera(600)
    const corpo = await page.locator('body').innerText()
    if (!/login deve ter/i.test(corpo)) {
      problemas.push('Enter no formulário não acionou o botão principal (nenhuma mensagem de validação apareceu)')
    }
    if (/Robo de Teste/.test(await page.locator('main').innerText())) {
      problemas.push('o rascunho do formulário foi gravado sem validação')
    }
    await page.keyboard.press('Escape')
    await espera(500)
  }

  // 2) Confirmação destrutiva: Enter NÃO pode confirmar.
  // O primeiro "Desativar" é o do próprio admin (bloqueado de propósito para
  // não se desativar); o teste usa o primeiro que está habilitado.
  const desativar = page.locator('button:has-text("Desativar"):enabled').first()
  if ((await desativar.count()) > 0) {
    await desativar.click()
    await espera(700)
    const perigo = page.locator('[role="dialog"]').first()
    if ((await perigo.count()) > 0) {
      await page.keyboard.press('Enter')
      await espera(900)
      const depois = await page.locator('main').innerText()
      if (/Acesso de .* desativado|Acesso de .* liberado/i.test(depois)) {
        problemas.push('Enter confirmou uma ação destrutiva (desativar/ativar acesso) — deveria apenas cancelar')
      }
      if ((await page.locator('[role="dialog"]').count()) > 0) await page.keyboard.press('Escape')
      await espera(400)
    } else {
      problemas.push('o diálogo de desativar funcionário não abriu')
    }
  }

  for (const problema of problemas) anotar(`Enter confirma: ${problema}`)
  if (problemas.length === 0) console.log('  OK    Enter confirma o cadastro e não confirma ação destrutiva')
}

async function rodar() {
  await mkdir(SAIDA, { recursive: true })
  const navegador = await chromium.launch()

  // PERFIL=garcom roda só um perfil (útil para depurar sem esperar a suíte toda).
  const soUm = (process.env.PERFIL ?? '').trim()
  const perfis = soUm ? PERFIS.filter((perfil) => perfil.nome === soUm || perfil.login === soUm) : PERFIS

  for (const perfil of perfis) {
    if (!perfil.senha) {
      console.log(`\n== ${perfil.nome}: sem senha no ambiente (PZ_${perfil.nome.toUpperCase()}_PASSWORD) — pulando`)
      continue
    }
    console.log(`\n== Perfil ${perfil.nome} (${perfil.login}) em ${BASE}`)
    const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })
    const page = await contexto.newPage()
    const errosDeConsole = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const texto = msg.text()
        // Ruído conhecido: extensões do navegador e avisos de websocket do Realtime ao trocar de página.
        if (/favicon|Download the React DevTools/i.test(texto)) return
        errosDeConsole.push(texto.slice(0, 220))
      }
    })
    page.on('pageerror', (erro) => errosDeConsole.push(`exceção: ${erro.message.slice(0, 220)}`))
    await page.addInitScript(() => {
      window.__falhasDeRede = []
      window.addEventListener('unhandledrejection', (evento) => {
        window.__falhasDeRede.push(String(evento.reason).slice(0, 160))
      })
    })
    page.on('requestfailed', (req) => {
      const url = req.url()
      if (/\.(png|svg|woff2?)$/.test(url)) return
      page.evaluate((u) => window.__falhasDeRede.push(`request failed: ${u}`), url).catch(() => {})
    })

    try {
      await entrar(page, perfil)
      console.log(`  OK    login de ${perfil.login}`)
      for (const tela of perfil.telas) {
        await conferirTela(page, perfil, tela, errosDeConsole)
      }
      for (const proibida of perfil.proibidas) {
        await conferirBloqueio(page, perfil, proibida)
      }

      if (perfil.nome === 'administrador') {
        errosDeConsole.length = 0
        const anotarFluxo = (texto) => registrar('falha', perfil.nome, 'fluxo', texto)
        await conferirEnterConfirma(page, anotarFluxo)
        for (const erro of errosDeConsole) anotarFluxo(`erro no console no teste de Enter: ${erro}`)
      }

      if (perfil.nome !== 'administrador') {
        errosDeConsole.length = 0
        await percursoDoSalao(page, perfil, errosDeConsole)
      }

      // Captura do celular: o garçom usa o sistema no telefone.
      if (perfil.nome !== 'administrador') {
        const celularContexto = await navegador.newContext({
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          locale: 'pt-BR',
        })
        const celular = await celularContexto.newPage()
        await entrar(celular, perfil)
        const [primeira] = perfil.telas
        await celular.goto(`${BASE}${primeira[1]}`, { waitUntil: 'domcontentloaded' })
        await espera(2600)
        await celular.screenshot({
          path: path.join(SAIDA, perfil.nome, `celular-${primeira[0]}.png`),
          fullPage: true,
        })
        console.log(`  OK    ${perfil.nome}/celular-${primeira[0]}`)
        await celularContexto.close()
      }
    } catch (erro) {
      registrar('falha', perfil.nome, 'fluxo', erro.message)
    }
    await contexto.close()
  }

  await navegador.close()

  const resumo = {
    base: BASE,
    quando: new Date().toISOString(),
    falhas,
    avisos,
  }
  await writeFile(path.join(SAIDA, 'resumo.json'), JSON.stringify(resumo, null, 2), 'utf8')

  console.log(`\n=== Resumo: ${falhas.length} falha(s), ${avisos.length} aviso(s) ===`)
  console.log(`Capturas em ${path.relative(process.cwd(), SAIDA)}`)
  process.exit(falhas.length > 0 ? 1 : 0)
}

rodar().catch((erro) => {
  console.error('\nErro inesperado no robô:', erro)
  process.exit(2)
})
