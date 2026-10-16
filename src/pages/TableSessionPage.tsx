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
import { PaymentModal } from '../components/PaymentPanel'
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
import { duracaoDesde, formatDateTime, formatMoney, formatTime, newClientUuid, plural } from '../lib/format'
import { translateError } from '../lib/errors'
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
  const emProducao = sessionOrders.filter((order) =>
    ['received', 'confirmed', 'preparing', 'ready'].includes(order.status),
  ).length

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
      const order = await api.createOrder(payload, newClientUuid())
      const numero = (order as unknown as { order_number: number }).order_number
      toast.success(`Pedido #${numero} enviado para a produção.`)
      setCart([])
      invalidateOrderData(queryClient)
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setSending(false)
    }
  }

  async function handleStatusChange(orderId: string, status: OrderStatus) {
    setBusy(true)
    try {
      await api.advanceOrderStatus(orderId, status)
      toast.success(`Pedido atualizado para “${ORDER_STATUS_LABELS[status]}”.`)
      invalidateOrderData(queryClient)
      setStatusModalOrder(null)
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
      })) as { balance_cents: number }
      toast.success(
        result.balance_cents > 0
          ? `Conta encerrada com saldo pendente de ${formatMoney(result.balance_cents)} — registrado na auditoria.`
          : 'Conta fechada e mesa liberada para o próximo atendimento.',
      )
      invalidateOrderData(queryClient)
      setCloseDialog(null)
      navigate('/mesas')
    } catch (error) {
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
    const recebido = pedidos.reduce((soma, pedido) => soma + pedido.paid_cents, 0)
    const total = pedidos.reduce((soma, pedido) => soma + pedido.total_cents, 0)
    const recebimentos = (payments.data ?? []).filter(
      (payment) => payment.status === 'confirmed' && pedidos.some((pedido) => pedido.id === payment.order_id),
    )
    const troco = recebimentos.reduce((soma, payment) => soma + payment.change_cents, 0)

    api.printReceipt({
      title: 'Recibo do cliente',
      subtitle: `${tableRow?.name ?? `Mesa ${tableRow?.number ?? ''}`} · atendimento aberto em ${formatTime(tableRow?.opened_at)}`,
      lines: [
        { label: 'Pedidos', value: pedidos.map((pedido) => `#${pedido.order_number}`).join(', ') },
        { label: 'Subtotal', value: formatMoney(totals.subtotal) },
        ...(totals.discount > 0 ? [{ label: 'Desconto', value: `- ${formatMoney(totals.discount)}` }] : []),
        { label: 'Total', value: formatMoney(total), emphasis: true },
        { label: 'Recebido', value: formatMoney(recebido) },
        { label: 'Saldo a pagar', value: formatMoney(Math.max(total - recebido, 0)), emphasis: true },
        ...(troco > 0 ? [{ label: 'Troco entregue', value: formatMoney(troco) }] : []),
        ...recebimentos.map((payment) => ({
          label: `Pgto. ${nomeMetodo(payment.method_id)}`,
          value: formatMoney(payment.amount_cents),
        })),
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
        <Callout tom="atencao" titulo="Atendimento não encontrado">
          A mesa pode já ter sido fechada por outro usuário. Os pedidos continuam disponíveis no histórico.
        </Callout>
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
                variant={balance > 0 ? 'secondary' : 'success'}
                icone={balance > 0 ? 'dinheiro' : 'check'}
                onClick={() => setCloseDialog({ reason: '' })}
                disabled={sessionOrders.length === 0}
              >
                {balance > 0 ? 'Fechar conta' : 'Fechar conta e liberar'}
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
          contas) continua sendo só do administrador, na tela de Mesas. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Resumo rotulo="Total da conta" valor={formatMoney(totals.total)} detalhe={`${plural(sessionOrders.length, 'pedido', 'pedidos')} · ${plural(itensAtivos.length, 'item', 'itens')}`} icone="dinheiro" />
        <Resumo rotulo="Recebido" valor={formatMoney(totals.paid)} detalhe={totals.change > 0 ? `troco ${formatMoney(totals.change)}` : 'sem troco registrado'} icone="check" tom="verde" />
        <Resumo rotulo="Falta receber" valor={formatMoney(balance)} detalhe={balance > 0 ? 'registre o pagamento antes de fechar' : 'conta quitada'} icone="relogio" tom={balance > 0 ? 'marca' : 'verde'} />
        <Resumo rotulo="Em produção" valor={String(emProducao)} detalhe="pedidos ainda não entregues" icone="raio" tom={emProducao > 0 ? 'ambar' : 'neutro'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        {/* Pedidos do atendimento */}
        <Card
          title="Pedidos do atendimento"
          descricao="Atualiza automaticamente quando alguém lança ou altera um pedido."
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
                      className={`overflow-hidden rounded-card border shadow-card ${
                        order.is_cancelled ? 'border-red-200 bg-red-50/60' : 'border-ink-200 bg-white'
                      }`}
                    >
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
                  />
                </div>
              </Card>

              <div className="sticky bottom-20 z-10 rounded-card border border-ink-200 bg-white p-4 shadow-float lg:bottom-4">
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="rotulo">Prévia do pedido</p>
                    <p className="text-xs text-ink-500">
                      {quantidadeCart === 0
                        ? 'Nenhum item na lista'
                        : `${plural(quantidadeCart, 'item', 'itens')} em ${plural(cart.length, 'linha', 'linhas')}`}
                    </p>
                  </div>
                  <p className="num text-xl font-semibold text-ink-900">{formatMoney(totalCart)}</p>
                </div>
                <Button
                  block
                  size="lg"
                  icone="seta-direita"
                  onClick={handleSendOrder}
                  loading={sending}
                  disabled={cart.length === 0}
                >
                  Enviar pedido para a produção
                </Button>
                <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-ink-500">
                  <Icon nome="cadeado" className="h-3.5 w-3.5" />
                  O envio é idempotente: cliques repetidos não duplicam o pedido.
                </p>
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
      {paymentOrder && (
        <PaymentModal
          orderId={paymentOrder}
          orderNumber={orderList.find((order) => order.id === paymentOrder)?.order_number ?? 0}
          balanceCents={(orderList.find((order) => order.id === paymentOrder)?.total_cents ?? 0) -
            (orderList.find((order) => order.id === paymentOrder)?.paid_cents ?? 0)}
          descricaoPedido={`${tableRow.name ?? `Mesa ${tableRow.number}`} · ${TABLE_STATUS_LABELS[tableRow.status]}`}
          onClose={() => setPaymentOrder(null)}
          onImprimirRecibo={() => {
            const pedido = orderList.find((order) => order.id === paymentOrder)
            setTimeout(() => imprimirRecibo(pedido), 150)
          }}
        />
      )}

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
                    onClick={() => handleStatusChange(statusModalOrder, status)}
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
            {balance > 0 && isAdmin && (
              <Button
                variant="danger"
                loading={closing}
                onClick={() => handleCloseAccount(true)}
                disabled={!closeDialog?.reason || closeDialog.reason.trim().length < 3}
              >
                Fechar com saldo (excepcional)
              </Button>
            )}
            <Button
              variant="success"
              icone="check"
              loading={closing}
              disabled={balance > 0}
              onClick={() => handleCloseAccount(false)}
            >
              Confirmar fechamento
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

          {balance > 0 ? (
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
