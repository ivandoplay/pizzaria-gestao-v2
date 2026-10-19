import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import {
  invalidateOrderData,
  useMenu,
  useOrderItems,
  useOrders,
  usePaymentMethods,
  usePayments,
  useSettings,
  useStatusHistory,
  useTables,
} from '../lib/hooks'
import * as api from '../lib/api'
import { OrderComposer, type MenuData } from '../components/OrderComposer'
import { useChaveIdempotente } from '../lib/idempotencia'
import { empresaDoRecibo, linhasRecibo } from '../lib/recibo'
import { PaymentModal } from '../components/PaymentPanel'
import { DiscountDialog } from '../components/DiscountDialog'
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusPill,
  useToast,
} from '../components/ui'
import { Icon } from '../components/icons'
import { duracaoDesde, formatDateTime, formatMoney, formatTime, plural } from '../lib/format'
import { codigoDoErro, erroSemCodigo, translateError } from '../lib/errors'
import { ORDER_STATUS_LABELS, TABLE_STATUS_LABELS, type CartItem, type OrderItemOverview, type OrderOverview, type OrderStatus } from '../lib/types'

export default function TableSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const { profile, isAdmin, isManager, isWaiter } = useAuth()

  const tables = useTables()
  const menu = useMenu()
  const settings = useSettings()
  const orders = useOrders({ sessionId, limit: 100 })
  const metodos = usePaymentMethods(true)

  const [cart, setCart] = useState<CartItem[]>([])
  const [sending, setSending] = useState(false)
  const [paymentOrder, setPaymentOrder] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeDialog, setCloseDialog] = useState<{ reason: string } | null>(null)
  const [statusModalOrder, setStatusModalOrder] = useState<string | null>(null)
  const [cancelItem, setCancelItem] = useState<{ id: string; label: string } | null>(null)
  const [cancelarPedido, setCancelarPedido] = useState<{ id: string; numero: number } | null>(null)
  const [descontoPedido, setDescontoPedido] = useState<OrderOverview | null>(null)
  const [motivoDoCancelamento, setMotivoDoCancelamento] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [agora, setAgora] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const tableRow = tables.data?.find((table) => table.open_session_id === sessionId) ?? null
  const orderList = useMemo(() => orders.data ?? [], [orders.data])
  const orderIds = useMemo(() => orderList.map((order) => order.id), [orderList])
  /** Pedido cuja janela de recebimento está aberta (valores crus, sem subtração). */
  const pedidoEmPagamento = useMemo(
    () => (paymentOrder ? orderList.find((order) => order.id === paymentOrder) ?? null : null),
    [orderList, paymentOrder],
  )

  const sessionOrders = orderList.filter((order) => !order.is_cancelled)
  const itemsQuery = useOrderItems(orderIds)
  const items = itemsQuery.data ?? []
  const payments = usePayments(orderIds)
  const history = useStatusHistory(statusModalOrder ? [statusModalOrder] : [])

  const activeSession = tableRow?.status !== 'available' && tableRow?.open_session_id === sessionId
  const totals = {
    subtotal: sessionOrders.reduce((soma, order) => soma + order.subtotal_cents, 0),
    discount: sessionOrders.reduce((soma, order) => soma + order.discount_cents, 0),
    total: sessionOrders.reduce((soma, order) => soma + order.total_cents, 0),
    paid: sessionOrders.reduce((soma, order) => soma + order.paid_cents, 0),
    change: sessionOrders.reduce((soma, order) => soma + order.change_given_cents, 0),
  }
  const balance = Math.max(totals.total - totals.paid, 0)
  /**
   * Dinheiro nesta tela — regra de 16/10/2026 (pedido do administrador):
   *  · o GARÇOM vê o valor da conta, registra o recebimento e fecha a conta
   *    quitada (quem confere é o banco: migração 0011);
   *  · fechar conta com SALDO PENDENTE (excepcional) e ver o agregado do salão
   *    seguem exclusivos do administrador;
   *  · estorno e desconto continuam com caixa e administrador.
   * Preço de item do cardápio sempre apareceu para todos (é o preço do menu).
   */
  const podeFecharConta = isManager || isWaiter
  const podeReceberNaMesa = isManager || isWaiter
  const nomeMetodo = (id: string) => metodos.data?.find((metodo) => metodo.id === id)?.label ?? 'forma não identificada'
  const itensAtivos = items.filter((item) => !item.is_cancelled)

  /**
   * Pendência operacional: pedido que ainda exige ação da equipe. Enquanto
   * houver um destes, o banco recusa o fechamento normal (migração 0012) —
   * a tela antecipa a regra em vez de deixar o operador descobrir no clique.
   */
  const pedidosAguardando = orderList.filter((order) =>
    ['received', 'confirmed', 'preparing'].includes(order.status),
  )
  const pedidosProntos = orderList.filter((order) => order.status === 'ready')
  const pedidosPendentes = pedidosAguardando.length + pedidosProntos.length
  const pedidosEntregues = orderList.filter((order) => order.status === 'delivered_to_table').length
  const pedidosCancelados = orderList.filter((order) => order.status === 'cancelled').length
  const emProducao = sessionOrders.filter((order) =>
    ['received', 'confirmed', 'preparing', 'ready'].includes(order.status),
  ).length

  /**
   * Chave da operação de envio: muda quando o CARRINHO muda (outra operação),
   * não a cada clique. Assim, se a resposta se perder na rede e o operador
   * tentar de novo, o banco reconhece a mesma chave e devolve o MESMO pedido —
   * em vez de criar um segundo.
   */
  const assinaturaDoPedido = useMemo(
    () =>
      JSON.stringify(
        cart.map((item) => [item.key, item.quantity, item.notes, item.modifier_option_ids, item.flavor_product_ids]),
      ),
    [cart],
  )
  const { chave: chaveDoPedido, renovar: renovarChaveDoPedido } = useChaveIdempotente(assinaturaDoPedido)

  async function handleSendOrder() {
    if (!sessionId || cart.length === 0) return
    setSending(true)
    try {
      const payload = {
        service_mode: 'dine_in' as const,
        table_session_id: sessionId,
        items: cart.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: item.quantity,
          notes: item.notes || undefined,
          flavor_product_ids: item.flavor_product_ids,
          modifier_option_ids: item.modifier_option_ids,
        })),
      }
      const order = await api.createOrder(payload, chaveDoPedido)
      const numero = (order as unknown as { order_number: number }).order_number
      toast.success(`Pedido #${numero} enviado para a produção.`)
      setCart([])
      renovarChaveDoPedido()
      invalidateOrderData(queryClient)
    } catch (error) {
      if (erroSemCodigo(error)) {
        // Sem resposta do servidor não se sabe se gravou. A chave é a mesma,
        // então repetir é seguro — e isso precisa ser dito, não escondido.
        toast.error(
          'Não foi possível confirmar o envio. Se o pedido já tiver sido registrado, ele não será duplicado — confira a lista de pedidos e use “Enviar” de novo se não aparecer.',
        )
        void orders.refetch()
      } else {
        toast.error(translateError(error))
      }
    } finally {
      setSending(false)
    }
  }

  /**
   * Cancelar PEDIDO exige motivo (o banco recusa sem ele: REASON_REQUIRED).
   * Por isso "Cancelado" não muda de situação direto: abre a janela de motivo,
   * como no cancelamento de item.
   */
  async function handleStatusChange(orderId: string, status: OrderStatus, motivo?: string) {
    setBusy(true)
    try {
      await api.advanceOrderStatus(orderId, status, motivo)
      toast.success(`Pedido atualizado para “${ORDER_STATUS_LABELS[status]}”.`)
      invalidateOrderData(queryClient)
      setStatusModalOrder(null)
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function confirmarCancelamentoDoPedido() {
    if (!cancelarPedido) return
    setBusy(true)
    try {
      await api.advanceOrderStatus(cancelarPedido.id, 'cancelled', motivoDoCancelamento.trim())
      toast.success('Pedido cancelado. Ele continua no histórico, com motivo e responsável.')
      invalidateOrderData(queryClient)
      setCancelarPedido(null)
      setMotivoDoCancelamento('')
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function confirmCancelItem() {
    if (!cancelItem) return
    setBusy(true)
    try {
      await api.cancelOrderItem(cancelItem.id, cancelReason.trim())
      toast.success('Item cancelado. O valor da conta foi recalculado.')
      invalidateOrderData(queryClient)
      setCancelItem(null)
      setCancelReason('')
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleCloseAccount(force: boolean) {
    if (!sessionId) return
    setClosing(true)
    try {
      const result = (await api.closeTableAccount(sessionId, {
        force,
        reason: closeDialog?.reason || undefined,
      })) as { balance_cents: number; orders_cancelled_on_close?: number }
      const cancelados = result.orders_cancelled_on_close ?? 0
      if (result.balance_cents > 0) {
        toast.success(
          `Conta encerrada com saldo pendente de ${formatMoney(result.balance_cents)} — registrado na auditoria.`,
        )
      } else if (cancelados > 0) {
        toast.success(
          `Conta encerrada e ${plural(cancelados, 'pedido cancelado', 'pedidos cancelados')} com a sua justificativa — a mesa foi liberada.`,
        )
      } else {
        toast.success('Conta fechada e mesa liberada para o próximo atendimento.')
      }
      invalidateOrderData(queryClient)
      setCloseDialog(null)
      navigate('/mesas')
    } catch (error) {
      // Outro operador fechou a mesma conta no meio do caminho: o resultado que
      // o operador queria (mesa livre) já é verdade — não é erro para ele.
      if (codigoDoErro(error) === 'SESSION_NOT_OPEN') {
        toast.info('Este atendimento já tinha sido encerrado por outro usuário. A mesa foi liberada.')
        invalidateOrderData(queryClient)
        setCloseDialog(null)
        navigate('/mesas')
        return
      }
      toast.error(translateError(error))
    } finally {
      setClosing(false)
    }
  }

  /** Comanda de produção: o que a cozinha precisa saber, item por item. */
  function imprimirComanda(order: OrderOverview) {
    const itensDoPedido = items.filter((item) => item.order_id === order.id && !item.is_cancelled)
    api.printReceipt({
      title: 'Comanda de produção',
      empresa: empresaDoRecibo(settings.data),
      subtitle: `${tableRow?.name ?? `Mesa ${tableRow?.number ?? ''}`} · pedido #${order.order_number}`,
      lines: [
        { label: 'Abertura', value: formatDateTime(tableRow?.opened_at ?? order.created_at) },
        { label: 'Lançado por', value: order.created_by_name },
        { label: 'Situação', value: ORDER_STATUS_LABELS[order.status], emphasis: true },
        { label: 'Pessoas na mesa', value: String(tableRow?.guest_count ?? '—') },
      ],
      items: itensDoPedido.map((item) => itemParaImpressao(item)),
      footer: 'Conferir a mesa antes de entregar.',
    })
  }

  /** Recibo do cliente com o total da conta e os recebimentos registrados. */
  function imprimirRecibo(order?: OrderOverview) {
    const itens = order ? items.filter((item) => item.order_id === order.id && !item.is_cancelled) : itensAtivos
    const pedidos = order ? [order] : sessionOrders
    const recebimentos = (payments.data ?? []).filter(
      (payment) => payment.status === 'confirmed' && pedidos.some((pedido) => pedido.id === payment.order_id),
    )
    const troco = recebimentos.reduce((soma, payment) => soma + payment.change_cents, 0)

    api.printReceipt({
      title: 'Recibo do cliente',
      empresa: empresaDoRecibo(settings.data),
      subtitle: `${tableRow?.name ?? `Mesa ${tableRow?.number ?? ''}`} · atendimento aberto em ${formatTime(tableRow?.opened_at)}`,
      // Os valores saem SEMPRE dos pedidos que vão no papel (`pedidos`):
      // imprimir um pedido não pode mostrar o subtotal da conta inteira.
      lines: [
        { label: 'Pedidos', value: pedidos.map((pedido) => `#${pedido.order_number}`).join(', ') },
        ...linhasRecibo(pedidos, {
          trocoCents: troco,
          pagamentos: recebimentos.map((payment) => ({
            rotulo: nomeMetodo(payment.method_id),
            valorCents: payment.amount_cents,
          })),
        }),
      ],
      items: itens.map((item) => itemParaImpressao(item)),
      footer: 'Documento não fiscal. Obrigado pela preferência!',
    })
  }

  if (tables.isLoading || menu.isLoading || settings.isLoading) {
    return <LoadingBlock label="Carregando o atendimento…" linhas={6} />
  }
  if (tables.error) return <ErrorBlock message={translateError(tables.error)} onRetry={() => void tables.refetch()} />
  if (!tableRow || !sessionId) {
    return (
      <div className="space-y-4">
        <PageHeader
          titulo="Atendimento não encontrado"
          descricao="A mesa pode já ter sido fechada por outro usuário. Os pedidos continuam disponíveis no histórico."
        />
        <Button variant="secondary" icone="seta-esquerda" onClick={() => navigate('/mesas')}>
          Voltar para as mesas
        </Button>
      </div>
    )
  }

  const menuData: MenuData = {
    categories: menu.data?.categories ?? [],
    products: menu.data?.products ?? [],
    sizes: menu.data?.sizes ?? [],
    variants: menu.data?.variants ?? [],
    groups: menu.data?.groups ?? [],
    options: menu.data?.options ?? [],
    links: menu.data?.links ?? [],
  }

  const itemsByOrder = new Map<string, OrderItemOverview[]>()
  for (const item of items) {
    const lista = itemsByOrder.get(item.order_id) ?? []
    lista.push(item)
    itemsByOrder.set(item.order_id, lista)
  }

  const totalCart = cart.reduce((soma, item) => soma + item.preview.unit_price_cents * item.quantity, 0)
  const quantidadeCart = cart.reduce((soma, item) => soma + item.quantity, 0)

  return (
    <div>
      <PageHeader
        titulo={tableRow.name ?? `Mesa ${tableRow.number}`}
        descricao={`Aberta em ${formatTime(tableRow.opened_at)} (${duracaoDesde(tableRow.opened_at, agora)}) · ${
          tableRow.opened_by_name ?? 'sem responsável'
        }${tableRow.guest_count ? ` · ${plural(tableRow.guest_count, 'pessoa', 'pessoas')}` : ''}`}
        selo={
          <Badge
            tone={tableRow.status === 'attention' ? 'red' : tableRow.status === 'occupied' ? 'amber' : 'blue'}
            ponto
          >
            {TABLE_STATUS_LABELS[tableRow.status]}
          </Badge>
        }
        voltar={
          <IconButton
            nome="seta-esquerda"
            titulo="Voltar para as mesas"
            variant="secondary"
            onClick={() => navigate('/mesas')}
          />
        }
        acoes={
          <>
            <IconButton
              nome="atualizar"
              titulo="Atualizar agora"
              variant="secondary"
              onClick={() => {
                invalidateOrderData(queryClient)
                void tables.refetch()
              }}
            />
            <Button variant="secondary" icone="imprimir" onClick={() => imprimirRecibo()} disabled={itensAtivos.length === 0}>
              Recibo
            </Button>
            {podeFecharConta && (
              <Button
                variant={balance > 0 || pedidosPendentes > 0 ? 'secondary' : 'success'}
                icone={balance > 0 ? 'dinheiro' : 'check'}
                onClick={() => setCloseDialog({ reason: '' })}
                disabled={!activeSession}
              >
                {orderList.length === 0
                  ? 'Encerrar atendimento'
                  : balance > 0
                    ? 'Fechar conta'
                    : 'Fechar conta e liberar'}
              </Button>
            )}
          </>
        }
      />

      {!activeSession && (
        <div className="mb-4">
          <Callout tom="atencao" titulo="Atendimento encerrado">
            Esta mesa já foi liberada. Os pedidos continuam disponíveis no histórico, mas novos itens não podem ser
            lançados.
          </Callout>
        </div>
      )}

      {/* Resumo da conta: o valor de CADA conta é de todo mundo — o garçom
          recebe e fecha na mesa (16/10/2026). O total do salão (soma de todas as
          contas) continua sendo só do administrador, na tela de Mesas.

          No celular a faixa é compacta (2×2): quatro cartões grandes empurravam
          a conta para 7.600 px de rolagem — o garçom precisava arrastar a tela
          meia dúzia de vezes só para ver o primeiro pedido. */}
      <FaixaDaConta
        pedidos={sessionOrders.length}
        itens={itensAtivos.length}
        total={totals.total}
        recebido={totals.paid}
        troco={totals.change}
        saldo={balance}
        emProducao={emProducao}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* Pedidos do atendimento */}
        <Card
          title="Pedidos do atendimento"
          descricao="Atualiza sozinho a cada lançamento ou alteração."
          icone="historico"
          actions={<Badge tone="slate">{sessionOrders.length}</Badge>}
          padded={false}
          className="min-w-0"
        >
          <div className="p-3 sm:p-4">
            {orders.isLoading ? (
              <LoadingBlock label="Carregando pedidos…" linhas={4} />
            ) : orderList.length === 0 ? (
              <EmptyState
                icone="cardapio"
                title="Nenhum pedido lançado ainda"
                description="Monte o pedido ao lado e envie para a produção — ele aparece aqui na hora."
              />
            ) : (
              <ul className="space-y-3">
                {orderList.map((order) => {
                  const itensDoPedido = itemsByOrder.get(order.id) ?? []
                  const pagamentosDoPedido = (payments.data ?? []).filter(
                    (payment) => payment.order_id === order.id,
                  )
                  return (
                    <li
                      key={order.id}
                      className={`relative overflow-hidden rounded-card border shadow-card ${
                        order.is_cancelled ? 'border-red-200 bg-red-50/60' : 'border-ink-200 bg-white'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`absolute inset-y-0 left-0 w-[3px] ${faixaDoPedido(order.status, order.is_cancelled)}`}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3.5 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-ink-900">#{order.order_number}</span>
                          <StatusPill status={order.status} />
                          {order.account_closed_at && <Badge tone="slate">conta fechada</Badge>}
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          <span className="text-[11px] text-ink-500">
                            {formatTime(order.created_at)} · {order.created_by_name}
                          </span>
                          <span className="num text-sm font-semibold text-ink-900">
                            {formatMoney(order.total_cents)}
                          </span>
                        </div>
                      </div>

                      <ul className="divide-y divide-ink-100">
                        {itensDoPedido.map((item) => (
                          <li
                            key={item.id}
                            className={`flex items-start justify-between gap-3 px-3.5 py-2.5 text-[13px] ${
                              item.is_cancelled ? 'bg-ink-50/50 text-ink-400' : 'text-ink-700'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className={item.is_cancelled ? 'line-through' : ''}>
                                <span className="num font-semibold text-ink-900">{item.quantity}×</span>{' '}
                                <span className="font-medium">{item.product_name}</span>
                                <span className="text-ink-500"> ({item.size_name})</span>
                              </p>
                              {item.flavors.length > 1 && (
                                <p className="text-[11px] text-ink-500">
                                  Sabores: {item.flavors.map((flavor) => flavor.name).join(' + ')}
                                </p>
                              )}
                              {item.modifiers.length > 0 && (
                                <p className="text-[11px] text-ink-500">
                                  {item.modifiers.map((modifier) => modifier.option_name).join(', ')}
                                </p>
                              )}
                              {item.notes && <p className="text-[11px] italic text-ink-500">“{item.notes}”</p>}
                              {item.is_cancelled && item.cancel_reason && (
                                <p className="text-[11px] font-medium text-red-600">
                                  cancelado: {item.cancel_reason}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
                              <span className="num">{formatMoney(item.total_cents)}</span>
                              {isManager && !item.is_cancelled && !order.account_closed_at && (
                                <IconButton
                                  nome="lixeira"
                                  titulo="Cancelar este item"
                                  size="sm"
                                  variant="ghost"
                                  className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                                  onClick={() =>
                                    setCancelItem({ id: item.id, label: `${item.quantity}× ${item.product_name}` })
                                  }
                                />
                              )}
                            </div>
                          </li>
                        ))}
                        {itensDoPedido.length === 0 && (
                          <li className="px-3.5 py-2.5 text-xs text-ink-500">Itens não disponíveis para consulta.</li>
                        )}
                      </ul>

                      {order.discount_cents > 0 && (
                        <div className="border-t border-ink-100 bg-amber-50/70 px-3.5 py-2 text-[11px] font-medium text-amber-800">
                          Desconto aplicado: −{formatMoney(order.discount_cents)}
                        </div>
                      )}

                      {pagamentosDoPedido.length > 0 && (
                        <div className="border-t border-ink-100 bg-ink-50/60 px-3.5 py-2 text-[11px] text-ink-600">
                          Recebimentos:{' '}
                          {pagamentosDoPedido
                            .map(
                              (payment) =>
                                `${formatMoney(payment.amount_cents)} em ${nomeMetodo(payment.method_id)}${
                                  payment.status === 'reversed' ? ' (estornado)' : ''
                                }`,
                            )
                            .join(' · ')}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-3.5 py-2.5">
                        <Button size="sm" variant="secondary" icone="relogio" onClick={() => setStatusModalOrder(order.id)}>
                          Situação
                        </Button>
                        <Button size="sm" variant="secondary" icone="imprimir" onClick={() => imprimirComanda(order)}>
                          Comanda
                        </Button>
                        {isManager && !order.account_closed_at && !order.is_cancelled && order.subtotal_cents > 0 && (
                          <Button size="sm" variant="ghost" icone="menos" onClick={() => setDescontoPedido(order)}>
                            Desconto
                          </Button>
                        )}
                        {podeReceberNaMesa && !order.account_closed_at && !order.is_cancelled && (
                          <Button size="sm" icone="dinheiro" onClick={() => setPaymentOrder(order.id)}>
                            Receber
                          </Button>
                        )}
                        {order.account_closed_at && (
                          <span className="text-[11px] text-emerald-700">
                            Conta fechada em {formatDateTime(order.account_closed_at)}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* Novo pedido */}
        <div className="min-w-0 space-y-4">
          {activeSession && profile ? (
            <>
              <Card title="Novo pedido" descricao="Monte os itens e envie para a produção." icone="pizza" padded={false}>
                <div className="p-3 sm:p-4">
                  <OrderComposer
                    menu={menuData}
                    halfRule={settings.data?.half_and_half_price_rule ?? 'highest'}
                    items={cart}
                    onChange={setCart}
                    disabled={sending}
                    empilhado
                  />
                </div>
              </Card>

              {/* No celular a barra é FINA e só aparece quando há item na lista:
                  a versão alta ficava parada na frente do cardápio e o garçom
                  não enxergava os produtos enquanto escolhia. No computador há
                  espaço de sobra, então a versão completa continua. */}
              <div
                className={`sticky bottom-20 z-10 items-center gap-3 rounded-card border border-ink-200 bg-white p-3 shadow-float lg:bottom-4 ${
                  cart.length === 0 ? 'hidden lg:flex' : 'flex'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="num text-base font-semibold text-ink-900 lg:text-lg">{formatMoney(totalCart)}</p>
                  <p className="truncate text-[11px] text-ink-500">
                    {plural(quantidadeCart, 'item', 'itens')} em {plural(cart.length, 'linha', 'linhas')}
                  </p>
                </div>
                <Button
                  size="md"
                  className="shrink-0 lg:h-12 lg:px-5 lg:text-base"
                  icone="seta-direita"
                  onClick={handleSendOrder}
                  loading={sending}
                  disabled={cart.length === 0}
                >
                  Enviar pedido para a produção
                </Button>
              </div>
            </>
          ) : (
            <Card title="Atendimento encerrado" icone="cadeado">
              <p className="text-sm text-ink-600">
                Esta mesa foi liberada. Para lançar novos itens, inicie um novo atendimento no mapa de mesas.
              </p>
              <Button className="mt-3" variant="secondary" icone="mesas" onClick={() => navigate('/mesas')}>
                Ir para as mesas
              </Button>
            </Card>
          )}
        </div>
      </div>

      {/* Registrar pagamento */}
      {pedidoEmPagamento && (
        <PaymentModal
          orderId={pedidoEmPagamento.id}
          orderNumber={pedidoEmPagamento.order_number}
          totalCents={pedidoEmPagamento.total_cents}
          paidCents={pedidoEmPagamento.paid_cents}
          descricaoPedido={`${tableRow.name ?? `Mesa ${tableRow.number}`} · ${TABLE_STATUS_LABELS[tableRow.status]}`}
          onClose={() => setPaymentOrder(null)}
          onImprimirRecibo={() => {
            setTimeout(() => imprimirRecibo(pedidoEmPagamento), 150)
          }}
        />
      )}

      {/* Desconto no pedido */}
      <DiscountDialog
        pedido={descontoPedido}
        limitePct={
          isAdmin
            ? settings.data?.max_discount_pct_hard ?? 0
            : settings.data?.max_discount_pct_without_auth ?? 0
        }
        onClose={() => setDescontoPedido(null)}
        onSaved={() => invalidateOrderData(queryClient)}
      />

      {/* Acompanhamento da situação */}
      <Modal
        open={Boolean(statusModalOrder)}
        title="Acompanhamento do pedido"
        descricao={
          statusModalOrder
            ? `Pedido #${orderList.find((order) => order.id === statusModalOrder)?.order_number ?? ''} — cada mudança fica registrada com autor e horário.`
            : undefined
        }
        onClose={() => setStatusModalOrder(null)}
        size="md"
      >
        {statusModalOrder && (
          <div className="space-y-5">
            <div>
              <p className="rotulo mb-2">Próximo passo permitido</p>
              <div className="flex flex-wrap gap-2">
                {buildAllowedTransitions(
                  orderList.find((order) => order.id === statusModalOrder)?.status ?? 'received',
                  profile?.role ?? 'waiter',
                ).map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={status === 'cancelled' ? 'danger' : 'primary'}
                    loading={busy}
                    onClick={() => {
                      if (status === 'cancelled') {
                        const alvo = orderList.find((order) => order.id === statusModalOrder)
                        setStatusModalOrder(null)
                        setCancelarPedido({ id: statusModalOrder, numero: alvo?.order_number ?? 0 })
                        return
                      }
                      void handleStatusChange(statusModalOrder, status)
                    }}
                  >
                    Marcar como {ORDER_STATUS_LABELS[status]}
                  </Button>
                ))}
                {buildAllowedTransitions(
                  orderList.find((order) => order.id === statusModalOrder)?.status ?? 'received',
                  profile?.role ?? 'waiter',
                ).length === 0 && (
                  <p className="text-sm text-ink-500">
                    {profile?.role === 'waiter'
                      ? 'Você (garçom) confirma a entrega apenas quando o pedido está pronto. O preparo é conduzido pelo caixa.'
                      : 'Nenhuma mudança disponível para esta situação.'}
                  </p>
                )}
              </div>
            </div>

            <div>
              <p className="rotulo mb-2">Histórico de mudanças</p>
              {history.isLoading ? (
                <LoadingBlock label="Carregando histórico…" linhas={2} />
              ) : (history.data ?? []).length === 0 ? (
                <p className="text-sm text-ink-500">Nenhuma mudança registrada ainda.</p>
              ) : (
                <ol className="relative space-y-3 border-l border-ink-200 pl-4">
                  {(history.data ?? []).map((entry) => (
                    <li key={entry.id} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                      <p className="text-[13px] font-medium text-ink-800">
                        {entry.from_status
                          ? `${ORDER_STATUS_LABELS[entry.from_status as OrderStatus]} → ${ORDER_STATUS_LABELS[entry.to_status as OrderStatus]}`
                          : ORDER_STATUS_LABELS[entry.to_status as OrderStatus]}
                      </p>
                      <p className="text-[11px] text-ink-500">
                        {formatDateTime(entry.changed_at)}
                        {entry.notes ? ` · ${entry.notes}` : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Cancelar item */}
      <ConfirmDialog
        open={Boolean(cancelItem)}
        title="Cancelar item da conta"
        confirmLabel="Confirmar cancelamento"
        tone="danger"
        loading={busy}
        onCancel={() => {
          setCancelItem(null)
          setCancelReason('')
        }}
        onConfirm={confirmCancelItem}
        message={
          <div className="space-y-3">
            <p>
              Item: <strong>{cancelItem?.label}</strong>
            </p>
            <Field label="Motivo do cancelamento" obrigatorio hint="Mínimo de 3 caracteres.">
              <Input
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="ex.: cliente desistiu, item lançado errado"
                autoFocus
              />
            </Field>
            <Callout tom="info">
              O item não é apagado: fica marcado como cancelado com motivo, responsável e horário, e o total da conta
              é recalculado.
            </Callout>
          </div>
        }
      />

      {/* Cancelar pedido inteiro (o banco exige motivo) */}
      <ConfirmDialog
        open={Boolean(cancelarPedido)}
        title="Cancelar pedido"
        confirmLabel="Confirmar cancelamento"
        tone="danger"
        loading={busy}
        onCancel={() => {
          setCancelarPedido(null)
          setMotivoDoCancelamento('')
        }}
        onConfirm={confirmarCancelamentoDoPedido}
        message={
          <div className="space-y-3">
            <p>
              Pedido <strong>#{cancelarPedido?.numero}</strong> — todos os itens dele saem da conta.
            </p>
            <Field label="Motivo do cancelamento" obrigatorio hint="Mínimo de 3 caracteres.">
              <Input
                value={motivoDoCancelamento}
                onChange={(event) => setMotivoDoCancelamento(event.target.value)}
                placeholder="ex.: cliente desistiu, pedido lançado errado"
                autoFocus
              />
            </Field>
            <Callout tom="info">
              O pedido não é apagado: fica cancelado com motivo, responsável e horário, e o total da conta é
              recalculado. Se já houver dinheiro recebido, o sistema pede o estorno antes.
            </Callout>
          </div>
        }
      />

      {/* Fechamento da conta */}
      <Modal
        open={Boolean(closeDialog)}
        title="Fechar conta da mesa"
        descricao={tableRow.name ?? `Mesa ${tableRow.number}`}
        onClose={() => setCloseDialog(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloseDialog(null)} disabled={closing}>
              Voltar
            </Button>
            {isAdmin && (balance > 0 || pedidosPendentes > 0) && (
              <Button
                variant="danger"
                loading={closing}
                onClick={() => handleCloseAccount(true)}
                disabled={!closeDialog?.reason || closeDialog.reason.trim().length < 3}
              >
                {pedidosPendentes > 0
                  ? `Fechar e cancelar ${plural(pedidosPendentes, 'pedido', 'pedidos')}`
                  : 'Fechar com saldo (excepcional)'}
              </Button>
            )}
            <Button
              variant="success"
              icone="check"
              loading={closing}
              disabled={balance > 0 || pedidosPendentes > 0}
              onClick={() => handleCloseAccount(false)}
            >
              {orderList.length === 0 ? 'Encerrar sem consumo' : 'Confirmar fechamento'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-card border border-ink-200 bg-ink-50/60 p-4">
            <Linha rotulo="Subtotal" valor={formatMoney(totals.subtotal)} />
            <Linha rotulo="Descontos" valor={`- ${formatMoney(totals.discount)}`} />
            <Linha rotulo="Total" valor={formatMoney(totals.total)} destaque />
            <Linha rotulo="Recebido" valor={formatMoney(totals.paid)} />
            {totals.change > 0 && <Linha rotulo="Troco entregue" valor={formatMoney(totals.change)} />}
            <div className="mt-1 border-t border-ink-200 pt-1">
              <Linha
                rotulo={balance > 0 ? 'Falta receber' : 'Conta quitada'}
                valor={formatMoney(balance)}
                destaque
                cor={balance > 0 ? 'text-brand-700' : 'text-emerald-700'}
              />
            </div>
          </div>

          {/* Situação operacional: o que ainda depende da equipe nesta mesa. */}
          <div className="rounded-card border border-ink-200 bg-white p-4">
            <p className="rotulo mb-2">Pedidos deste atendimento</p>
            <Linha rotulo="Em produção" valor={String(pedidosAguardando.length)} />
            <Linha rotulo="Prontos aguardando entrega" valor={String(pedidosProntos.length)} />
            <Linha rotulo="Entregues à mesa" valor={String(pedidosEntregues)} />
            <Linha rotulo="Cancelados" valor={String(pedidosCancelados)} />
          </div>

          {pedidosPendentes > 0 ? (
            <div className="space-y-3">
              <Callout tom="erro" titulo="Ainda há pedido em andamento nesta mesa">
                {plural(pedidosPendentes, 'pedido', 'pedidos')} ainda
                {pedidosPendentes === 1 ? ' precisa' : ' precisam'} de ação:{' '}
                {pedidosProntos.length > 0
                  ? 'entregue o que já está pronto em “Pedidos prontos”'
                  : 'acompanhe a produção (o preparo é conduzido pelo caixa)'}{' '}
                ou cancele o pedido com motivo. O banco recusa fechar a conta — e a mesa não é liberada — enquanto
                isso não for resolvido: sem essa trava, o pedido ficaria impossível de entregar depois.
              </Callout>
              {isAdmin && (
                <Field
                  label="Justificativa do fechamento excepcional"
                  obrigatorio
                  hint="Mínimo de 3 caracteres. Os pedidos pendentes serão cancelados com este motivo."
                >
                  <Input
                    value={closeDialog?.reason ?? ''}
                    onChange={(event) => setCloseDialog({ reason: event.target.value })}
                    placeholder="ex.: cliente foi embora durante o preparo"
                  />
                </Field>
              )}
            </div>
          ) : balance > 0 ? (
            <div className="space-y-3">
              <Callout tom="atencao" titulo="Ainda há saldo pendente">
                Registre os recebimentos antes de fechar: o banco recusa fechar conta com saldo. O fechamento
                excepcional é exclusivo do administrador e fica gravado na auditoria.
              </Callout>
              {isAdmin && (
                <Field label="Justificativa do fechamento excepcional" obrigatorio hint="Mínimo de 3 caracteres.">
                  <Input
                    value={closeDialog?.reason ?? ''}
                    onChange={(event) => setCloseDialog({ reason: event.target.value })}
                    placeholder="ex.: cliente saiu sem pagar o restante"
                  />
                </Field>
              )}
            </div>
          ) : orderList.length === 0 ? (
            <Callout tom="info" titulo="Nenhum pedido lançado">
              Esta mesa foi aberta mas não consumiu nada. Encerrar libera a mesa para o próximo cliente, sem
              movimentar o caixa — e o encerramento fica registrado na auditoria.
            </Callout>
          ) : (
            <p className="text-xs text-ink-500">
              Ao confirmar, os pedidos ficam com a conta encerrada e a mesa é liberada para o próximo atendimento.
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}

/** Faixa de 3 px do cartão do pedido — a mesma linguagem da tela de Mesas. */
function faixaDoPedido(status: OrderStatus, cancelado: boolean) {
  if (cancelado) return 'bg-red-400'
  const cores: Partial<Record<OrderStatus, string>> = {
    received: 'bg-ink-300',
    confirmed: 'bg-sky-400',
    preparing: 'bg-amber-400',
    ready: 'bg-emerald-500',
    delivered_to_table: 'bg-emerald-300',
    out_for_delivery: 'bg-sky-400',
    delivered: 'bg-emerald-300',
  }
  return cores[status] ?? 'bg-ink-300'
}

/**
 * Resumo da conta em duas versões: faixa compacta 2×2 no celular (o garçom vê
 * tudo de um lance, sem rolar a tela) e quatro quadros no computador, onde há
 * largura de sobra. São os MESMOS números — muda só a apresentação.
 */
function FaixaDaConta({
  pedidos,
  itens,
  total,
  recebido,
  troco,
  saldo,
  emProducao,
}: {
  pedidos: number
  itens: number
  total: number
  recebido: number
  troco: number
  saldo: number
  emProducao: number
}) {
  const celulas = [
    { rotulo: 'Total da conta', valor: formatMoney(total), cor: 'text-ink-900', ponto: 'bg-brand-500' },
    { rotulo: 'Recebido', valor: formatMoney(recebido), cor: 'text-emerald-700', ponto: 'bg-emerald-500' },
    {
      rotulo: saldo > 0 ? 'Falta receber' : 'Conta quitada',
      valor: formatMoney(saldo),
      cor: saldo > 0 ? 'text-brand-700' : 'text-emerald-700',
      ponto: saldo > 0 ? 'bg-brand-500' : 'bg-emerald-500',
    },
    {
      rotulo: 'Em produção',
      valor: String(emProducao),
      cor: emProducao > 0 ? 'text-amber-700' : 'text-ink-900',
      ponto: emProducao > 0 ? 'bg-amber-500' : 'bg-ink-300',
    },
  ]
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2 lg:hidden">
        {celulas.map((celula) => (
          <div key={celula.rotulo} className="rounded-card border border-ink-200 bg-white px-3 py-2 shadow-card">
            <p className="flex items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${celula.ponto}`} />
              {celula.rotulo}
            </p>
            <p className={`num mt-0.5 truncate text-[17px] font-semibold leading-tight ${celula.cor}`}>{celula.valor}</p>
          </div>
        ))}
        <p className="col-span-2 -mt-0.5 px-1 text-[11px] text-ink-500">
          {plural(pedidos, 'pedido', 'pedidos')} · {plural(itens, 'item', 'itens')}
          {troco > 0 ? ` · troco ${formatMoney(troco)}` : ''}
          {saldo > 0 ? ' · registre o pagamento antes de fechar' : ''}
        </p>
      </div>

      <div className="mb-4 hidden gap-3 lg:grid lg:grid-cols-4">
        <Resumo rotulo="Total da conta" valor={formatMoney(total)} detalhe={`${plural(pedidos, 'pedido', 'pedidos')} · ${plural(itens, 'item', 'itens')}`} icone="dinheiro" />
        <Resumo rotulo="Recebido" valor={formatMoney(recebido)} detalhe={troco > 0 ? `troco ${formatMoney(troco)}` : 'sem troco registrado'} icone="check" tom="verde" />
        <Resumo rotulo="Falta receber" valor={formatMoney(saldo)} detalhe={saldo > 0 ? 'registre o pagamento antes de fechar' : 'conta quitada'} icone="relogio" tom={saldo > 0 ? 'marca' : 'verde'} />
        <Resumo rotulo="Em produção" valor={String(emProducao)} detalhe="pedidos ainda não entregues" icone="raio" tom={emProducao > 0 ? 'ambar' : 'neutro'} />
      </div>
    </>
  )
}

function Resumo({
  rotulo,
  valor,
  detalhe,
  icone,
  tom = 'neutro',
}: {
  rotulo: string
  valor: string
  detalhe: string
  icone: 'dinheiro' | 'check' | 'relogio' | 'raio'
  tom?: 'neutro' | 'verde' | 'marca' | 'ambar'
}) {
  const cores = {
    neutro: 'border-ink-200 bg-white',
    verde: 'border-emerald-200 bg-emerald-50/60',
    marca: 'border-brand-200 bg-brand-50/60',
    ambar: 'border-amber-200 bg-amber-50/60',
  }
  return (
    <div className={`rounded-card border p-3.5 shadow-card ${cores[tom]}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="rotulo">{rotulo}</p>
        <Icon nome={icone} className="h-4 w-4 text-ink-400" />
      </div>
      <p className="num mt-1.5 text-xl font-semibold text-ink-900">{valor}</p>
      <p className="mt-0.5 text-[11px] text-ink-500">{detalhe}</p>
    </div>
  )
}

function Linha({
  rotulo,
  valor,
  destaque,
  cor = 'text-ink-800',
}: {
  rotulo: string
  valor: string
  destaque?: boolean
  cor?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className={destaque ? 'font-medium text-ink-700' : 'text-ink-500'}>{rotulo}</span>
      <span className={`num ${destaque ? 'text-base font-semibold' : 'font-medium'} ${cor}`}>{valor}</span>
    </div>
  )
}

/** Converte um item do pedido no formato de impressão (comanda/recibo). */
function itemParaImpressao(item: OrderItemOverview) {
  const detalhes: string[] = []
  if (item.size_name) detalhes.push(item.size_name)
  if (item.flavors.length > 1) detalhes.push(`Sabores: ${item.flavors.map((flavor) => flavor.name).join(' + ')}`)
  if (item.modifiers.length > 0)
    detalhes.push(`Adicionais: ${item.modifiers.map((modifier) => modifier.option_name).join(', ')}`)
  if (item.notes) detalhes.push(`Obs.: ${item.notes}`)
  return {
    description: item.product_name,
    details: detalhes,
    qty: item.quantity,
    unit: formatMoney(item.unit_price_cents),
    total: formatMoney(item.total_cents),
  }
}

/** Transições permitidas por perfil (as mesmas regras são validadas no banco). */
function buildAllowedTransitions(current: OrderStatus, role: string): OrderStatus[] {
  const managerTransitions: Partial<Record<OrderStatus, OrderStatus[]>> = {
    received: ['confirmed', 'preparing', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['delivered_to_table', 'out_for_delivery', 'cancelled'],
    out_for_delivery: ['delivered', 'cancelled'],
  }
  const waiterTransitions: Partial<Record<OrderStatus, OrderStatus[]>> = {
    ready: ['delivered_to_table'],
  }
  const map = role === 'waiter' ? waiterTransitions : managerTransitions
  return map[current] ?? []
}
