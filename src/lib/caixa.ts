/**
 * Conferência do turno de caixa (seção 6.3 do prompt).
 *
 * O saldo esperado da gaveta soma **só dinheiro**: fundo de troco, entradas
 * manuais, menos saídas, mais recebimentos em espécie. Pix e cartão aparecem
 * separados, como informação de conferência — somá-los à gaveta faria o caixa
 * contar um dinheiro que não existe.
 */

export type TipoForma = 'cash' | 'pix' | 'debit_card' | 'credit_card' | 'other'

export interface PagamentoParaConferencia {
  method_id: string
  amount_cents: number
  payment_methods?: {
    label: string | null
    kind: TipoForma | string | null
    affects_cash_drawer: boolean | null
  } | null
}

export interface RecebimentoPorForma {
  methodId: string
  label: string
  kind: TipoForma | string
  afetaGaveta: boolean
  totalCents: number
  quantidade: number
}

/**
 * Agrupa os recebimentos confirmados do turno por forma de pagamento.
 *
 * Recebimento sem forma conhecida (forma removida, dado antigo) não é
 * escondido: entra como “Outros” e **nunca** é somado à gaveta, porque não há
 * como afirmar que aquele dinheiro é físico.
 */
export function agruparPorForma(pagamentos: PagamentoParaConferencia[]): RecebimentoPorForma[] {
  const mapa = new Map<string, RecebimentoPorForma>()

  for (const pagamento of pagamentos) {
    if (!Number.isFinite(pagamento.amount_cents) || pagamento.amount_cents === 0) continue
    const forma = pagamento.payment_methods
    const chave = pagamento.method_id ?? 'desconhecida'
    const atual = mapa.get(chave)
    if (atual) {
      atual.totalCents += pagamento.amount_cents
      atual.quantidade += 1
      continue
    }
    mapa.set(chave, {
      methodId: chave,
      label: forma?.label?.trim() || 'Outros',
      kind: forma?.kind ?? 'other',
      // Só é gaveta quando o cadastro da forma diz isso, de forma explícita.
      afetaGaveta: forma?.affects_cash_drawer === true,
      totalCents: pagamento.amount_cents,
      quantidade: 1,
    })
  }

  return [...mapa.values()].sort(
    (a, b) => b.totalCents - a.totalCents || a.label.localeCompare(b.label, 'pt-BR'),
  )
}

/** Total recebido que **não** passa pela gaveta (Pix, cartões, outros). */
export function totalForaDaGaveta(grupos: RecebimentoPorForma[]): number {
  return grupos.filter((grupo) => !grupo.afetaGaveta).reduce((soma, grupo) => soma + grupo.totalCents, 0)
}

/** Total recebido em espécie, segundo o cadastro das formas. */
export function totalEmEspecie(grupos: RecebimentoPorForma[]): number {
  return grupos.filter((grupo) => grupo.afetaGaveta).reduce((soma, grupo) => soma + grupo.totalCents, 0)
}
