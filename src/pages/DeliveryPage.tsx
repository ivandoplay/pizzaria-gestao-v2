import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { invalidateOrderData, useMenu, useOrders, useSettings, useZones } from '../lib/hooks'
import * as api from '../lib/api'
import { OrderComposer, type MenuData } from '../components/OrderComposer'
import { PaymentModal } from '../components/PaymentPanel'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Textarea,
  useToast,
} from '../components/ui'
import { formatMoney, formatPhone, formatTime, newClientUuid, timeAgo, parseMoneyToCents } from '../lib/format'
import { translateError } from '../lib/errors'
import { ORDER_STATUS_LABELS, type CartItem, type OrderOverview, type OrderStatus } from '../lib/types'

const DELIVERY_NEXT: Record<string, { status: OrderStatus; label: string } | undefined> = {
  received: { status: 'confirmed', label: 'Confirmar pedido' },
  confirmed: { status: 'preparing', label: 'Iniciar preparo' },
  preparing: { status: 'ready', label: 'Marcar pronto' },
  ready: { status: 'out_for_delivery', label: 'Saiu para entrega' },
  out_for_delivery: { status: 'delivered', label: 'Confirmar entrega' },
}

export default function DeliveryPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { isAdmin } = useAuth()

  const deliveryOrders = useOrders({ serviceMode: 'delivery', limit: 200 })
  const menuQuery = useMenu()
  const settings = useSettings()
  const zones = useZones()

  const [showNew, setShowNew] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [street, setStreet] = useState('')
  const [number, setNumber] = useState('')
  const [complement, setComplement] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [reference, setReference] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [paymentOrder, setPaymentOrder] = useState<OrderOverview | null>(null)
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [busy, setBusy] = useState(false)

  const menuData: MenuData = {
    categories: menuQuery.data?.categories ?? [],
    products: menuQuery.data?.products ?? [],
    sizes: menuQuery.data?.sizes ?? [],
    variants: menuQuery.data?.variants ?? [],
    groups: menuQuery.data?.groups ?? [],
    options: menuQuery.data?.options ?? [],
    links: menuQuery.data?.links ?? [],
  }

  const feeCents = useMemo(() => {
    const zone = (zones.data ?? []).find(
      (candidate) => candidate.neighborhood.trim().toLowerCase() === neighborhood.trim().toLowerCase(),
    )
    return zone ? zone.fee_cents : (settings.data?.default_delivery_fee_cents ?? 0)
  }, [neighborhood, settings.data?.default_delivery_fee_cents, zones.data])

  const cartSubtotal = cart.reduce((sum, item) => sum + item.preview.unit_price_cents * item.quantity, 0)

  const list = useMemo(() => {
    const rows = deliveryOrders.data ?? []
    if (filter === 'all') return rows
    return rows.filter((order) => !['delivered', 'cancelled'].includes(order.status))
  }, [deliveryOrders.data, filter])

  async function handleCreate() {
    if (cart.length === 0) {
      toast.error('Adicione ao menos um item.')
      return
    }
    if (!customerName.trim() || customerPhone.replace(/\D/g, '').length < 10) {
      toast.error('Informe o nome e o telefone com DDD do cliente.')
      return
    }
    if (!street.trim() || !number.trim() || !neighborhood.trim()) {
      toast.error('Informe rua, número e bairro do endereço de entrega.')
      return
    }

    setBusy(true)
    try {
      const order = await api.createOrder(
        {
          service_mode: 'delivery',
          customer: { name: customerName.trim(), phone: customerPhone.trim() },
          address: {
            street: street.trim(),
            number: number.trim(),
            complement: complement.trim() || undefined,
            neighborhood: neighborhood.trim(),
            reference: reference.trim() || undefined,
            delivery_notes: deliveryNotes.trim() || undefined,
          },
          delivery_notes: deliveryNotes.trim() || undefined,
          items: cart.map((item) => ({
            product_id: item.product_id,
            variant_id: item.variant_id,
            quantity: item.quantity,
            notes: item.notes || undefined,
            flavor_product_ids: item.flavor_product_ids,
            modifier_option_ids: item.modifier_option_ids,
          })),
        },
        newClientUuid(),
      )

      toast.success(`Pedido #${order.order_number} registrado para entrega.`)
      setCart([])
      setCustomerName('')
      setCustomerPhone('')
      setStreet('')
      setNumber('')
      setComplement('')
      setNeighborhood('')
      setReference('')
      setDeliveryNotes('')
      setShowNew(false)
      invalidateOrderData(queryClient)
      void deliveryOrders.refetch()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function advance(order: OrderOverview) {
    const next = DELIVERY_NEXT[order.status]
    if (!next) return
    setBusy(true)
    try {
      await api.advanceOrderStatus(order.id, next.status, next.status === 'out_for_delivery' ? 'Saiu para entrega' : undefined)
      toast.success(`Pedido #${order.order_number}: ${ORDER_STATUS_LABELS[next.status]}.`)
      invalidateOrderData(queryClient)
      void deliveryOrders.refetch()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function cancelOrder(order: OrderOverview) {
    const reason = window.prompt('Motivo do cancelamento (obrigatório):')
    if (!reason || reason.trim().length < 3) return
    setBusy(true)
    try {
      await api.advanceOrderStatus(order.id, 'cancelled', reason.trim())
      toast.success('Pedido cancelado (registro preservado e auditado).')
      invalidateOrderData(queryClient)
      void deliveryOrders.refetch()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function closeAccount(order: OrderOverview) {
    setBusy(true)
    try {
      await api.closeDeliveryAccount(order.id)
      toast.success(`Conta do pedido #${order.order_number} fechada.`)
      invalidateOrderData(queryClient)
      void deliveryOrders.refetch()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function changeFee(order: OrderOverview) {
    const value = window.prompt('Nova taxa de entrega (R$):', (order.delivery_fee_cents / 100).toFixed(2).replace('.', ','))
    if (value === null) return
    const reason = window.prompt('Motivo do ajuste da taxa (obrigatório):')
    if (!reason || reason.trim().length < 3) return
    setBusy(true)
    try {
      await api.setDeliveryFee(order.id, parseMoneyToCents(value), reason.trim())
      toast.success('Taxa de entrega ajustada (auditada).')
      void deliveryOrders.refetch()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  if (deliveryOrders.isLoading || menuQuery.isLoading) return <LoadingBlock label="Carregando delivery…" />
  if (deliveryOrders.error) return <ErrorBlock message={translateError(deliveryOrders.error)} onRetry={() => void deliveryOrders.refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant={filter === 'active' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('active')}>
            Em andamento
          </Button>
          <Button variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('all')}>
            Todos
          </Button>
        </div>
        <Button onClick={() => setShowNew(true)}>+ Novo pedido de delivery</Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="Nenhum pedido de delivery"
          description="Os pedidos recebidos por telefone ou WhatsApp são lançados manualmente aqui — não há integração automática nesta versão."
          action={<Button onClick={() => setShowNew(true)}>Registrar pedido</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((order) => (
            <Card key={order.id} padded={false}>
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 p-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">#{order.order_number}</p>
                  <p className="text-xs text-slate-600">{order.customer_name_snapshot}</p>
                  <p className="text-[11px] text-slate-500">{formatPhone(order.customer_phone_snapshot)}</p>
                </div>
                <div className="text-right">
                  <Badge
                    tone={
                      order.status === 'delivered'
                        ? 'green'
                        : order.status === 'cancelled'
                          ? 'red'
                          : order.status === 'out_for_delivery'
                            ? 'blue'
                            : 'amber'
                    }
                  >
                    {ORDER_STATUS_LABELS[order.status]}
                  </Badge>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {formatTime(order.created_at)} · {timeAgo(order.created_at)}
                  </p>
                </div>
              </div>

              <div className="space-y-2 p-3 text-xs text-slate-700">
                <p>
                  <span className="text-slate-500">Bairro:</span> {order.delivery_neighborhood ?? '—'} ·{' '}
                  <span className="text-slate-500">Taxa:</span> {formatMoney(order.delivery_fee_cents)}
                </p>
                <p>
                  <span className="text-slate-500">Itens:</span> {formatMoney(order.subtotal_cents)} ·{' '}
                  <span className="text-slate-500">Total:</span>{' '}
                  <strong>{formatMoney(order.total_cents)}</strong>
                </p>
                <p>
                  <span className="text-slate-500">Pago:</span> {formatMoney(order.paid_cents)} ·{' '}
                  <span className={order.balance_cents > 0 ? 'text-brand-700' : 'text-emerald-700'}>
                    {order.balance_cents > 0 ? `falta ${formatMoney(order.balance_cents)}` : 'quitado'}
                  </span>
                </p>
                {order.change_given_cents > 0 && (
                  <p className="text-slate-500">Troco: {formatMoney(order.change_given_cents)}</p>
                )}
                {order.notes && <p className="italic text-slate-500">Obs.: {order.notes}</p>}
                {order.cancel_reason && <p className="text-red-700">Cancelado: {order.cancel_reason}</p>}
                {order.account_closed_at && <p className="text-emerald-700">Conta fechada.</p>}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-slate-100 p-3">
                {DELIVERY_NEXT[order.status] && order.status !== 'cancelled' && (
                  <Button size="sm" onClick={() => advance(order)} loading={busy}>
                    {DELIVERY_NEXT[order.status]?.label}
                  </Button>
                )}
                {!order.account_closed_at && order.status !== 'cancelled' && (
                  <Button size="sm" variant="secondary" onClick={() => setPaymentOrder(order)}>
                    Receber
                  </Button>
                )}
                {!order.account_closed_at && order.status !== 'cancelled' && order.balance_cents === 0 && order.total_cents > 0 && (
                  <Button size="sm" variant="success" onClick={() => closeAccount(order)} loading={busy}>
                    Fechar conta
                  </Button>
                )}
                {isAdmin && !order.account_closed_at && order.status !== 'cancelled' && (
                  <Button size="sm" variant="ghost" onClick={() => changeFee(order)}>
                    Ajustar taxa
                  </Button>
                )}
                {order.status !== 'cancelled' && order.status !== 'delivered' && (
                  <Button size="sm" variant="ghost" onClick={() => cancelOrder(order)} loading={busy}>
                    Cancelar
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {paymentOrder && (
        <PaymentModal
          orderId={paymentOrder.id}
          orderNumber={paymentOrder.order_number}
          balanceCents={paymentOrder.balance_cents}
          onClose={() => {
            setPaymentOrder(null)
            void deliveryOrders.refetch()
          }}
        />
      )}

      <Modal
        open={showNew}
        title="Novo pedido de delivery"
        onClose={() => setShowNew(false)}
        size="xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowNew(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} loading={busy}>
              Registrar pedido · {formatMoney(cartSubtotal + feeCents)}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Card title="Dados do cliente e endereço">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Nome do cliente *">
                <Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
              </Field>
              <Field label="Telefone com DDD *" hint="Clientes recorrentes são reconhecidos pelo telefone.">
                <Input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="(86) 99999-0000" />
              </Field>
              <Field label="Bairro *" hint={`Taxa aplicada: ${formatMoney(feeCents)}`}>
                <Input
                  value={neighborhood}
                  onChange={(event) => setNeighborhood(event.target.value)}
                  list="bairros"
                  placeholder="ex.: Centro"
                />
                <datalist id="bairros">
                  {(zones.data ?? []).map((zone) => (
                    <option key={zone.id} value={zone.neighborhood} />
                  ))}
                </datalist>
              </Field>
              <Field label="Rua *">
                <Input value={street} onChange={(event) => setStreet(event.target.value)} />
              </Field>
              <Field label="Número *">
                <Input value={number} onChange={(event) => setNumber(event.target.value)} />
              </Field>
              <Field label="Complemento">
                <Input value={complement} onChange={(event) => setComplement(event.target.value)} placeholder="apto, bloco…" />
              </Field>
              <Field label="Ponto de referência">
                <Input value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>
              <Field label="Observações de entrega" className="sm:col-span-2">
                <Textarea value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Itens do pedido">
            <OrderComposer
              menu={menuData}
              halfRule={settings.data?.half_and_half_price_rule ?? 'highest'}
              items={cart}
              onChange={setCart}
              disabled={busy}
            />
          </Card>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Subtotal (prévia)</span>
              <span>{formatMoney(cartSubtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Taxa de entrega</span>
              <span>{formatMoney(feeCents)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1">
              <span className="font-medium text-slate-700">Total estimado</span>
              <span className="font-semibold text-slate-900">{formatMoney(cartSubtotal + feeCents)}</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              O valor oficial é confirmado pelo servidor com os preços vigentes do cardápio e a taxa do bairro.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
