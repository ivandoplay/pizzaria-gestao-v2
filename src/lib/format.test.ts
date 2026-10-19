import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addDaysInputValue,
  celulaCsv,
  dayBounds,
  duracaoDesde,
  formatDate,
  formatMoney,
  formatPhone,
  formatTime,
  newClientUuid,
  parseMoneyToCents,
  plural,
  todayInputValue,
  todayRange,
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

describe('data padrão do campo (fuso de Fortaleza)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('não pula para o dia seguinte depois das 21h', () => {
    // 01:30 UTC de 18/10 = 22:30 de 17/10 em Fortaleza.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T01:30:00Z'))
    expect(todayInputValue()).toBe('2026-10-17')
    expect(addDaysInputValue(0)).toBe('2026-10-17')
    expect(addDaysInputValue(1)).toBe('2026-10-18')
    expect(addDaysInputValue(-1)).toBe('2026-10-16')
  })

  it('vira o dia civil à meia-noite de Fortaleza (03:00 UTC)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T02:59:00Z'))
    expect(todayInputValue()).toBe('2026-10-17')
    vi.setSystemTime(new Date('2026-10-18T03:00:00Z'))
    expect(todayInputValue()).toBe('2026-10-18')
  })

  it('respeita o fuso pedido explicitamente', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T01:30:00Z'))
    expect(todayInputValue('America/Sao_Paulo')).toBe('2026-10-17')
    expect(todayInputValue('UTC')).toBe('2026-10-18')
  })
})

describe('CSV seguro', () => {
  it('neutraliza célula que a planilha trataria como fórmula', () => {
    expect(celulaCsv('=1+1')).toBe("'=1+1")
    expect(celulaCsv('+55 86 99999-0000')).toBe("'+55 86 99999-0000")
    expect(celulaCsv('-5')).toBe("'-5")
    expect(celulaCsv('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(celulaCsv('\ttexto')).toBe("'\ttexto")
    // CR também é caractere que força aspas no CSV.
    expect(celulaCsv('\rtexto')).toBe('"\'\rtexto"')
  })

  it('não mexe em número nem em texto comum', () => {
    expect(celulaCsv(-5)).toBe('-5')
    expect(celulaCsv(1200)).toBe('1200')
    expect(celulaCsv('Mesa 3')).toBe('Mesa 3')
  })

  it('continua escapando aspas, ponto e vírgula e quebra de linha', () => {
    expect(celulaCsv('a;b')).toBe('"a;b"')
    expect(celulaCsv('diz "oi"')).toBe('"diz ""oi"""')
    expect(celulaCsv('linha1\nlinha2')).toBe('"linha1\nlinha2"')
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

describe('dayBounds com fuso configurável (pendência do A10)', () => {
  it('a mesma data civil vira instantes diferentes em fusos diferentes', () => {
    const fortaleza = dayBounds('2026-10-19', 'America/Fortaleza')
    const utc = dayBounds('2026-10-19', 'UTC')
    // Fortaleza é UTC-3: o dia começa 3h depois, em UTC.
    expect(fortaleza.from).toBe('2026-10-19T03:00:00.000Z')
    expect(utc.from).toBe('2026-10-19T00:00:00.000Z')
    expect(fortaleza.from > utc.from).toBe(true)
  })

  it('o fim do dia cobre 24 horas inteiras no fuso pedido', () => {
    const { from, to } = dayBounds('2026-10-19', 'America/Fortaleza')
    const horas = (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000
    expect(horas).toBe(24)
  })

  it('todayRange respeita o fuso passado', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T02:30:00.000Z'))
    // 02:30 UTC do dia 17 = 23:30 do dia 16 em Fortaleza.
    expect(todayRange('America/Fortaleza').from).toBe('2026-10-16T03:00:00.000Z')
    expect(todayRange('UTC').from).toBe('2026-10-17T00:00:00.000Z')
    vi.useRealTimers()
  })
})
