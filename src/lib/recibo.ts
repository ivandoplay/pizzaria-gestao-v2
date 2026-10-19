/**
 * Linhas do recibo/comanda impressos pelo navegador.
 *
 * Existe por causa de um defeito real: o recibo impresso de **um pedido** de
 * uma mesa mostrava o subtotal e o desconto da **conta inteira** (a tela usava
 * os totais da sessão para qualquer impressão). O papel saía sem fechar a
 * conta: itens de um pedido, subtotal de vários.
 *
 * Aqui o escopo é explícito: quem imprime passa exatamente os pedidos que
 * saem no papel. Os valores são sempre calculados a partir deles — nunca
 * "emprestados" de outro lugar.
 *
 * Regras:
 *  - desconto e taxa só aparecem quando existem (recibo limpo continua limpo);
 *  - total, recebido e saldo sempre aparecem (é o que o cliente confere);
 *  - saldo nunca fica negativo (troco é linha separada, não receita);
 *  - troco só aparece quando houve troco.
 */

import { formatMoney } from './format'

export interface PedidoParaRecibo {
  subtotal_cents: number
  discount_cents: number
  delivery_fee_cents: number
  total_cents: number
  paid_cents: number
}

export interface ValoresRecibo {
  subtotal: number
  desconto: number
  taxa: number
  total: number
  recebido: number
  saldo: number
}

export interface LinhaRecibo {
  label: string
  value: string
  emphasis?: boolean
}

/** Soma os valores que vão para o papel, a partir dos pedidos do escopo. */
export function valoresRecibo(pedidos: PedidoParaRecibo[]): ValoresRecibo {
  const somar = (campo: keyof PedidoParaRecibo) =>
    pedidos.reduce((total, pedido) => total + (pedido[campo] ?? 0), 0)

  const total = somar('total_cents')
  const recebido = somar('paid_cents')

  return {
    subtotal: somar('subtotal_cents'),
    desconto: somar('discount_cents'),
    taxa: somar('delivery_fee_cents'),
    total,
    recebido,
    saldo: Math.max(total - recebido, 0),
  }
}

/**
 * Monta as linhas de valores do recibo.
 *
 * `pagamentos` é opcional: quando informado, cada recebimento vira uma linha
 * ("Pgto. Pix — R$ 30,00"), de forma que o papel mostre como a conta foi paga.
 */
export function linhasRecibo(
  pedidos: PedidoParaRecibo[],
  opcoes: {
    trocoCents?: number
    pagamentos?: { rotulo: string; valorCents: number }[]
  } = {},
): LinhaRecibo[] {
  const valores = valoresRecibo(pedidos)
  const troco = opcoes.trocoCents ?? 0

  return [
    { label: 'Subtotal', value: formatMoney(valores.subtotal) },
    ...(valores.desconto > 0 ? [{ label: 'Desconto', value: `- ${formatMoney(valores.desconto)}` }] : []),
    ...(valores.taxa > 0 ? [{ label: 'Taxa de entrega', value: formatMoney(valores.taxa) }] : []),
    { label: 'Total', value: formatMoney(valores.total), emphasis: true },
    { label: 'Recebido', value: formatMoney(valores.recebido) },
    ...(opcoes.pagamentos ?? []).map((pagamento) => ({
      label: `Pgto. ${pagamento.rotulo}`,
      value: formatMoney(pagamento.valorCents),
    })),
    ...(troco > 0 ? [{ label: 'Troco entregue', value: formatMoney(troco) }] : []),
    { label: 'Saldo a pagar', value: formatMoney(valores.saldo), emphasis: true },
  ]
}
