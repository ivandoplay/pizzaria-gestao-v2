import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import {
  invalidateOrderData,
  useMenu,
  useOrderItems,
  useOrders,
  usePayments,
  useSettings,
  useStatusHistory,
  useTables,
} from '../lib/hooks'
import * as api from '../lib/api'
import { OrderComposer, type MenuData } from '../components/OrderComposer'
import { PaymentModal } from '../components/PaymentPanel'
import { Button, Card, ConfirmDialog, ErrorBlock, LoadingBlock, Modal, useToast } from '../components/ui'
import { formatDateTime, formatMoney, formatTime, newClientUuid, timeAgo } from '../lib/format'
import { translateError } from '../lib/errors'
import { ORDER_STATUS_LABELS, type CartItem, type OrderStatus } from '../lib/types'

export default function TableSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const { profile, isManager } = useAuth()

  const tables = useTables()
  const menu = useMenu()
  const settings = useSettings()
  const orders = useOrders({ sessionId, limit: 100 })

  const [cart, setCart] = useState<CartItem[]>([])
  const [sending, setSending] = useState(false)
  const [paymentOrder, setPaymentOrder] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeDialog, setCloseDialog] = useState<{ force: boolean; reason: string } | null>(null)
  const [statusModalOrder, setStatusModalOrder] = useState<string | null>(null)
  const [cancelItem, setCancelItem] = useState<{ id: string; label: string } | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy] = useState(false)

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
    subtotal: sessionOrders.reduce((sum, order) => sum + order.subtotal_cents, 0),
    discount: sessionOrders.reduce((sum, order) => sum + order.discount_cents, 0),
    total: sessionOrders.reduce((sum, order) => sum + order.total_cents, 0),
    paid: sessionOrders.reduce((sum, order) => sum + order.paid_cents, 0),
  }
  const balance = totals.total - totals.paid
  const canClose = isManager || profile?.role === 'admin'

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
      toast.success(`Pedido #${(order as unknown as { order_number: number }).order_number} enviado para a produção.`)
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
      toast.success(`Pedido atualizado para "${ORDER_STATUS_LABELS[status]}".`)
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
      await api.cancelOrderItem(cancelItem.id, cancelReason)
      toast.success('Item cancelado e valores recalculados.')
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
          ? 'Conta encerrada com saldo pendente registrado na auditoria.'
          : 'Conta fechada e mesa liberada.',
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

  if (tables.isLoading || menu.isLoading || settings.isLoading) return <LoadingBlock label="Carregando atendimento…" />
  if (tables.error) return <ErrorBlock message={translateError(tables.error)} onRetry={() => void tables.refetch()} />
  if (!tableRow || !sessionId) {
    return (
      <div className="space-y-3">
        <ErrorBlock message="Atendimento não encontrado. A mesa pode já ter sido fechada por outro usuário." />
        <Button variant="secondary" onClick={() => navigate('/mesas')}>
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

  const itemsByOrder = new Map<string, typeof items>()
  for (const item of items) {
    const list = itemsByOrder.get(item.order_id) ?? []
    list.push(item)
    itemsByOrder.set(item.order_id, list)
  }

  return (
    <div className="space-y-4">
      {/* Cabeçalho da mesa */}
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Mesa</p>
              <p className="text-base font-semibold text-slate-900">
                {tableRow.name ?? `Mesa ${tableRow.number}`}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Abertura</p>
              <p className="text-slate-800">
                {formatTime(tableRow.opened_at)} ({timeAgo(tableRow.opened_at)})
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Responsável</p>
              <p className="text-slate-800">{tableRow.opened_by_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Pessoas</p>
              <p className="text-slate-800">{tableRow.guest_count ?? '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Total / Saldo</p>
              <p className="font-semibold text-slate-900">
                {formatMoney(totals.total)}{' '}
                <span className={balance > 0 ? 'text-brand-700' : 'text-emerald-700'}>
                  ({balance > 0 ? `falta ${formatMoney(balance)}` : 'quitada'})
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate('/mesas')}>
              ← Mesas
            </Button>
            {canClose && (
              <Button
                size="sm"
                variant={balance > 0 ? 'secondary' : 'success'}
                onClick={() => setCloseDialog({ force: false, reason: '' })}
                disabled={sessionOrders.length === 0}
              >
                Fechar conta
              </Button>
            )}
          </div>
        </div>
      </Card>

      {!activeSession && (
        <ErrorBlock message="Este atendimento já foi encerrado. Os pedidos continuam disponíveis no histórico." />
      )}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        {/* Pedidos da sessão */}
        <Card
          title={`Pedidos do atendimento (${sessionOrders.length})`}
          actions={<span className="text-xs text-slate-500">Atualiza automaticamente</span>}
        >
          {orders.isLoading ? (
            <LoadingBlock label="Carregando pedidos…" />
          ) : sessionOrders.length === 0 && orderList.filter((o) => o.is_cancelled).length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Nenhum pedido lançado ainda. Monte o pedido ao lado e envie para a produção.
            </p>
          ) : (
            <div className="space-y-2">
              {orderList.map((order) => {
                const orderItemList = itemsByOrder.get(order.id) ?? []
                const orderPayments = (payments.data ?? []).filter((payment) => payment.order_id === order.id)
                return (
                  <div
                    key={order.id}
                    className={`rounded-lg border p-3 ${order.is_cancelled ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">#{order.order_number}</span>
                        <StatusBadge status={order.status} />
                        <span className="text-[11px] text-slate-500">
                          {formatTime(order.created_at)} · {order.created_by_name}
                        </span>
                      </div>
                      <div className="text-right text-sm">
                        <span className="font-semibold text-slate-800">{formatMoney(order.total_cents)}</span>
                        {order.discount_cents > 0 && (
                          <span className="ml-2 text-[11px] text-slate-500">
                            desc. {formatMoney(order.discount_cents)}
                          </span>
                        )}
                      </div>
                    </div>

                    <ul className="mt-2 space-y-1">
                      {orderItemList.map((item) => (
                        <li
                          key={item.id}
                          className={`flex items-start justify-between gap-2 text-xs ${item.is_cancelled ? 'text-slate-400 line-through' : 'text-slate-700'}`}
                        >
                          <div>
                            <span className="font-medium">
                              {item.quantity}× {item.product_name}
                            </span>{' '}
                            <span className="text-slate-500">({item.size_name})</span>
                            {item.flavors.length > 1 && (
                              <span className="block text-[11px] text-slate-500">
                                Sabores: {item.flavors.map((flavor) => flavor.name).join(' + ')}
                              </span>
                            )}
                            {item.modifiers.length > 0 && (
                              <span className="block text-[11px] text-slate-500">
                                {item.modifiers.map((modifier) => modifier.option_name).join(', ')}
                              </span>
                            )}
                            {item.notes && <span className="block text-[11px] italic text-slate-500">{item.notes}</span>}
                            {item.is_cancelled && item.cancel_reason && (
                              <span className="block text-[11px] text-red-600">cancelado: {item.cancel_reason}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span>{formatMoney(item.total_cents)}</span>
                            {isManager && !item.is_cancelled && !order.account_closed_at && (
                              <button
                                className="text-[11px] text-red-600 hover:underline"
                                onClick={() => setCancelItem({ id: item.id, label: `${item.quantity}× ${item.product_name}` })}
                              >
                                cancelar
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    {orderPayments.length > 0 && (
                      <div className="mt-2 border-t border-slate-100 pt-1 text-[11px] text-slate-600">
                        Recebimentos:{' '}
                        {orderPayments
                          .map(
                            (payment) =>
                              `${formatMoney(payment.amount_cents)} (${payment.method_id}${payment.status === 'reversed' ? ' estornado' : ''})`,
                          )
                          .join(' · ')}
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setStatusModalOrder(order.id)}
                        className="text-[11px] text-brand-700 hover:underline"
                      >
                        acompanhar situação
                      </button>
                      {isManager && !order.account_closed_at && !order.is_cancelled && (
                        <button
                          onClick={() => setPaymentOrder(order.id)}
                          className="text-[11px] text-brand-700 hover:underline"
                        >
                          registrar pagamento
                        </button>
                      )}
                      {order.account_closed_at && (
                        <span className="text-[11px] text-emerald-700">
                          conta fechada em {formatDateTime(order.account_closed_at)}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Compositor de novo pedido */}
        <div className="space-y-3">
          {activeSession && profile ? (
            <>
              <Card title="Novo pedido" padded={false}>
                <div className="p-3">
                  <OrderComposer
                    menu={menuData}
                    halfRule={settings.data?.half_and_half_price_rule ?? 'highest'}
                    items={cart}
                    onChange={setCart}
                    disabled={sending}
                  />
                </div>
              </Card>
              <div className="sticky bottom-3 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Itens: {cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
                  <span className="font-semibold text-slate-900">
                    Prévia: {formatMoney(cart.reduce((sum, item) => sum + item.preview.unit_price_cents * item.quantity, 0))}
                  </span>
                </div>
                <Button className="w-full" size="lg" onClick={handleSendOrder} loading={sending} disabled={cart.length === 0}>
                  Enviar pedido para a produção
                </Button>
                <p className="mt-1 text-center text-[11px] text-slate-500">
                  Cliques repetidos não duplicam o pedido: o envio é idempotente.
                </p>
              </div>
            </>
          ) : (
            <Card title="Atendimento encerrado">
              <p className="text-sm text-slate-600">
                Esta mesa foi liberada. Para lançar novos itens, inicie um novo atendimento no mapa de mesas.
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* Registrar pagamento */}
      {paymentOrder && (
        <PaymentModal
          orderId={paymentOrder}
          orderNumber={orderList.find((order) => order.id === paymentOrder)?.order_number ?? 0}
          balanceCents={
            (orderList.find((order) => order.id === paymentOrder)?.total_cents ?? 0) -
            (orderList.find((order) => order.id === paymentOrder)?.paid_cents ?? 0)
          }
          onClose={() => setPaymentOrder(null)}
        />
      )}

      {/* Situação do pedido */}
      <Modal
        open={Boolean(statusModalOrder)}
        title="Acompanhamento do pedido"
        onClose={() => setStatusModalOrder(null)}
        size="md"
      >
        {statusModalOrder && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {buildAllowedTransitions(
                orderList.find((order) => order.id === statusModalOrder)?.status ?? 'received',
                profile?.role ?? 'waiter',
              ).map((status) => (
                <Button key={status} size="sm" onClick={() => handleStatusChange(statusModalOrder, status)} loading={busy}>
                  Marcar como {ORDER_STATUS_LABELS[status]}
                </Button>
              ))}
            </div>
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Histórico</h4>
              {history.isLoading ? (
                <LoadingBlock label="Carregando histórico…" />
              ) : (
                <ul className="space-y-1 text-xs text-slate-600">
                  {(history.data ?? []).map((entry) => (
                    <li key={entry.id}>
                      {formatDateTime(entry.changed_at)} — de “{entry.from_status ? ORDER_STATUS_LABELS[entry.from_status as OrderStatus] : '—'}”
                      para “{ORDER_STATUS_LABELS[entry.to_status as OrderStatus]}”
                      {entry.notes ? ` · ${entry.notes}` : ''}
                    </li>
                  ))}
                  {(history.data ?? []).length === 0 && <li>Nenhuma mudança registrada ainda.</li>}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Cancelar item */}
      <ConfirmDialog
        open={Boolean(cancelItem)}
        title="Cancelar item"
        confirmLabel="Cancelar item"
        tone="danger"
        loading={busy}
        onCancel={() => {
          setCancelItem(null)
          setCancelReason('')
        }}
        onConfirm={confirmCancelItem}
        message={
          <div className="space-y-2">
            <p>
              Item: <strong>{cancelItem?.label}</strong>
            </p>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Motivo do cancelamento (obrigatório)"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
            <p className="text-xs text-slate-500">
              O item não é apagado: fica marcado como cancelado, com motivo, responsável e horário.
            </p>
          </div>
        }
      />

      {/* Fechamento da conta */}
      <Modal
        open={Boolean(closeDialog)}
        title="Fechar conta da mesa"
        onClose={() => setCloseDialog(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloseDialog(null)} disabled={closing}>
              Voltar
            </Button>
            {balance > 0 && profile?.role === 'admin' && (
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
              loading={closing}
              disabled={balance > 0}
              onClick={() => handleCloseAccount(false)}
            >
              Confirmar fechamento
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-slate-200 p-3">
            <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
            <Row label="Descontos" value={`- ${formatMoney(totals.discount)}`} />
            <Row label="Total" value={formatMoney(totals.total)} emphasis />
            <Row label="Recebido" value={formatMoney(totals.paid)} />
            <Row label="Saldo" value={formatMoney(balance)} emphasis />
          </div>

          {balance > 0 ? (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <p className="text-xs">
                Ainda há saldo pendente. Registre os pagamentos antes de fechar — o banco recusa fechar conta com saldo
                (o fechamento excepcional é exclusivo do administrador e fica auditado).
              </p>
              <input
                className="w-full rounded-md border border-amber-300 px-3 py-2 text-sm"
                placeholder="Justificativa (obrigatória para fechamento excepcional)"
                value={closeDialog?.reason ?? ''}
                onChange={(event) => setCloseDialog({ force: true, reason: event.target.value })}
              />
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Ao confirmar, os pedidos ficam com a conta encerrada e a mesa é liberada para o próximo atendimento.
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-slate-600">{label}</span>
      <span className={emphasis ? 'font-semibold text-slate-900' : 'text-slate-800'}>{value}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const tones: Record<OrderStatus, string> = {
    received: 'bg-slate-100 text-slate-700',
    confirmed: 'bg-blue-100 text-blue-800',
    preparing: 'bg-amber-100 text-amber-900',
    ready: 'bg-emerald-100 text-emerald-800',
    delivered_to_table: 'bg-emerald-100 text-emerald-800',
    out_for_delivery: 'bg-indigo-100 text-indigo-800',
    delivered: 'bg-emerald-100 text-emerald-800',
    cancelled: 'bg-red-100 text-red-800',
  }
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[status]}`}>{ORDER_STATUS_LABELS[status]}</span>
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
