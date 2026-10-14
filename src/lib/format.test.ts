import { describe, expect, it } from 'vitest'
import {
  addDaysInputValue,
  dayBounds,
  formatDate,
  formatMoney,
  formatPhone,
  formatTime,
  newClientUuid,
  parseMoneyToCents,
} from './format'

/** O Intl usa espaço não separável entre "R$" e o valor — normalizamos na comparação. */
const money = (cents: number) => formatMoney(cents).replace(/\u00a0/g, ' ')

describe('dinheiro', () => {
  it('formata centavos em reais no padrão brasileiro', () => {
    expect(money(0)).toBe('R$ 0,00')
    expect(money(5800)).toBe('R$ 58,00')
    expect(money(123456)).toBe('R$ 1.234,56')
    expect(formatMoney(null)).toBeTruthy()
  })

  it('interpreta o que o operador digita: vírgula, ponto e separador de milhar', () => {
    expect(parseMoneyToCents('58,00')).toBe(5800)
    expect(parseMoneyToCents('58.00')).toBe(5800)
    expect(parseMoneyToCents('1.234,56')).toBe(123456)
    expect(parseMoneyToCents('R$ 12,50')).toBe(1250)
    expect(parseMoneyToCents('7')).toBe(700)
    expect(parseMoneyToCents('')).toBe(0)
    expect(parseMoneyToCents(null)).toBe(0)
    expect(parseMoneyToCents(58)).toBe(5800) // números são REAIS (58 reais → 5800 centavos)
  })

  it('nunca devolve valor negativo em um campo de dinheiro', () => {
    expect(parseMoneyToCents('-10,00')).toBe(0)
  })
})

describe('fuso horário da operação (America/Fortaleza)', () => {
  it('o dia começa e termina no horário local, não em UTC', () => {
    const { from, to } = dayBounds('2026-03-10')
    // Fortaleza é UTC-3 (sem horário de verão): 00:00 local = 03:00Z.
    expect(from).toBe('2026-03-10T03:00:00.000Z')
    expect(to).toBe('2026-03-11T03:00:00.000Z')
  })

  it('aceita o fuso configurado sem quebrar o intervalo', () => {
    const { from, to } = dayBounds('2026-12-31')
    expect(from < to).toBe(true)
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('formata data e hora no fuso local', () => {
    expect(formatDate('2026-03-10T12:00:00.000Z')).toMatch(/10\/03\/2026/)
    expect(formatTime('2026-03-10T12:00:00.000Z')).toMatch(/09:00/)
  })
})

describe('utilidades', () => {
  it('formata telefone com DDD', () => {
    expect(formatPhone('86999990000')).toBe('(86) 99999-0000')
    expect(formatPhone('8633334444')).toBe('(86) 3333-4444')
    expect(formatPhone(null)).toBe('—')
  })

  it('gera UUIDs distintos para idempotência', () => {
    const a = newClientUuid()
    const b = newClientUuid()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })

  it('addDaysInputValue devolve datas no formato do campo de calendário', () => {
    expect(addDaysInputValue(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(addDaysInputValue(7) > addDaysInputValue(0)).toBe(true)
  })
})
