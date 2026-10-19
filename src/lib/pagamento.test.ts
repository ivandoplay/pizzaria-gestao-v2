import { describe, expect, it } from 'vitest'
import { saldoPendenteCents } from './pagamento'

describe('saldoPendenteCents', () => {
  it('devolve o saldo real quando existe pagamento parcial', () => {
    // Pedido de R$ 100,00 com R$ 40,00 já recebidos: faltam R$ 60,00.
    expect(saldoPendenteCents(10000, 4000)).toBe(6000)
  })

  it('não subtrai o pago duas vezes', () => {
    // Regressão do defeito: a tela recebia o saldo (6000) e subtraía o pago
    // de novo, mostrando 2000. Com total + pago crus, o resultado é 6000.
    const total = 10000
    const pago = 4000
    expect(saldoPendenteCents(total, pago)).toBe(6000)
  })

  it('devolve o total quando nada foi recebido', () => {
    expect(saldoPendenteCents(3500, 0)).toBe(3500)
  })

  it('devolve zero quando o pedido está quitado', () => {
    expect(saldoPendenteCents(2500, 2500)).toBe(0)
  })

  it('nunca devolve saldo negativo', () => {
    expect(saldoPendenteCents(1000, 1500)).toBe(0)
  })

  it('protege contra valores inválidos vindos de resposta incompleta', () => {
    expect(saldoPendenteCents(Number.NaN, 0)).toBe(0)
    expect(saldoPendenteCents(1000, Number.POSITIVE_INFINITY)).toBe(0)
  })
})
