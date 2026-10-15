#!/usr/bin/env node
/**
 * =============================================================================
 * Teste de ENTRADA contra o domínio publicado — roda como um usuário real faria.
 *
 * Executa, em navegador de verdade e em contextos isolados (sem cache):
 *   1. entrar do zero com cada perfil (admin, caixa, garçom) e conferir a tela inicial;
 *   2. recarregar a página com a sessão salva;
 *   3. abrir /login já conectado e trocar de conta;
 *   4. cenário de SESSÃO VELHA/inválida guardada no navegador (o caso que trava o operador);
 *   5. entrar pelo celular (garçom usa o sistema no telefone);
 *   6. conferir o carimbo de versão do build no rodapé.
 *
 * Uso:
 *   PZ_ADMIN_PASSWORD=... PZ_CAIXA_PASSWORD=... PZ_GARCOM_PASSWORD=... \
 *     node tools/teste-login.mjs https://pizzaria-gestao-v2.vercel.app
 * =============================================================================
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const BASE = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '')
const SAIDA = path.resolve('artifacts/login')
const PERFIS = [
  { nome: 'admin', senha: process.env.PZ_ADMIN_PASSWORD, rota: '/dashboard', titulo: 'Painel do dia' },
  { nome: 'caixa', senha: process.env.PZ_CAIXA_PASSWORD, rota: '/caixa', titulo: 'Caixa' },
  { nome: 'garcom', senha: process.env.PZ_GARCOM_PASSWORD, rota: '/mesas', titulo: 'Mesas' },
]

const falhas = []
const ok = (texto) => console.log(`  OK    ${texto}`)
const falha = (texto) => {
  falhas.push(texto)
  console.log(`  FALHA ${texto}`)
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

async function entrar(pagina, login, senha) {
  await pagina.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await pagina.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 })
  await pagina.fill('input[autocomplete="username"]', login)
  await pagina.fill('input[autocomplete="current-password"]', senha)
  await pagina.click('button[type="submit"]')
  // Espera a navegação acontecer; só depois conta o tempo como atraso real.
  await pagina
    .waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 25_000 })
    .catch(() => {})
  await pagina.waitForTimeout(1500)
}

async function rodar() {
  await mkdir(SAIDA, { recursive: true })
  const navegador = await chromium.launch()

  // ---------------------------------------------------------------- 6) versão
  {
    const ctx = await navegador.newContext()
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await p.waitForTimeout(1500)
    const texto = await p.locator('body').innerText()
    const versao = texto.match(/versão ([^\s]+ · [^\s]+)/)
    const host = texto.includes(new URL(BASE).host)
    if (host && versao) ok(`rodapé mostra o endereço ${new URL(BASE).host} e a versão ${versao[1]}`)
    else falha(`rodapé sem endereço/versão (conteúdo: ${texto.slice(-120).replace(/\n/g, ' ')})`)
    await p.screenshot({ path: path.join(SAIDA, '0-tela-de-entrada.png'), fullPage: true })
    await ctx.close()
  }

  // ------------------------------------------------- 1) e 2) entrar e recarregar
  for (const perfil of PERFIS) {
    if (!perfil.senha) {
      console.log(`\n== ${perfil.nome}: sem senha no ambiente — pulando`)
      continue
    }
    console.log(`\n== Perfil ${perfil.nome} em ${BASE}`)
    const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' })
    const p = await ctx.newPage()
    const erros = []
    p.on('pageerror', (e) => erros.push(e.message.slice(0, 150)))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) erros.push(m.text().slice(0, 150))
    })

    try {
      await entrar(p, perfil.nome, perfil.senha)
      const caminho = new URL(p.url()).pathname
      const titulo = await p.locator('h1').first().innerText().catch(() => '')
      if (caminho === perfil.rota && titulo.toLowerCase().includes(perfil.titulo.toLowerCase())) {
        ok(`${perfil.nome}: entrou e caiu em ${caminho} ("${titulo}")`)
      } else if (/Carregando|acesso|Entrar/i.test(titulo)) {
        falha(`${perfil.nome}: NÃO entrou — ficou em "${titulo}" (${caminho})`)
      } else {
        falha(`${perfil.nome}: entrou mas caiu em ${caminho} ("${titulo}"), esperava ${perfil.rota}`)
      }
      await p.screenshot({ path: path.join(SAIDA, `1-${perfil.nome}-depois-do-login.png`), fullPage: true })

      await p.reload({ waitUntil: 'domcontentloaded' })
      await p.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
      await p.waitForTimeout(1500)
      const t2 = await p.locator('h1').first().innerText().catch(() => '(nada)')
      if (t2.toLowerCase().includes(perfil.titulo.toLowerCase())) ok(`${perfil.nome}: recarregou e continuou dentro ("${t2}")`)
      else falha(`${perfil.nome}: travou ao recarregar (tela: "${t2}")`)

      // 3) já conectado → trocar de conta
      await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
      await p.waitForTimeout(2500)
      const corpo = await p.locator('body').innerText()
      if (/Você já está conectado/i.test(corpo)) {
        ok(`${perfil.nome}: abrir /login conectado mostra "Você já está conectado" (não entra às cegas)`)
        await p.click('button:has-text("Entrar com outra conta")')
        await p.waitForTimeout(4000)
        const formulario = await p.locator('input[autocomplete="username"]').isVisible().catch(() => false)
        if (formulario) ok(`${perfil.nome}: "Entrar com outra conta" devolveu o formulário`)
        else falha(`${perfil.nome}: "Entrar com outra conta" não voltou ao formulário`)
      } else {
        falha(`${perfil.nome}: /login conectado não avisou que já há sessão`)
      }

      if (erros.length) falha(`${perfil.nome}: erros no console — ${erros.join(' | ')}`)
    } catch (erro) {
      falha(`${perfil.nome}: fluxo interrompido — ${erro.message.slice(0, 160)}`)
    }
    await ctx.close()
  }

  // ------------------------------------------- 4) sessão velha/inválida no aparelho
  console.log('\n== Sessão velha guardada no navegador (o caso que trava o operador)')
  for (const [rotulo, valor] of [
    ['sessão de conta que não existe mais', JSON.stringify({ access_token: 'token.antigo.fake', refresh_token: 'refresh.fake', expires_at: 1, token_type: 'bearer', user: { id: '00000000-0000-0000-0000-000000000000', email: 'antigo@pizzaria.local' } })],
    ['dados corrompidos', 'isto-nao-e-json'],
  ]) {
    const ctx = await navegador.newContext({ viewport: { width: 1100, height: 800 }, locale: 'pt-BR' })
    await ctx.addInitScript(([chave, conteudo]) => {
      localStorage.setItem(chave, conteudo)
    }, ['pizzaria.auth', valor])
    const p = await ctx.newPage()
    try {
      await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
      await p.waitForTimeout(14_000) // além do prazo interno de 12 s
      const corpo = await p.locator('body').innerText()
      const preso = await p.locator('.esqueleto').count()
      if (preso > 0 && !/Limpar dados|Tentar de novo|Entrar/i.test(corpo)) {
        falha(`${rotulo}: a tela ficou presa em carregamento`)
      } else {
        ok(`${rotulo}: não travou — a tela oferece saída ("${corpo.split('\n').filter(Boolean)[0] ?? ''}")`)
      }
      await p.screenshot({ path: path.join(SAIDA, `4-${rotulo.replace(/[^a-z]/gi, '-')}.png`), fullPage: true })

      // o botão de limpar precisa resolver de fato
      const limpar = p.locator('button:has-text("Limpar dados deste aparelho")')
      if (await limpar.count() > 0) {
        await limpar.first().click()
        await p.waitForTimeout(4000)
        const visivel = await p.locator('input[autocomplete="username"]').isVisible().catch(() => false)
        if (visivel) ok(`${rotulo}: "Limpar dados deste aparelho" devolveu o formulário de entrada`)
        else falha(`${rotulo}: limpar dados não levou ao formulário`)
      } else {
        // caiu direto no formulário (sessão descartada sozinha) — também é bom
        const visivel = await p.locator('input[autocomplete="username"]').isVisible().catch(() => false)
        if (visivel) ok(`${rotulo}: o sistema descartou a sessão sozinho e mostrou o formulário`)
        else falha(`${rotulo}: sem formulário e sem botão de limpar dados`)
      }

      // e o login precisa funcionar depois da limpeza
      if (await p.locator('input[autocomplete="username"]').isVisible().catch(() => false)) {
        await p.fill('input[autocomplete="username"]', 'admin')
        await p.fill('input[autocomplete="current-password"]', process.env.PZ_ADMIN_PASSWORD ?? '')
        await p.click('button[type="submit"]')
        await p.waitForTimeout(5000)
        const titulo = await p.locator('h1').first().innerText().catch(() => '')
        if (/Painel/i.test(titulo)) ok(`${rotulo}: login funcionou depois da limpeza`)
        else falha(`${rotulo}: login falhou depois da limpeza ("${titulo}")`)
      }
    } catch (erro) {
      falha(`${rotulo}: fluxo interrompido — ${erro.message.slice(0, 160)}`)
    }
    await ctx.close()
  }

  // ---------------------------------------------------------------- 5) celular
  console.log('\n== Celular (garçom)')
  {
    const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'pt-BR' })
    const p = await ctx.newPage()
    try {
      await entrar(p, 'garcom', process.env.PZ_GARCOM_PASSWORD ?? '')
      const titulo = await p.locator('h1').first().innerText().catch(() => '')
      if (/Mesas/i.test(titulo)) ok('garçom entrou pelo celular e viu o mapa de mesas')
      else falha(`garçom no celular caiu em "${titulo}"`)
      await p.screenshot({ path: path.join(SAIDA, '5-garcom-celular.png'), fullPage: true })
    } catch (erro) {
      falha(`celular: ${erro.message.slice(0, 160)}`)
    }
    await ctx.close()
  }

  await navegador.close()
  console.log(`\n===== RESULTADO: ${falhas.length} falha(s) em ${BASE} =====`)
  console.log(`Capturas: ${path.relative(process.cwd(), SAIDA)}`)
  process.exit(falhas.length ? 1 : 0)
}

rodar().catch((erro) => {
  console.error('Erro inesperado:', erro)
  process.exit(2)
})
