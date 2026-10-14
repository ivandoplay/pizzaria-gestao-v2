import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOrders, useSettings, useTables } from '../lib/hooks'
import * as api from '../lib/api'
import { Badge, Button, Card, EmptyState, ErrorBlock, LoadingBlock, Select, useToast } from '../components/ui'
import { addDaysInputValue, dayBounds, downloadCsv, formatMoney, todayInputValue, todayRange } from '../lib/format'
import { translateError } from '../lib/errors'
import { ORDER_STATUS_LABELS, type OrderStatus } from '../lib/types'

type PeriodKey = 'today' | '7d' | '30d' | 'custom'

export default function DashboardPage() {
  const toast = useToast()
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [customFrom, setCustomFrom] = useState(todayInputValue())
  const [customTo, setCustomTo] = useState(todayInputValue())

  const range = useMemo(() => {
    if (period === 'today') return todayRange()
    if (period === '7d') {
      return { from: dayBounds(addDaysInputValue(-6)).from, to: dayBounds(addDaysInputValue(0)).to }
    }
    if (period === '30d') {
      const from = dayBounds(addDaysInputValue(-29)).from
      const to = dayBounds(addDaysInputValue(0)).to
      return { from, to }
    }
    const from = dayBounds(customFrom).from
    const to = dayBounds(customTo).to
    return { from, to }
  }, [customFrom, customTo, period])

  const summary = useQuery({
    queryKey: ['dashboard-summary', range.from, range.to],
    queryFn: () => api.getFinancialSummary({ from: range.from, to: range.to }),
  })

  const series = useQuery({
    queryKey: ['dashboard-series', range.from, range.to],
    queryFn: () => api.getSalesSeries(range.from, range.to, 'day'),
  })

  const topProducts = useQuery({
    queryKey: ['dashboard-top', range.from, range.to],
    queryFn: () => api.getTopProducts(range.from, range.to, 8),
  })

  const paymentsByMethod = useQuery({
    queryKey: ['dashboard-methods', range.from, range.to],
    queryFn: () => api.getPaymentMethodReport(range.from, range.to),
  })

  const tables = useTables()
  const openOrders = useOrders({ openOnly: true, limit: 200 })
  const settings = useSettings()

  const data = summary.data
  const maxNet = Math.max(1, ...(series.data ?? []).map((point) => point.net_cents))

  if (summary.isLoading) return <LoadingBlock label="Calculando indicadores do período…" />
  if (summary.error) return <ErrorBlock message={translateError(summary.error)} onRetry={() => void summary.refetch()} />

  const tableList = tables.data ?? []
  const production = (openOrders.data ?? []).filter((order) =>
    ['received', 'confirmed', 'preparing'].includes(order.status),
  )
  const ready = (openOrders.data ?? []).filter((order) => order.status === 'ready')

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-2">
        <Select value={period} onChange={(event) => setPeriod(event.target.value as PeriodKey)} className="w-44">
          <option value="today">Hoje</option>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option>
          <option value="custom">Período personalizado</option>
        </Select>
        {period === 'custom' && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            if (!data) return
            downloadCsv(`resumo-${customFrom}-a-${customTo}.csv`, [
              ['Indicador', 'Valor (R$)'],
              ['Pedidos válidos', data.orders_valid_count],
              ['Pedidos cancelados', data.orders_cancelled_count],
              ['Bruto (itens)', (data.gross_items_cents / 100).toFixed(2)],
              ['Descontos', (data.discounts_cents / 100).toFixed(2)],
              ['Taxas de entrega', (data.delivery_fees_cents / 100).toFixed(2)],
              ['Vendas líquidas', (data.net_valid_cents / 100).toFixed(2)],
              ['Recebido', (data.received_cents / 100).toFixed(2)],
              ['Pendente', (data.pending_cents / 100).toFixed(2)],
              ['Ticket médio', (data.ticket_average_cents / 100).toFixed(2)],
              ['Cancelados (valor)', (data.cancelled_cents / 100).toFixed(2)],
            ])
            toast.success('Resumo exportado em CSV.')
          }}
        >
          Exportar CSV
        </Button>
      </div>

      {/* Indicadores principais */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi title="Vendas líquidas" value={formatMoney(data?.net_valid_cents ?? 0)} footer={`${data?.orders_valid_count ?? 0} pedido(s) válidos`} />
        <Kpi title="Recebido" value={formatMoney(data?.received_cents ?? 0)} tone="green" footer="Somente pagamentos confirmados no período" />
        <Kpi title="Pendente" value={formatMoney(data?.pending_cents ?? 0)} tone="amber" footer="Saldos em aberto dos pedidos do período" />
        <Kpi title="Ticket médio" value={formatMoney(data?.ticket_average_cents ?? 0)} footer="Vendas líquidas ÷ pedidos válidos" />
        <Kpi title="Bruto (itens)" value={formatMoney(data?.gross_items_cents ?? 0)} footer="Subtotal dos itens, antes de descontos" />
        <Kpi title="Descontos" value={formatMoney(data?.discounts_cents ?? 0)} tone="amber" footer="Autorizados e registrados em auditoria" />
        <Kpi title="Taxas de entrega" value={formatMoney(data?.delivery_fees_cents ?? 0)} footer="Taxas cobradas no delivery" />
        <Kpi
          title="Cancelados"
          value={`${data?.orders_cancelled_count ?? 0} · ${formatMoney(data?.cancelled_cents ?? 0)}`}
          tone="red"
          footer="Não entram como venda válida"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Evolução das vendas no período">
          {(series.data ?? []).length === 0 ? (
            <EmptyState title="Sem vendas no período" description="Nenhum pedido registrado nesta janela de datas." />
          ) : (
            <div className="space-y-2">
              <div className="flex h-40 items-end gap-1.5">
                {(series.data ?? []).map((point) => (
                  <div key={point.bucket_start} className="group flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="hidden text-[10px] text-slate-500 group-hover:block">
                      {formatMoney(point.net_cents)}
                    </span>
                    <div
                      className="w-full rounded-t bg-brand-500"
                      style={{ height: `${Math.max(4, (point.net_cents / maxNet) * 100)}%` }}
                      title={`${new Date(point.bucket_start).toLocaleDateString('pt-BR')}: ${formatMoney(point.net_cents)}`}
                    />
                    <span className="text-[10px] text-slate-500">
                      {new Date(point.bucket_start).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">
                Salão: {data?.dine_in.orders_count ?? 0} pedido(s) · {formatMoney(data?.dine_in.net_cents ?? 0)} — Delivery:{' '}
                {data?.delivery.orders_count ?? 0} pedido(s) · {formatMoney(data?.delivery.net_cents ?? 0)}
              </p>
            </div>
          )}
        </Card>

        <Card title="Produtos mais vendidos">
          {(topProducts.data ?? []).length === 0 ? (
            <EmptyState title="Sem vendas no período" />
          ) : (
            <ul className="space-y-1.5">
              {(topProducts.data ?? []).map((product) => (
                <li key={product.product_id} className="flex items-center justify-between text-sm">
                  <span className="truncate text-slate-700">{product.product_name}</span>
                  <span className="whitespace-nowrap text-slate-600">
                    {product.quantity}x · <strong className="text-slate-800">{formatMoney(product.total_cents)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Mesas agora">
          <ul className="space-y-1.5 text-sm">
            <li className="flex justify-between">
              <span className="text-slate-600">Disponíveis</span>
              <span className="font-medium">{tableList.filter((table) => table.status === 'available').length}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-600">Em atendimento</span>
              <span className="font-medium">
                {tableList.filter((table) => table.status !== 'available' && table.status !== 'inactive').length}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-600">Aguardando fechamento</span>
              <span className="font-medium">{tableList.filter((table) => table.status === 'awaiting_close').length}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-600">Atenção (&gt; 2h)</span>
              <span className="font-medium">{tableList.filter((table) => table.status === 'attention').length}</span>
            </li>
          </ul>
        </Card>

        <Card title="Produção">
          <p className="text-3xl font-semibold text-slate-900">{production.length}</p>
          <p className="text-xs text-slate-500">pedido(s) na cozinha (recebido/confirmado/em preparo)</p>
          <p className="mt-3 text-3xl font-semibold text-emerald-700">{ready.length}</p>
          <p className="text-xs text-slate-500">pedido(s) prontos aguardando entrega</p>
          <p className="mt-3 text-[11px] text-slate-500">
            O estado de produção é conduzido pelo caixa/administrador — não existe perfil de cozinha nesta versão.
          </p>
        </Card>

        <Card title="Recebimentos por forma de pagamento">
          {(paymentsByMethod.data ?? []).length === 0 ? (
            <EmptyState title="Sem recebimentos" />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {(paymentsByMethod.data ?? [])
                .filter((row) => row.received_cents > 0 || row.payments_count > 0)
                .map((row) => (
                  <li key={row.method_id} className="flex items-center justify-between">
                    <span className="text-slate-600">
                      {row.label}{' '}
                      {row.in_drawer_cents > 0 && <Badge tone="blue">gaveta</Badge>}
                    </span>
                    <span className="text-slate-800">{formatMoney(row.received_cents)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Pedidos em andamento">
        {(openOrders.data ?? []).length === 0 ? (
          <EmptyState title="Nenhum pedido em aberto" description="Todos os pedidos do período já foram encerrados." />
        ) : (
          <ul className="space-y-1.5 text-sm">
            {(openOrders.data ?? []).slice(0, 12).map((order) => (
              <li key={order.id} className="flex items-center justify-between">
                <span className="text-slate-700">
                  #{order.order_number} ·{' '}
                  {order.service_mode === 'dine_in' ? `Mesa ${order.table_number ?? '—'}` : order.customer_name_snapshot} ·{' '}
                  {order.created_by_name}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-slate-600">{formatMoney(order.total_cents)}</span>
                  <Badge tone={order.balance_cents > 0 ? 'amber' : 'green'}>{ORDER_STATUS_LABELS[order.status as OrderStatus]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-[11px] text-slate-500">
        Fuso horário da operação: <strong>{settings.data?.timezone ?? 'America/Fortaleza'}</strong>. Nenhum indicador de
        lucro é exibido porque o sistema não possui cadastro de custos e despesas — os números acima são de
        faturamento e recebimento, com definições documentadas em docs/RELATORIOS.md.
      </p>
    </div>
  )
}

function Kpi({
  title,
  value,
  footer,
  tone = 'default',
}: {
  title: string
  value: string
  footer: string
  tone?: 'default' | 'green' | 'amber' | 'red'
}) {
  const tones = {
    default: 'text-slate-900',
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className={`mt-1 text-xl font-semibold ${tones[tone]}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{footer}</p>
    </div>
  )
}
