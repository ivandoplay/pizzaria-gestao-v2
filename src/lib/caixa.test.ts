import { describe, expect, it } from 'vitest'
import { agruparPorForma, totalEmEspecie, totalForaDaGaveta } from './caixa'

const dinheiro = { label: 'Dinheiro', kind: 'cash' as const, affects_cash_drawer: true }
const pix = { label: 'Pix', kind: 'pix' as const, affects_cash_drawer: false }
const credito = { label: 'Cartão de crédito', kind: 'credit_card' as const, affects_cash_drawer: false }

describe('conferência do turno de caixa', () => {
  it('soma por forma e separa o que é gaveta do que não é', () => {
    const grupos = agruparPorForma([
      { method_id: 'dinheiro', amount_cents: 5000, payment_methods: dinheiro },
      { method_id: 'pix', amount_cents: 3000, payment_methods: pix },
      { method_id: 'dinheiro', amount_cents: 2000, payment_methods: dinheiro },
      { method_id: 'credito', amount_cents: 7000, payment_methods: credito },
    ])

    expect(grupos).toHaveLength(3)
    expect(grupos[0]).toMatchObject({ label: 'Cartão de crédito', totalCents: 7000, quantidade: 1 })
    expect(grupos.find((g) => g.methodId === 'dinheiro')).toMatchObject({ totalCents: 7000, quantidade: 2 })
    expect(totalEmEspecie(grupos)).toBe(7000)
    expect(totalForaDaGaveta(grupos)).toBe(10000)
  })

  it('forma sem cadastro conhecido não entra na gaveta', () => {
    const grupos = agruparPorForma([{ method_id: 'apagada', amount_cents: 1500, payment_methods: null }])
    expect(grupos[0]).toMatchObject({ label: 'Outros', afetaGaveta: false, totalCents: 1500 })
    expect(totalEmEspecie(grupos)).toBe(0)
  })

  it('ignora valores zerados (estorno que deixou linha de valor zero)', () => {
    const grupos = agruparPorForma([
      { method_id: 'pix', amount_cents: 0, payment_methods: pix },
      { method_id: 'pix', amount_cents: 2500, payment_methods: pix },
    ])
    expect(grupos).toHaveLength(1)
    expect(grupos[0].totalCents).toBe(2500)
  })

  it('sem recebimento nenhum, tudo é zero', () => {
    expect(agruparPorForma([])).toEqual([])
    expect(totalEmEspecie([])).toBe(0)
    expect(totalForaDaGaveta([])).toBe(0)
  })

  it('desempata pelo nome em português', () => {
    const grupos = agruparPorForma([
      { method_id: 'pix', amount_cents: 1000, payment_methods: pix },
      { method_id: 'credito', amount_cents: 1000, payment_methods: credito },
    ])
    expect(grupos.map((g) => g.label)).toEqual(['Cartão de crédito', 'Pix'])
  })
})
