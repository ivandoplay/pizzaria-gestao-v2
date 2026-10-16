/**
 * Auditoria de TODAS as telas, nos dois tamanhos de tela.
 *
 * Para cada perfil e cada rota que ele pode abrir, mede:
 *   1. rolagem lateral (a tela inteira arrastar para o lado no celular);
 *   2. alvos de toque pequenos demais no celular (dedo, não ponteiro);
 *   3. erro de console / erro de página / tela sem título;
 *   4. captura de tela para conferência visual (artifacts/auditoria/).
 *
 * Uso:
 *   node tools/auditar-telas.mjs [URL]
 *   AUDITAR_TAMANHO=celular|computador|ambos  (padrão: ambos)
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const base = process.argv[2] ?? 'http://localhost:4194'
const saida = 'artifacts/auditoria'
await mkdir(saida, { recursive: true })

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const tamanhos = {
  celular: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  computador: { viewport: { width: 1440, height: 900 } },
}
const quais = process.env.AUDITAR_TAMANHO ?? 'ambos'
const listaTamanhos = quais === 'ambos' ? ['celular', 'computador'] : [quais]

const PERFIS = [
  {
    nome: 'garcom',
    usuario: process.env.PZ_GARCOM_LOGIN ?? 'garcom',
    senha: process.env.PZ_GARCOM_PASSWORD,
    rotas: ['/mesas', '/mesas/:conta', '/pedidos-prontos'],
  },
  {
    nome: 'caixa',
    usuario: process.env.PZ_CAIXA_LOGIN ?? 'caixa',
    senha: process.env.PZ_CAIXA_PASSWORD,
    rotas: ['/caixa', '/mesas', '/mesas/:conta', '/pedidos-prontos', '/delivery', '/historico', '/caixa-controle'],
  },
  {
    nome: 'admin',
    usuario: 'admin',
    senha: process.env.PZ_ADMIN_PASSWORD,
    rotas: [
      '/dashboard',
      '/caixa',
      '/mesas',
      '/mesas/:conta',
      '/pedidos-prontos',
      '/delivery',
      '/historico',
      '/relatorios',
      '/caixa-controle',
      '/cardapio',
      '/funcionarios',
      '/auditoria',
      '/configuracoes',
    ],
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

const problemas = []
const avisos = []
const registrar = (lista, linha) => {
  lista.push(linha)
  console.log(`  ${lista === problemas ? 'FALHA' : 'aviso'} ${linha}`)
}

/** Mede a tela aberta. */
function medir() {
  const limite = document.documentElement.clientWidth
  const interativos = [
    ...document.querySelectorAll(
      'main button, main a[href], main [role="button"], main select, main [role="tab"], main label:has(input[type="checkbox"]), main summary',
    ),
  ].filter((el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
  })
  const pequenos = interativos
    .map((el) => {
      const r = el.getBoundingClientRect()
      return {
        altura: Math.round(r.height),
        largura: Math.round(r.width),
        rotulo: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34),
        classe: (el.className || '').toString().slice(0, 60),
      }
    })
    .filter((i) => i.altura < 44)

  return {
    tela: limite,
    conteudo: document.documentElement.scrollWidth,
    rolagemLateral: document.documentElement.scrollWidth - limite,
    titulo: (document.querySelector('h1')?.textContent ?? '').trim(),
    quantosInterativos: interativos.length,
    pequenos,
    agora: document.querySelectorAll('.esqueleto').length,
  }
}

async function entrar(page, perfil) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30_000 })
  await page.fill('input[autocomplete="username"]', perfil.usuario)
  await page.fill('input[autocomplete="current-password"]', perfil.senha)
  await page.click('button[type="submit"]')
  await page
    .waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 30_000 })
    .catch(() => {})
  await espera(2000)

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

/** Descobre a conta de uma mesa aberta para poder auditar a tela mais usada do salão. */
async function acharConta(page) {
  await page.goto(`${base}/mesas`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
  await espera(500)
  const cartoes = page.locator('button').filter({ hasText: /^Mesa \d/ })
  const total = await cartoes.count()
  for (let i = 0; i < Math.min(total, 12); i += 1) {
    const cartao = cartoes.nth(i)
    const ocupada = await cartao.evaluate((el) => /Ocupada|Aguardando|Atenção/.test(el.textContent ?? ''))
    if (!ocupada) continue
    await cartao.click()
    await espera(600)
    const abrir = page.locator('button').filter({ hasText: /^(Abrir|Acompanhar)/ }).first()
    if ((await abrir.count()) === 0) continue
    await abrir.click()
    await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
    await espera(600)
    const rota = new URL(page.url()).pathname
    return rota
  }
  return null
}

const navegador = await chromium.launch()

for (const tamanho of listaTamanhos) {
  for (const perfil of PERFIS) {
    if (!perfil.senha) {
      console.log(`\n== ${perfil.nome} / ${tamanho}: sem senha no ambiente — pulando`)
      continue
    }
    console.log(`\n== ${perfil.nome} / ${tamanho}`)
    const contexto = await navegador.newContext(tamanhos[tamanho])
    const page = await contexto.newPage()
    const erros = []
    page.on('pageerror', (erro) => erros.push(`erro de página: ${erro.message}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') erros.push(`console: ${msg.text().slice(0, 120)}`)
    })

    await entrar(page, perfil)
    const contaReal = perfil.rotas.includes('/mesas/:conta') ? await acharConta(page) : null

    for (const rota of perfil.rotas) {
      const destino = rota === '/mesas/:conta' ? contaReal : rota
      if (!destino) {
        console.log(`  aviso ${rota}: nenhuma mesa aberta para inspecionar`)
        continue
      }
      erros.length = 0
      await page.goto(`${base}${destino}`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
      await espera(900)

      const medida = await page.evaluate(medir)
      const etiqueta = `${perfil.nome} ${tamanho} ${destino}`

      if (medida.rolagemLateral > 2) {
        registrar(problemas, `${etiqueta}: rolagem lateral de ${medida.rolagemLateral}px (tela ${medida.tela}px, conteúdo ${medida.conteudo}px)`)
      }
      if (!medida.titulo) registrar(problemas, `${etiqueta}: tela sem título (h1)`)
      if (/defina sua senha|troca obrigat/i.test(medida.titulo)) {
        registrar(problemas, `${etiqueta}: caiu na tela de troca obrigatória de senha em vez de ${destino}`)
      }
      if (medida.agora > 0) registrar(problemas, `${etiqueta}: ficou carregando (esqueleto) depois de 25 s`)
      for (const erro of new Set(erros)) registrar(problemas, `${etiqueta}: ${erro}`)

      if (tamanho === 'celular' && medida.pequenos.length > 0) {
        const piores = medida.pequenos.slice(0, 4).map((i) => `${i.altura}px "${i.rotulo}"`)
        registrar(
          avisos,
          `${etiqueta}: ${medida.pequenos.length} alvo(s) de toque abaixo de 44px — ${piores.join(' · ')}`,
        )
      }

      const arquivo = `${saida}/${perfil.nome}-${tamanho}-${destino.replace(/\//g, '_').replace(/^_/, '') || 'raiz'}.png`
      // A captura só sai com a tela assentada: se um bloco ainda está carregando
      // (esqueleto), o PNG guardado mostraria um retângulo cinza no lugar do
      // conteúdo e quem confere a imagem pensa que a tela está quebrada.
      await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 10_000 }).catch(() => {})
      await espera(400)
      await page.screenshot({ path: arquivo })
      console.log(
        `  OK    ${destino} · título "${medida.titulo}" · ${medida.quantosInterativos} controles · ${
          tamanho === 'celular' ? `${medida.pequenos.length} pequenos` : 'densidade ok'
        }`,
      )
    }
    await contexto.close()
  }
}

await navegador.close()
console.log(`\n=== Resumo: ${problemas.length} falha(s), ${avisos.length} aviso(s) ===`)
console.log(`Capturas em ${saida}`)
process.exit(problemas.length === 0 ? 0 : 1)
