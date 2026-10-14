import { TIMEZONE } from './env'

/** Formata centavos como moeda brasileira: 12345 -> "R$ 123,45". */
export function formatMoney(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Converte o que o operador digitou em CENTAVOS.
 *   * strings: "12,50" · "12.50" · "1.234,56" · "R$ 12,50" · "7"
 *   * números: são interpretados como REAIS (12 → 1200 centavos)
 *   * vazio/inválido → 0 e valores negativos são tratados como 0 (o servidor
 *     valida novamente; a tela nunca envia dinheiro negativo por engano).
 */
export function parseMoneyToCents(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0
  if (typeof input === 'number') return Math.max(0, Math.round(input * 100))
  const normalized = input
    .toString()
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '') // remove separador de milhar
    .replace(',', '.')
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TIMEZONE })
}

/** "há 12 min" — usado nas mesas/pedidos em produção. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h${String(minutes % 60).padStart(2, '0')}`
  const days = Math.floor(hours / 24)
  return `há ${days} dia(s)`
}

/**
 * Plural correto em português: `plural(1, 'pedido', 'pedidos')` → "1 pedido".
 * Evita o "1 pedido(s)" que aparecia nas telas.
 */
export function plural(quantidade: number, singular: string, pluralDaPalavra: string): string {
  return `${quantidade} ${quantidade === 1 ? singular : pluralDaPalavra}`
}

/**
 * Há quanto tempo um instante aconteceu, em linguagem de operação:
 * "agora mesmo", "há 12 min", "há 1h35", "há 2 dia(s)".
 *
 * Recebe `agora` para que as telas possam recalcular o texto num intervalo
 * sem depender do relógio do render.
 */
export function duracaoDesde(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return '—'
  const minutos = Math.floor((agora - new Date(iso).getTime()) / 60000)
  if (Number.isNaN(minutos)) return '—'
  if (minutos < 1) return 'agora mesmo'
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `há ${horas}h${String(minutos % 60).padStart(2, '0')}`
  const dias = Math.floor(horas / 24)
  return `há ${dias} dia${dias === 1 ? '' : 's'}`
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return phone
}

/** Intervalo do dia atual (00:00 até 23:59) no fuso da pizzaria. */
export function todayRange(): { from: string; to: string } {
  const now = new Date()
  const localDate = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }))
  const y = localDate.getFullYear()
  const m = localDate.getMonth() + 1
  const d = localDate.getDate()
  const from = zonedTimeToUtc(y, m, d, 0, 0, 0)
  const to = new Date(zonedTimeToUtc(y, m, d, 23, 59, 59).getTime() + 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

/** Converte uma data digitada (yyyy-mm-dd) no início/fim do dia no fuso da pizzaria. */
export function dayBounds(dateStr: string): { from: string; to: string } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = zonedTimeToUtc(y, m, d, 0, 0)
  const end = zonedTimeToUtc(y, m, d, 23, 59, 59)
  return { from: start.toISOString(), to: new Date(end.getTime() + 1000).toISOString() }
}

/**
 * Constrói um instante UTC a partir de uma data/hora LOCAL na pizzaria.
 * Usa o formato ISO do Intl para descobrir o offset vigente do fuso.
 */
function zonedTimeToUtc(y: number, m: number, d: number, h: number, min: number, s = 0): Date {
  const utcGuess = Date.UTC(y, m - 1, d, h, min, s)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(utcGuess))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asZoned = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  )
  const offset = asZoned - utcGuess
  return new Date(utcGuess - offset)
}

export function todayInputValue(): string {
  const now = new Date()
  return new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE })).toISOString().slice(0, 10)
}

export function addDaysInputValue(days: number): string {
  const now = new Date(Date.now() + days * 86400000)
  return new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE })).toISOString().slice(0, 10)
}

/** Gera um UUID v4 para idempotência das operações críticas. */
export function newClientUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const escape = (value: string | number) => {
    const text = String(value ?? '')
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const csv = rows.map((row) => row.map(escape).join(';')).join('\r\n')
  // BOM para o Excel reconhecer acentuação em UTF-8
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
