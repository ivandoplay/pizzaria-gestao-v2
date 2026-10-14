import { describe, expect, it } from 'vitest'
import {
  addDaysInputValue,
  dayBounds,
  duracaoDesde,
  formatDate,
  formatMoney,
  formatPhone,
  formatTime,
  newClientUuid,
  parseMoneyToCents,
  plural,
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

describe('duracaoDesde', () => {
  const agora = new Date('2026-10-14T20:00:00Z').getTime()

  it('mostra "agora mesmo" para menos de um minuto', () => {
    expect(duracaoDesde('2026-10-14T20:00:00Z', agora)).toBe('agora mesmo')
  })

  it('conta minutos até a primeira hora', () => {
    expect(duracaoDesde('2026-10-14T19:48:00Z', agora)).toBe('há 12 min')
  })

  it('conta horas e minutos preenchendo com zero', () => {
    expect(duracaoDesde('2026-10-14T18:25:00Z', agora)).toBe('há 1h35')
  })

  it('conta dias no plural', () => {
    expect(duracaoDesde('2026-10-12T20:00:00Z', agora)).toBe('há 2 dias')
    expect(duracaoDesde('2026-10-13T20:00:00Z', agora)).toBe('há 1 dia')
  })

  it('trata valor ausente ou inválido', () => {
    expect(duracaoDesde(null, agora)).toBe('—')
    expect(duracaoDesde('data-invalida', agora)).toBe('—')
  })
})

describe('plural', () => {
  it('usa o singular com 1', () => {
    expect(plural(1, 'pedido', 'pedidos')).toBe('1 pedido')
    expect(plural(1, 'conta', 'contas')).toBe('1 conta')
  })

  it('usa o plural com 0 e com mais de 1', () => {
    expect(plural(0, 'pedido', 'pedidos')).toBe('0 pedidos')
    expect(plural(2, 'pedido', 'pedidos')).toBe('2 pedidos')
    expect(plural(11, 'mesa desativada', 'mesas desativadas')).toBe('11 mesas desativadas')
  })
})
