#!/usr/bin/env node
/**
 * =============================================================================
 * Digitação confiável: nenhum campo perde o foco enquanto se digita.
 *
 * Por que existe: o `Modal` compartilhado prendia o foco ao primeiro campo em um
 * `setTimeout` disparado por um efeito que dependia de `onClose`. Como as telas
 * passam `onClose={() => setX(null)}` (função nova a cada render), cada tecla
 * digitada reiniciava o efeito: a limpeza devolvia o foco para o campo anterior
 * e a nova rodada do efeito re-focava o PRIMEIRO campo do modal 40 ms depois.
 * Resultado prático: digitar "9" no Número voltava o cursor para o Nome.
 *
 * Este robô prova o comportamento, no navegador, campo por campo:
 *
 *   1. foco inicial ao abrir o modal;
 *   0. o caso relatado LITERALMENTE: "João" no nome, clique no Número, tecla "9",
 *      tecla "8" — o foco e o texto não podem voltar para o nome (passos 1 a 4);
 *   2. o caso relatado: "João" no nome, depois "987654" no número, conferindo
 *      o foco e o valor a CADA tecla;
 *   3. telefone, rua, complemento, bairro, referência e observações;
 *   4. alternar entre campos e continuar digitando;
 *   5. valores numéricos e decimais em outro cadastro (gaveta do caixa);
 *   6. abrir e fechar modais repetidas vezes (foco inicial e devolução do foco);
 *   7. nada de valor apagado, substituído ou migrado de campo;
 *   8. Escape, Tab (prender o foco) e Enter (confirmar) preservados;
 *   9. modal aninhado (montar a pizza dentro do pedido de delivery): Escape
 *      fecha só o de cima.
 *
 * Uso:
 *   PZ_ADMIN_PASSWORD=... node tools/e2e-digitar.mjs http://localhost:4175
 *   PZ_ADMIN_PASSWORD=... node tools/e2e-digitar.mjs https://pizzaria-gestao-v2.vercel.app
 *
 * Exige Playwright instalado (não é dependência do projeto):
 *   npm i --no-save playwright && npx playwright install chromium && npx playwright install-deps chromium
 * =============================================================================
 */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4175'
const admin = {
  login: process.env.PZ_ADMIN_LOGIN ?? 'admin',
  senha: process.env.PZ_ADMIN_PASSWORD,
}

if (!admin.senha) {
  console.error('Defina PZ_ADMIN_PASSWORD para rodar o robô.')
  process.exit(2)
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const falhas = []
const avisos = []
const ok = (texto) => console.log(`  OK    ${texto}`)
const falhou = (texto) => {
  falhas.push(texto)
  console.log(`  FALHA ${texto}`)
}
const aviso = (texto) => {
  avisos.push(texto)
  console.log(`  aviso ${texto}`)
}
const resumo = (texto, limite = 120) => String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, limite)

/**
 * Espera o navegador ficar parado (padrão do repo): é o tempo em que o efeito do
 * modal, se estivesse se repetindo, já teria roubado o foco (timer de 40 ms).
 */
const PAUSA_TECLA_MS = 160

// ---------------------------------------------------------------------------
// Leituras da página
// ---------------------------------------------------------------------------

/** Rótulo do campo que está com o foco (o `Field` envolve o input num <label>). */
async function campoComFoco(page) {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el) return { tag: '', rotulo: '(nada)' }
    const rotulo = el.closest('label')?.querySelector('span')?.textContent ?? ''
    return {
      tag: el.tagName,
      rotulo:
        rotulo.replace('*', '').trim() ||
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.textContent?.trim().slice(0, 30) ||
        '(sem rótulo)',
      valor: 'value' in el ? el.value : '',
    }
  })
}

/** Inputs/textareas do modal do topo, por rótulo, com o valor atual. */
async function camposDoModal(page) {
  return page.evaluate(() => {
    const modais = document.querySelectorAll('[role="dialog"]')
    const painel = modais[modais.length - 1]
    if (!painel) return {}
    const mapa = {}
    for (const campo of painel.querySelectorAll('input, textarea')) {
      const rotulo = campo.closest('label')?.querySelector('span')?.textContent?.replace('*', '').trim()
      if (rotulo) mapa[rotulo] = campo.value
    }
    return mapa
  })
}

/** Campos sem <label> (buscas) — localizados pelo placeholder. */
function localizarPlaceholder(page, texto) {
  return page.locator('[role="dialog"]').last().locator(`input[placeholder^="${texto}"]`).first()
}

function localizar(page, rotulo) {
  return page
    .locator('[role="dialog"]')
    .last()
    .locator('label')
    .filter({ hasText: rotulo })
    .first()
    .locator('input, textarea')
    .first()
}

/** Quantos modais estão abertos (o painel de cada um tem role="dialog"). */
const modaisAbertos = (page) => page.locator('[role="dialog"]').count()

// ---------------------------------------------------------------------------
// Digitação com conferência tecla por tecla
// ---------------------------------------------------------------------------
/**
 * Clica no campo do rótulo, limpa e digita letra por letra. A cada tecla confere:
 *   - o foco continua NO MESMO campo;
 *   - o valor acumulado é exatamente o que foi digitado.
 * Devolve quantas teclas foram "roubadas" e o que o foco fez.
 */
async function digitarConferindo(page, rotulo, texto) {
  const campo = localizar(page, rotulo)
  await campo.click()
  await espera(120)
  await campo.fill('')

  let acumulado = ''
  let roubos = 0
  let ultimoRoubo = null

  for (const letra of texto) {
    await page.keyboard.type(letra)
    await espera(PAUSA_TECLA_MS)
    acumulado += letra

    const foco = await campoComFoco(page)
    const valor = await campo.inputValue().catch(() => '(campo saiu da tela)')

    if (foco.rotulo !== rotulo) {
      roubos += 1
      ultimoRoubo = `depois de "${letra}" o foco foi para "${foco.rotulo}"`
      // Devolve o foco para continuar o teste do campo.
      await campo.click()
      await espera(80)
    }
    if (valor !== acumulado) {
      roubos += 1
      ultimoRoubo = ultimoRoubo ?? `o valor de "${rotulo}" virou "${valor}" (esperado "${acumulado}")`
    }
  }

  const final = await campo.inputValue().catch(() => '')
  return { roubos, ultimoRoubo, valorFinal: final, esperado: acumulado }
}

/** Digita e transforma o resultado em linha de teste. */
async function preencher(page, rotulo, texto) {
  const resultado = await digitarConferindo(page, rotulo, texto)
  if (resultado.roubos === 0) {
    ok(`"${rotulo}" digitado sem perder o foco ("${resumo(resultado.valorFinal, 40)}")`)
  } else {
    falhou(`"${rotulo}": ${resultado.roubos} interrupção(ões) — ${resultado.ultimoRabo ?? resultado.ultimoRoubo}`)
  }
  return resultado
}

// ---------------------------------------------------------------------------
// Percurso
// ---------------------------------------------------------------------------
const navegador = await chromium.launch()
const contexto = await navegador.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
})
const page = await contexto.newPage()
page.setDefaultTimeout(20_000)

async function entrar() {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  if (await page.locator('button:has-text("Entrar com outra conta")').count()) {
    await page.locator('button:has-text("Entrar com outra conta")').click()
  }
  await page.fill('input[autocomplete="username"]', admin.login)
  await page.fill('input[autocomplete="current-password"]', admin.senha)
  await page.click('button[type="submit"]')
  await espera(2500)
  await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
}

await entrar()

// ===========================================================================
// 1) Cadastro de delivery — o caso relatado
// ===========================================================================
console.log('\n== 1) Pedido de delivery: "João" no nome e "987654" no número')
await page.goto(`${base}/delivery`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
await espera(1200)

const abrirDelivery = page.locator('button:has-text("Novo pedido")').first()
await abrirDelivery.click()
await espera(400)
if ((await modaisAbertos(page)) === 0) {
  falhou('a janela "Novo pedido de delivery" não abriu')
} else {
  // O foco inicial precisa cair no primeiro campo do modal.
  await espera(300)
  const primeiro = await campoComFoco(page)
  if (primeiro.rotulo === 'Nome do cliente') ok('ao abrir, o foco vai para o primeiro campo (Nome do cliente)')
  else falhou(`ao abrir, o foco ficou em "${primeiro.rotulo}" em vez de "Nome do cliente"`)

  // --- O cenário do relato, passo a passo (tal como o administrador descreveu)
  //   1) digito "João" no Nome do cliente;  2) clico no Número do endereço;
  //   3) digito "9" — o foco E o texto não podem voltar para o Nome;
  //   4) clico de novo e digito "8" — o problema não pode se repetir.
  const nomeCliente = localizar(page, 'Nome do cliente')
  const numeroEndereco = localizar(page, 'Número')

  await nomeCliente.click()
  await espera(120)
  await nomeCliente.fill('')
  await page.keyboard.type('João', { delay: 120 })
  await espera(150)
  let focoAgora = await campoComFoco(page)
  if (focoAgora.rotulo === 'Nome do cliente' && (await nomeCliente.inputValue()) === 'João') {
    ok('cenário do relato, passo 1: "João" digitado no nome, foco no nome')
  } else {
    falhou(`cenário do relato, passo 1: nome "${await nomeCliente.inputValue()}", foco em "${focoAgora.rotulo}"`)
  }

  await numeroEndereco.click()
  await espera(150)
  focoAgora = await campoComFoco(page)
  if (focoAgora.rotulo === 'Número') ok('cenário do relato, passo 2: o clique levou o foco para o Número')
  else falhou(`cenário do relato, passo 2: o clique no Número deixou o foco em "${focoAgora.rotulo}"`)

  await page.keyboard.type('9', { delay: 120 })
  await espera(300)
  focoAgora = await campoComFoco(page)
  const nomeDepoisDo9 = await nomeCliente.inputValue()
  const numeroCom9 = await numeroEndereco.inputValue()
  if (focoAgora.rotulo === 'Número' && numeroCom9 === '9' && nomeDepoisDo9 === 'João') {
    ok('cenário do relato, passo 3: o "9" ficou no Número e o "João" continuou no Nome')
  } else {
    falhou(`cenário do relato, passo 3: número "${numeroCom9}", nome "${nomeDepoisDo9}", foco em "${focoAgora.rotulo}"`)
  }

  await numeroEndereco.click()
  await espera(150)
  await page.keyboard.type('8', { delay: 120 })
  await espera(300)
  focoAgora = await campoComFoco(page)
  const numeroCom98 = await numeroEndereco.inputValue()
  if (focoAgora.rotulo === 'Número' && numeroCom98 === '98' && (await nomeCliente.inputValue()) === 'João') {
    ok('cenário do relato, passo 4: o "8" entrou no Número ("98") e o problema não se repetiu')
  } else {
    falhou(`cenário do relato, passo 4: número "${numeroCom98}", foco em "${focoAgora.rotulo}"`)
  }

  await preencher(page, 'Nome do cliente', 'João')
  await preencher(page, 'Telefone com DDD', '86999990000')
  await preencher(page, 'Rua', 'Rua das Flores')

  const numero = await preencher(page, 'Número', '987654')
  if (numero.roubos === 0) ok('o número "987654" foi digitado inteiro, com o foco no lugar')
  else falhou(`o número do endereço não pôde ser digitado: ${numero.ultimoRoubo}`)

  await preencher(page, 'Complemento', 'apto 302')
  await preencher(page, 'Bairro', 'Centro')
  await preencher(page, 'Ponto de referência', 'Ao lado da praça')
  await preencher(page, 'Observações da entrega', 'Entregar na portaria')

  // Nada pode ter sido apagado, substituído ou migrado de campo.
  const depois = await camposDoModal(page)
  const esperado = {
    'Nome do cliente': 'João',
    'Telefone com DDD': '86999990000',
    Rua: 'Rua das Flores',
    Número: '987654',
    Complemento: 'apto 302',
    Bairro: 'Centro',
    'Ponto de referência': 'Ao lado da praça',
    'Observações da entrega': 'Entregar na portaria',
  }
  const divergentes = Object.entries(esperado).filter(([rotulo, valor]) => depois[rotulo] !== valor)
  if (divergentes.length === 0) ok('nenhum valor foi apagado, substituído ou transferido de campo')
  else
    falhou(
      `valores fora do lugar: ${divergentes
        .map(([rotulo, valor]) => `${rotulo}="${depois[rotulo] ?? '(vazio)'}" (esperado "${valor}")`)
        .join(' · ')}`,
    )

  // =========================================================================
  // 2) Alternar entre campos e continuar digitando
  // =========================================================================
  console.log('\n== 2) Alternar entre campos e continuar digitando')
  const alternancias = [
    ['Número', '1'],
    ['Rua', ' Esquina'],
    ['Número', '2'],
    ['Complemento', ' / bloco B'],
    ['Número', '3'],
  ]
  let alternou = true
  for (const [rotulo, texto] of alternancias) {
    const campo = localizar(page, rotulo)
    await campo.click()
    await espera(120)
    await page.keyboard.type(texto)
    await espera(PAUSA_TECLA_MS)
    const foco = await campoComFoco(page)
    const valor = await campo.inputValue()
    if (foco.rotulo !== rotulo || !valor.endsWith(texto.trim())) {
      alternou = false
      falhou(`ao voltar para "${rotulo}", o foco/texto se perdeu (foco em "${foco.rotulo}", valor "${resumo(valor, 40)}")`)
    }
  }
  if (alternou) ok('ida e volta entre campos sem perder foco nem texto')

  // =========================================================================
  // 3) Enter não dispara ação destrutiva e respeita o botão desabilitado
  // =========================================================================
  console.log('\n== 3) Enter com a ação principal desabilitada')
  const campoRua = localizar(page, 'Rua')
  await campoRua.click()
  await page.keyboard.press('Enter')
  await espera(700)
  if ((await modaisAbertos(page)) === 1) ok('Enter com "Registrar pedido" desabilitado não fez nada (o modal continua aberto)')
  else falhou('Enter fechou/acionou o modal mesmo com a ação principal desabilitada')

  // =========================================================================
  // 4) Prender o foco (Tab) sem sair do modal
  // =========================================================================
  console.log('\n== 4) Tab preso dentro do modal')
  const focaveis = await page.locator('[role="dialog"]').last().locator('a[href], button:not([disabled]), textarea, input, select').count()
  let escapou = null
  for (let i = 0; i < focaveis + 3; i += 1) {
    await page.keyboard.press('Tab')
    const dentro = await page.evaluate(() => {
      const modais = document.querySelectorAll('[role="dialog"]')
      const painel = modais[modais.length - 1]
      return Boolean(painel && document.activeElement && painel.contains(document.activeElement))
    })
    if (!dentro) escapou = i
  }
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Shift+Tab')
    const dentro = await page.evaluate(() => {
      const modais = document.querySelectorAll('[role="dialog"]')
      const painel = modais[modais.length - 1]
      return Boolean(painel && document.activeElement && painel.contains(document.activeElement))
    })
    if (!dentro) escapou = `Shift+Tab ${i}`
  }
  if (escapou === null) ok(`o foco andou por ${focaveis} controles (Tab e Shift+Tab) sem sair do modal`)
  else falhou(`o foco escapou do modal na tecla Tab (${escapou})`)

  // =========================================================================
  // 5) Modal aninhado: montar a pizza dentro do pedido
  // =========================================================================
  console.log('\n== 5) Modal aninhado (montar a pizza dentro do delivery)')
  const pizza = page.locator('[role="dialog"]').last().locator('button').filter({ hasText: /^Margherita/ }).first()
  if ((await pizza.count()) === 0) {
    aviso('não achei a pizza Margherita para abrir o modal de montagem')
  } else {
    await pizza.click()
    await espera(900)
    const aninhados = await modaisAbertos(page)
    if (aninhados === 2) ok('o modal de montagem abriu por cima do pedido (2 janelas)')
    else falhou(`esperava 2 janelas abertas (pedido + montagem) e encontrei ${aninhados}`)

    // Enter num campo do modal de montagem confirma a ação principal (Adicionar).
    const busca = localizarPlaceholder(page, 'Buscar sabor')
    if ((await busca.count()) > 0) {
      await busca.click()
      await page.keyboard.type('calabresa')
      await espera(PAUSA_TECLA_MS)
      // A busca fica dentro do Field "Segundo sabor", então o rótulo lido é o do
      // Field — o que importa é que o foco continue NO CAMPO e o texto tenha
      // entrado nele (o valor é a prova de que a digitação não foi desviada).
      const focoBusca = await campoComFoco(page)
      const valorBusca = await busca.inputValue()
      if (focoBusca.tag === 'INPUT' && valorBusca === 'calabresa') {
        ok('campo de busca do modal aninhado digitou inteiro, com o foco no lugar')
      } else {
        falhou(`ao digitar na busca do modal aninhado, o foco foi para "${focoBusca.rotulo}" e o campo ficou com "${valorBusca}"`)
      }
      await busca.fill('')
      await page.keyboard.press('Enter')
      await espera(1200)
      const abertasDepoisDoEnter = await modaisAbertos(page)
      if (abertasDepoisDoEnter === 1) ok('Enter no campo confirmou a ação principal ("Adicionar") e fechou só a janela de montagem')
      else aviso(`Enter no modal de montagem não adicionou o item (janelas abertas: ${abertasDepoisDoEnter}) — conferir se faltava escolha obrigatória`)
    } else {
      aviso('não achei o campo "Buscar sabor" no modal de montagem')
    }

    // Reabre para o teste do Escape.
    if ((await modaisAbertos(page)) === 1) {
      await page.locator('[role="dialog"]').last().locator('button').filter({ hasText: /^Margherita/ }).first().click()
      await espera(900)
    }
    if ((await modaisAbertos(page)) === 2) {
      await page.locator('body').press('Escape')
      await espera(900)
      const restantes = await modaisAbertos(page)
      if (restantes === 1) ok('Escape fechou só a janela de cima (o pedido de delivery continua aberto)')
      else falhou(`Escape fechou ${2 - restantes} janela(s) de uma vez — o modal aninhado fechou junto com o pedido`)
    }
  }

  // =========================================================================
  // 6) Abrir e fechar repetidas vezes: foco inicial e devolução do foco
  // =========================================================================
  console.log('\n== 6) Abrir e fechar o modal três vezes')
  let focoVoltou = 0
  let focoInicial = 0
  for (let i = 0; i < 3; i += 1) {
    await page.locator('body').press('Escape')
    await espera(700)
    const ativo = await campoComFoco(page)
    if (/Novo pedido/.test(ativo.rotulo) || /Novo pedido/.test(ativo.texto ?? '')) focoVoltou += 1
    else if (i === 0) aviso(`depois de fechar, o foco ficou em "${ativo.rotulo}"`)

    await abrirDelivery.click()
    await espera(420)
    const primeiro = await campoComFoco(page)
    if (primeiro.rotulo === 'Nome do cliente') focoInicial += 1
  }
  if (focoInicial === 3) ok('o foco inicial voltou ao primeiro campo nas 3 aberturas')
  else falhou(`o foco inicial só apareceu em ${focoInicial} de 3 aberturas`)
  if (focoVoltou >= 2) ok(`o foco volta para o botão que abriu o modal ao fechar (${focoVoltou}/3)`)
  else aviso(`o foco voltou para o botão de origem em ${focoVoltou} de 3 fechamentos`)

  // Fecha o modal para não deixar janela aberta.
  await page.locator('body').press('Escape')
  await espera(500)
}

// ===========================================================================
// 7) Outro cadastro, com valores decimais (gaveta do caixa)
// ===========================================================================
console.log('\n== 7) Valores decimais na conferência da gaveta')
await page.goto(`${base}/caixa-controle`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
await espera(1200)

const fecharCaixa = page.locator('button:has-text("Fechar caixa e conferir")').first()
if ((await fecharCaixa.count()) === 0) {
  aviso('não achei o botão de fechar o turno (talvez o caixa esteja fechado)')
} else {
  await fecharCaixa.click()
  await espera(700)
  if ((await modaisAbertos(page)) === 0) {
    aviso('a janela de fechamento do caixa não abriu')
  } else {
    await preencher(page, 'Valor contado na gaveta (R$)', '1234,56')
    await preencher(page, 'Observação do fechamento', 'conferido com o responsável')
    const antes = await camposDoModal(page)

    // Enter não pode acionar o fechamento (ação destrutiva, botão vermelho).
    const campoObservacao = localizar(page, 'Observação do fechamento')
    await campoObservacao.click()
    await page.keyboard.press('Enter')
    await espera(800)
    if ((await modaisAbertos(page)) === 1) {
      const atual = await camposDoModal(page)
      if (JSON.stringify(antes) === JSON.stringify(atual)) ok('Enter na janela de fechamento não disparou a ação destrutiva nem mexeu nos valores')
      else falhou('Enter alterou os valores da janela de fechamento')
    } else {
      falhou('Enter disparou o fechamento do caixa (ação destrutiva)')
    }
    await page.locator('body').press('Escape')
    await espera(500)
  }
}

// ===========================================================================
// 8) Cadastro de funcionário (texto + autoFocus)
// ===========================================================================
console.log('\n== 8) Cadastro de funcionário (campo com autoFocus)')
await page.goto(`${base}/funcionarios`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 25_000 }).catch(() => {})
await espera(1200)
const novoFuncionario = page.locator('button:has-text("Novo funcionário")').first()
if ((await novoFuncionario.count()) === 0) {
  aviso('não achei o botão "Novo funcionário"')
} else {
  await novoFuncionario.click()
  await espera(600)
  if ((await modaisAbertos(page)) === 0) {
    aviso('a janela de novo funcionário não abriu')
  } else {
    await preencher(page, 'Nome completo', 'Maria da Silva')
    await preencher(page, 'Login', 'maria.teste')
    await preencher(page, 'Telefone', '86988887777')
    await page.locator('body').press('Escape')
    await espera(500)
    ok('nenhum funcionário foi criado (o robô só digitou e fechou)')
  }
}

// ---------------------------------------------------------------------------
await navegador.close()

console.log(`\n=== Resumo: ${falhas.length} falha(s), ${avisos.length} aviso(s) ===`)
if (falhas.length > 0) {
  console.log('\nO que falhou:')
  for (const falha of falhas) console.log(`  - ${falha}`)
}
process.exit(falhas.length > 0 ? 1 : 0)
