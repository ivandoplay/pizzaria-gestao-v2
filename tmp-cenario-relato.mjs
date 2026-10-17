/** Reprodução LITERAL do relato, contra o site publicado:
 *  1) digita "João" no Nome do cliente
 *  2) clica no Número do endereço
 *  3) digita "9" (e confere onde o foco e o texto estão)
 *  4) repete com "8"
 *  Instrumenta o ciclo do efeito: conta escritas em document.body.style e
 *  eventos de foco durante a digitação. */
import { chromium } from 'playwright'
const url = process.argv[2] ?? 'https://pizzaria-gestao-v2.vercel.app'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const nav = await chromium.launch()
const ctx = await nav.newContext({ viewport: { width: 1440, height: 950 }, locale: 'pt-BR' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
await p.goto(`${url}/login`, { waitUntil: 'domcontentloaded' })
if (await p.locator('button:has-text("Entrar com outra conta")').count()) await p.locator('button:has-text("Entrar com outra conta")').click()
await p.fill('input[autocomplete="username"]', 'admin')
await p.fill('input[autocomplete="current-password"]', 'admin')
await p.click('button[type="submit"]'); await espera(2500)
await p.goto(`${url}/delivery`, { waitUntil: 'domcontentloaded' })
await p.waitForFunction(() => !document.querySelector('.esqueleto'), undefined, { timeout: 30000 }).catch(() => {})
await espera(1500)
await p.locator('button:has-text("Novo pedido")').first().click(); await espera(700)

// espia o ciclo do efeito (o mesmo instrumento que mediu o defeito)
await p.evaluate(() => {
  const w = window
  w.__escritas = 0
  w.__focos = []
  const obs = new MutationObserver((ms) => { ms.forEach((m) => { if (m.attributeName === 'style') w.__escritas++ }) })
  obs.observe(document.body, { attributes: true, attributeFilter: ['style'] })
  document.addEventListener('focusin', (e) => w.__focos.push(e.target.tagName + ':' + (e.target.getAttribute('name') ?? e.target.getAttribute('aria-label') ?? e.target.textContent?.slice(0, 18) ?? '')))
})

const modal = p.locator('[role="dialog"]').last()
const campo = (rotulo) => modal.locator('label').filter({ hasText: rotulo }).first().locator('input, textarea').first()
const onde = () => p.evaluate(() => {
  const a = document.activeElement
  const rotulo = a?.closest('label')?.querySelector('span')?.textContent?.replace('*', '').trim() ?? a?.tagName
  return rotulo
})

let falhas = 0
/** Confere o VALOR de um campo e, se pedido, exige que o foco esteja nele. */
const conf = async (rotulo, esperado, extra = '', exigirFoco = true) => {
  const valor = await campo(rotulo).inputValue()
  const foco = await onde()
  const ok = valor === esperado && (!exigirFoco || foco === rotulo)
  if (!ok) falhas++
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${rotulo} = "${valor}"` + (exigirFoco ? ` (foco em "${foco}")` : ` (valor intacto; foco em "${foco}" — é o campo que estou digitando)`) + ` ${extra}`)
}
const focosAgora = () => p.evaluate(() => window.__focos.length)

console.log('== cenário do relato ==')
const nome = campo('Nome do cliente')
await nome.click(); await espera(150)
// zera os contadores DEPOIS do clique: a partir daqui, só a digitação conta
await p.evaluate(() => { window.__escritas = 0; window.__focos = [] })
await p.keyboard.type('João', { delay: 160 }); await espera(200)
await conf('Nome do cliente', 'João', '← passo 1')

await campo('Número').click(); await espera(200)
console.log(`       cliquei no Número — foco em "${await onde()}"`)
const focoAntes9 = await p.evaluate(() => window.__focos.length)
await p.keyboard.type('9', { delay: 160 }); await espera(400)
const focoNo9 = (await p.evaluate(() => window.__focos.length)) - focoAntes9
if (focoNo9 !== 0) { falhas++; console.log(`  FALHA ${focoNo9} evento(s) de foco nas teclas do "9"`) }
console.log(`       0 eventos de foco durante a digitação do "9"`)
await conf('Número', '9', '← passo 3: o "9" ficou no Número')
await conf('Nome do cliente', 'João', '', false)

console.log('  ... o relato diz: o foco volta para o Nome e reaparece "João". Repetindo com "8":')
await campo('Número').click(); await espera(150)
const focoAntes8 = await p.evaluate(() => window.__focos.length)
await p.keyboard.type('8', { delay: 160 }); await espera(400)
const focoNo8 = (await p.evaluate(() => window.__focos.length)) - focoAntes8
if (focoNo8 !== 0) { falhas++; console.log(`  FALHA ${focoNo8} evento(s) de foco nas teclas do "8"`) }
console.log(`       0 eventos de foco durante a digitação do "8"`)
await conf('Número', '98', '← passo 4: os dois dígitos ficaram no Número')
await conf('Nome do cliente', 'João', '', false)

const med = await p.evaluate(() => ({ escritas: window.__escritas, focos: window.__focos }))
console.log(`\n== ciclo do efeito durante a digitação ==`)
console.log(`  escritas em document.body.style: ${med.escritas} (o defeito fazia 2 por tecla)`)
console.log(`  eventos de foco no total: ${med.focos.length} ${med.focos.length ? JSON.stringify(med.focos) : ''} — os cliques nos campos trocam o foco de propósito; nenhum veio da digitação`)
if (med.escritas !== 0) falhas++

// completa o formulário inteiro, tecla por tecla, e confere o mapa de valores
console.log('\n== formulário completo (tecla por tecla) ==')
const campos = [['Telefone com DDD', '86999990000'], ['Rua', 'Rua das Flores'], ['Número', '987654'], ['Complemento', 'apto 302'], ['Bairro', 'Centro'], ['Ponto de referência', 'Ao lado da praça'], ['Observações da entrega', 'Entregar na portaria']]
for (const [rotulo, texto] of campos) {
  const c = campo(rotulo)
  await c.click(); await c.fill(''); await espera(120)
  const antes = await focosAgora()
  await p.keyboard.type(texto, { delay: 40 }); await espera(200)
  const durante = (await focosAgora()) - antes
  if (durante !== 0) { falhas++; console.log(`  FALHA ${rotulo}: ${durante} evento(s) de foco durante a digitação`) }
  await conf(rotulo, texto)
  await conf('Nome do cliente', 'João', `(e 0 eventos de foco nas ${texto.length} teclas)`, false)
}
console.log(`\n${falhas === 0 ? 'CENÁRIO DO RELATO CORRIGIDO: 0 falhas' : `AINDA FALHA: ${falhas}`}`)
await p.keyboard.press('Escape'); await espera(400)
await nav.close()
process.exit(falhas === 0 ? 0 : 1)
