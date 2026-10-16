import type { OrderItemOverview, OrderOverview } from './types'

/**
 * Regras de recorte e ordenação da fila de pedidos prontos.
 *
 * Ficam aqui, fora da tela, para poderem ser testadas sem navegador. O banco é
 * quem decide de verdade (a RPC `advance_order_status` recusa entrega de pedido
 * que não está pronto, de delivery, de conta fechada ou de sessão encerrada);
 * este recorte evita oferecer na tela um botão que o banco vai recusar.
 */

/** Um pedido só entra na fila se estiver pronto, no salão e com conta aberta. */
export function pedidoNaFila(pedido: Pick<
  OrderOverview,
  'status' | 'service_mode' | 'account_closed_at' | 'session_status'
>): boolean {
  if (pedido.status !== 'ready') return false
  if (pedido.service_mode !== 'dine_in') return false
  if (pedido.account_closed_at !== null) return false
  // `session_status` ausente/nulo não derruba o pedido: pedidos antigos podem
  // não ter essa informação, e sumir da tela seria pior do que deixar o banco
  // recusar a entrega com mensagem clara.
  if (pedido.session_status !== null && pedido.session_status !== undefined && pedido.session_status !== 'open') {
    return false
  }
  return true
}

/**
 * Fila visível: elegíveis, do mais antigo pronto para o mais recente.
 *
 * A ordenação usa `ready_at` — o instante em que a produção marcou o pedido
 * como pronto. Pedidos sem horário de pronto confiável vão para o fim e são
 * exibidos como "Horário indisponível"; nunca é usada a data de criação como
 * se fosse tempo de espera.
 */
export function selecionarFila(pedidos: OrderOverview[]): OrderOverview[] {
  return pedidos
    .filter(pedidoNaFila)
    .slice()
    .sort((a, b) => {
      if (!a.ready_at && !b.ready_at) return a.order_number - b.order_number
      if (!a.ready_at) return 1
      if (!b.ready_at) return -1
      const diferenca = new Date(a.ready_at).getTime() - new Date(b.ready_at).getTime()
      return diferenca !== 0 ? diferenca : a.order_number - b.order_number
    })
}

/** Linhas de detalhe do item (tamanho, sabores, adicionais, observação). */
export function detalhesDoItem(item: OrderItemOverview): string[] {
  const linhas: string[] = []
  if (item.size_name) linhas.push(item.size_name)
  if (item.flavors.length > 1) linhas.push(`Sabores: ${item.flavors.map((f) => f.name).join(' + ')}`)
  if (item.modifiers.length > 0)
    linhas.push(`Adicionais: ${item.modifiers.map((m) => m.option_name).join(', ')}`)
  if (item.notes) linhas.push(`Obs.: ${item.notes}`)
  return linhas
}
