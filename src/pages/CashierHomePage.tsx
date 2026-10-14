import { useNavigate } from 'react-router-dom'
import { useOpenCashSession, useOrders, useTables } from '../lib/hooks'
import { Badge, Button, Card, EmptyState, ErrorBlock, LoadingBlock } from '../components/ui'
import { formatMoney, formatTime, timeAgo } from '../lib/format'
import { translateError } from '../lib/errors'
import { ORDER_STATUS_LABELS } from '../lib/types'

/** Tela inicial do caixa: situação da operação e atalhos. */
export default function CashierHomePage() {
  const navigate = useNavigate()
  const tables = useTables()
  const cash = useOpenCashSession()
  const openOrders = useOrders({ openOnly: true, limit: 200 })
  const deliveries = useOrders({ serviceMode: 'delivery', statuses: ['received', 'confirmed', 'preparing', 'ready', 'out_for_delivery'], limit: 100 })

  if (tables.isLoading || cash.isLoading) return <LoadingBlock label="Carregando o painel do caixa…" />
  if (tables.error) return <ErrorBlock message={translateError(tables.error)} onRetry={() => void tables.refetch()} />

  const tableList = tables.data ?? []
  const available = tableList.filter((table) => table.status === 'available')
  const occupied = tableList.filter((table) => table.status !== 'available' && table.status !== 'inactive')
  const awaitingClose = tableList.filter((table) => table.status === 'awaiting_close')
  const orderList = openOrders.data ?? []
  const deliveryList = deliveries.data ?? []

  const openBalance = orderList.reduce((sum, order) => sum + order.balance_cents, 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniCard
          title="Caixa"
          value={cash.data ? 'Aberto' : 'Fechado'}
          tone={cash.data ? 'green' : 'red'}
          footer={
            cash.data
              ? `Por ${cash.data.opened_by_name ?? '—'} desde ${formatTime(cash.data.opened_at)} · gaveta ${formatMoney(cash.data.expected_cash_cents)}`
              : 'Abra o caixa para registrar recebimentos'
          }
          action={
            <Button size="sm" variant="secondary" onClick={() => navigate('/caixa-controle')}>
              {cash.data ? 'Ver caixa' : 'Abrir caixa'}
            </Button>
          }
        />
        <MiniCard
          title="Mesas"
          value={`${available.length} livres / ${occupied.length} em uso`}
          tone="blue"
          footer={`${awaitingClose.length} aguardando fechamento`}
          action={
            <Button size="sm" variant="secondary" onClick={() => navigate('/mesas')}>
              Mapa de mesas
            </Button>
          }
        />
        <MiniCard
          title="Delivery em andamento"
          value={String(deliveryList.length)}
          tone="brand"
          footer="Pedidos recebidos por telefone/WhatsApp lançados manualmente"
          action={
            <Button size="sm" variant="secondary" onClick={() => navigate('/delivery')}>
              Abrir delivery
            </Button>
          }
        />
        <MiniCard
          title="Saldo a receber"
          value={formatMoney(openBalance)}
          tone="amber"
          footer={`${orderList.length} conta(s) em aberto`}
          action={
            <Button size="sm" variant="secondary" onClick={() => navigate('/mesas')}>
              Fechar contas
            </Button>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Contas aguardando fechamento">
          {awaitingClose.length === 0 ? (
            <EmptyState title="Nenhuma conta pronta para fechar" description="As mesas aparecem aqui quando o valor já foi recebido ou quando o cliente pede a conta." />
          ) : (
            <ul className="space-y-2">
              {awaitingClose.map((table) => (
                <li key={table.id} className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{table.name ?? `Mesa ${table.number}`}</p>
                    <p className="text-[11px] text-slate-600">
                      Total {formatMoney(table.total_cents)} · recebido {formatMoney(table.paid_cents)} · falta{' '}
                      {formatMoney(table.balance_cents)}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => navigate(`/mesas/${table.open_session_id}`)}>
                    Fechar conta
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Contas em aberto">
          {orderList.length === 0 ? (
            <EmptyState title="Nenhuma conta em aberto" />
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto scroll-thin">
              {orderList.slice(0, 25).map((order) => (
                <li key={order.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      #{order.order_number}{' '}
                      {order.service_mode === 'dine_in'
                        ? `· ${order.table_number ? `Mesa ${order.table_number}` : 'Salão'}`
                        : `· ${order.customer_name_snapshot ?? 'Delivery'}`}
                    </p>
                    <p className="text-[11px] text-slate-600">
                      {ORDER_STATUS_LABELS[order.status]} · aberto {timeAgo(order.created_at)} · falta{' '}
                      {formatMoney(order.balance_cents)}
                    </p>
                  </div>
                  <Badge tone={order.balance_cents > 0 ? 'amber' : 'green'}>
                    {order.balance_cents > 0 ? 'a receber' : 'quitada'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-xs text-slate-500">
        Dica: pedidos com saldo pendente <strong>não podem</strong> ser marcados como totalmente pagos — o banco recusa
        e exige pagamento ou procedimento excepcional do administrador, registrado em auditoria.
      </p>
    </div>
  )
}

function MiniCard({
  title,
  value,
  footer,
  tone,
  action,
}: {
  title: string
  value: string
  footer: string
  tone: 'green' | 'red' | 'blue' | 'amber' | 'brand'
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        <Badge tone={tone}>{value}</Badge>
      </div>
      <p className="mt-2 text-xs text-slate-600">{footer}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
