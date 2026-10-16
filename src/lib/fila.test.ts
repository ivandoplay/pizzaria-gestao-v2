import { describe, expect, it } from 'vitest'
import { detalhesDoItem, pedidoNaFila, selecionarFila } from './fila'
import type { OrderItemOverview, OrderOverview } from './types'

function pedido(campos: Partial<OrderOverview> & { id: string }): OrderOverview {
  return {
    order_number: 1,
    service_mode: 'dine_in',
    status: 'ready',
    table_session_id: 'sessao-1',
    table_id: 'mesa-1',
    table_number: 1,
    customer_id: null,
    customer_name_snapshot: null,
    customer_phone_snapshot: null,
    delivery_neighborhood: null,
    delivery_fee_cents: 0,
    delivery_notes: null,
    subtotal_cents: 0,
    discount_cents: 0,
    discount_pct: 0,
    total_cents: 0,
    paid_cents: 0,
    balance_cents: 0,
    change_given_cents: 0,
    is_cancelled: false,
    cancel_reason: null,
    notes: null,
    created_by: 'perfil-1',
    created_by_name: 'Garçom',
    created_at: '2026-10-16T18:00:00.000Z',
    ready_at: '2026-10-16T18:10:00.000Z',
    session_status: 'open',
    account_closed_at: null,
    cash_session_id: null,
    ...campos,
  }
}

function item(campos: Partial<OrderItemOverview> & { id: string }): OrderItemOverview {
  return {
    order_id: 'pedido-1',
    line_number: 1,
    product_id: 'produto-1',
    variant_id: 'variante-1',
    product_name: 'Pizza grande',
    category_name: 'Pizzas',
    size_name: 'Grande',
    quantity: 1,
    unit_base_price_cents: 0,
    modifiers_unit_cents: 0,
    unit_price_cents: 0,
    modifiers_total_cents: 0,
    total_cents: 0,
    pricing_rule: 'highest',
    notes: null,
    is_cancelled: false,
    cancel_reason: null,
    created_at: '2026-10-16T18:00:00.000Z',
    flavors: [],
    modifiers: [],
    ...campos,
  } as OrderItemOverview
}

describe('fila de prontos', () => {
  it('aceita apenas pedido pronto, de salão e com conta aberta', () => {
    expect(pedidoNaFila(pedido({ id: 'ok' }))).toBe(true)
    expect(pedidoNaFila(pedido({ id: 'preparando', status: 'preparing' }))).toBe(false)
    expect(pedidoNaFila(pedido({ id: 'recebido', status: 'received' }))).toBe(false)
    expect(pedidoNaFila(pedido({ id: 'entregue', status: 'delivered_to_table' }))).toBe(false)
    expect(
      pedidoNaFila(pedido({ id: 'delivery', service_mode: 'delivery', table_session_id: null, table_number: null })),
    ).toBe(false)
    expect(
      pedidoNaFila(pedido({ id: 'conta-fechada', account_closed_at: '2026-10-16T18:30:00.000Z' })),
    ).toBe(false)
    expect(pedidoNaFila(pedido({ id: 'sessao-fechada', session_status: 'closed' }))).toBe(false)
    // pedido antigo sem a coluna preenchida continua visível: o banco recusa se for o caso
    expect(pedidoNaFila(pedido({ id: 'sem-status-sessao', session_status: null }))).toBe(true)
  })

  it('monta a fila sem pedidos que não podem ser entregues', () => {
    const fila = selecionarFila([
      pedido({ id: 'a', order_number: 10 }),
      pedido({ id: 'b', order_number: 11, service_mode: 'delivery', table_session_id: null }),
      pedido({ id: 'c', order_number: 12, status: 'cancelled', is_cancelled: true }),
      pedido({ id: 'd', order_number: 13, status: 'delivered_to_table' }),
      pedido({ id: 'e', order_number: 14, account_closed_at: '2026-10-16T19:00:00.000Z' }),
      pedido({ id: 'f', order_number: 15, session_status: 'closed' }),
      pedido({ id: 'g', order_number: 16, status: 'preparing' }),
    ])
    expect(fila.map((p) => p.id)).toEqual(['a'])
  })

  it('ordena pelo horário em que ficou pronto, e não pelo horário do pedido', () => {
    const fila = selecionarFila([
      pedido({
        id: 'nova-mas-pronta-antes',
        order_number: 22,
        created_at: '2026-10-16T18:40:00.000Z',
        ready_at: '2026-10-16T18:41:00.000Z',
      }),
      pedido({
        id: 'antiga-mas-pronta-depois',
        order_number: 21,
        created_at: '2026-10-16T18:00:00.000Z',
        ready_at: '2026-10-16T18:55:00.000Z',
      }),
      pedido({
        id: 'mais-antiga-pronta',
        order_number: 20,
        created_at: '2026-10-16T18:30:00.000Z',
        ready_at: '2026-10-16T18:35:00.000Z',
      }),
    ])
    expect(fila.map((p) => p.id)).toEqual(['mais-antiga-pronta', 'nova-mas-pronta-antes', 'antiga-mas-pronta-depois'])
  })

  it('joga para o fim, e mantém visível, o pedido sem horário de pronto', () => {
    const fila = selecionarFila([
      pedido({ id: 'sem-horario', order_number: 1, ready_at: null }),
      pedido({ id: 'com-horario', order_number: 2, ready_at: '2026-10-16T18:20:00.000Z' }),
    ])
    expect(fila.map((p) => p.id)).toEqual(['com-horario', 'sem-horario'])
  })

  it('não deixa a tela depender da ordem em que o banco devolveu', () => {
    const fila = selecionarFila([
      pedido({ id: 'depois', order_number: 3, ready_at: '2026-10-16T18:30:00.000Z' }),
      pedido({ id: 'antes', order_number: 2, ready_at: '2026-10-16T18:10:00.000Z' }),
    ])
    expect(fila.map((p) => p.id)).toEqual(['antes', 'depois'])
  })
})

describe('detalhes do item na fila', () => {
  it('mostra tamanho, sabores, adicionais e observação sem perder nada', () => {
    const linhas = detalhesDoItem(
      item({
        id: 'item-1',
        size_name: 'Grande',
        flavors: [
          { product_id: 'p1', name: 'Calabresa', position: 1 },
          { product_id: 'p2', name: 'Marguerita', position: 2 },
        ],
        modifiers: [
          { option_name: 'Borda catupiry' },
          { option_name: 'Azeitona' },
        ] as OrderItemOverview['modifiers'],
        notes: 'sem cebola',
      }),
    )
    expect(linhas).toEqual(['Grande', 'Sabores: Calabresa + Marguerita', 'Adicionais: Borda catupiry, Azeitona', 'Obs.: sem cebola'])
  })

  it('não repete sabor único e ignora campos vazios', () => {
    const linhas = detalhesDoItem(
      item({
        id: 'item-2',
        size_name: 'Média',
        flavors: [{ product_id: 'p1', name: 'Portuguesa', position: 1 }],
        modifiers: [],
        notes: null,
      }),
    )
    expect(linhas).toEqual(['Média'])
  })

  it('não inventa detalhe quando o item é simples', () => {
    expect(detalhesDoItem(item({ id: 'item-3', size_name: '', flavors: [], modifiers: [], notes: null }))).toEqual([])
  })
})
