import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'
import { useProfiles } from '../lib/hooks'
import { Button, Card, DataTable, EmptyState, ErrorBlock, Field, Input, LoadingBlock, Select, useToast } from '../components/ui'
import { dayBounds, downloadCsv, formatDate, formatDateTime, formatMoney, todayInputValue } from '../lib/format'
import { translateError } from '../lib/errors'

type Bucket = 'day' | 'week' | 'month'

export default function ReportsPage() {
  const toast = useToast()
  const [from, setFrom] = useState(todayInputValue())
  const [to, setTo] = useState(todayInputValue())
  const [serviceMode, setServiceMode] = useState<'' | 'dine_in' | 'delivery'>('')
  const [employeeId, setEmployeeId] = useState('')
  const [bucket, setBucket] = useState<Bucket>('day')

  const range = useMemo(() => ({ from: dayBounds(from).from, to: dayBounds(to).to }), [from, to])
  const employees = useProfiles(true)

  const summary = useQuery({
    queryKey: ['report-summary', range, serviceMode, employeeId],
    queryFn: () =>
      api.getFinancialSummary({
        from: range.from,
        to: range.to,
        serviceMode: serviceMode || null,
        employeeId: employeeId || null,
      }),
  })

  const series = useQuery({
    queryKey: ['report-series', range, bucket, serviceMode],
    queryFn: () => api.getSalesSeries(range.from, range.to, bucket),
  })

  const products = useQuery({
    queryKey: ['report-products', range],
    queryFn: () => api.getTopProducts(range.from, range.to, 50),
  })

  const byEmployee = useQuery({
    queryKey: ['report-employees', range],
    queryFn: () => api.getSalesByEmployee(range.from, range.to),
  })

  const methods = useQuery({
    queryKey: ['report-methods', range],
    queryFn: () => api.getPaymentMethodReport(range.from, range.to),
  })

  const cashSessions = useQuery({
    queryKey: ['report-cash', range],
    queryFn: () => api.getCashSessionsReport(range.from, range.to),
  })

  if (summary.isLoading) return <LoadingBlock label="Gerando relatórios…" />
  if (summary.error) return <ErrorBlock message={translateError(summary.error)} onRetry={() => void summary.refetch()} />

  const data = summary.data

  return (
    <div className="space-y-4">
      <Card title="Filtros">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="De">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="Até">
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
          <Field label="Modalidade">
            <Select value={serviceMode} onChange={(event) => setServiceMode(event.target.value as typeof serviceMode)}>
              <option value="">Salão + delivery</option>
              <option value="dine_in">Somente salão</option>
              <option value="delivery">Somente delivery</option>
            </Select>
          </Field>
          <Field label="Funcionário">
            <Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              <option value="">Todos</option>
              {(employees.data ?? []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Agrupar por">
            <Select value={bucket} onChange={(event) => setBucket(event.target.value as Bucket)}>
              <option value="day">Dia</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="Faturamento bruto (itens)" value={formatMoney(data?.gross_items_cents ?? 0)} hint="Soma dos itens válidos, sem descontos e sem taxas" />
        <Metric title="Descontos" value={`- ${formatMoney(data?.discounts_cents ?? 0)}`} hint="Somente descontos autorizados e auditados" />
        <Metric title="Taxas de entrega" value={formatMoney(data?.delivery_fees_cents ?? 0)} hint="Cobradas nos pedidos de delivery" />
        <Metric title="Vendas líquidas válidas" value={formatMoney(data?.net_valid_cents ?? 0)} hint="Bruto − descontos + taxas (pedidos não cancelados)" />
        <Metric title="Recebido no período" value={formatMoney(data?.received_cents ?? 0)} hint="Data do recebimento (pode diferir da data da venda)" />
        <Metric title="Pendente" value={formatMoney(data?.pending_cents ?? 0)} hint="Saldos ainda não pagos" />
        <Metric title="Pedidos" value={String(data?.orders_valid_count ?? 0)} hint={`${data?.orders_cancelled_count ?? 0} cancelado(s)`} />
        <Metric title="Ticket médio" value={formatMoney(data?.ticket_average_cents ?? 0)} hint="Vendas líquidas ÷ pedidos válidos" />
      </div>

      <Card
        title="Série do período"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              downloadCsv(`serie-${from}-a-${to}.csv`, [
                ['Período', 'Pedidos', 'Bruto (R$)', 'Descontos (R$)', 'Líquido (R$)', 'Recebido (R$)'],
                ...(series.data ?? []).map((point) => [
                  new Date(point.bucket_start).toLocaleDateString('pt-BR'),
                  point.orders_count,
                  (point.gross_cents / 100).toFixed(2),
                  (point.discount_cents / 100).toFixed(2),
                  (point.net_cents / 100).toFixed(2),
                  (point.received_cents / 100).toFixed(2),
                ]),
              ])
              toast.success('Série exportada.')
            }}
          >
            Exportar CSV
          </Button>
        }
      >
        {(series.data ?? []).length === 0 ? (
          <EmptyState title="Sem dados no período" />
        ) : (
          <DataTable
            rows={series.data ?? []}
            rowKey={(row) => row.bucket_start}
            columns={[
              { key: 'period', header: 'Período', render: (row) => formatDate(row.bucket_start) },
              { key: 'orders', header: 'Pedidos', align: 'right', render: (row) => row.orders_count },
              { key: 'gross', header: 'Bruto', align: 'right', render: (row) => formatMoney(row.gross_cents) },
              { key: 'discount', header: 'Descontos', align: 'right', render: (row) => formatMoney(row.discount_cents) },
              { key: 'net', header: 'Líquido', align: 'right', render: (row) => formatMoney(row.net_cents) },
              { key: 'received', header: 'Recebido', align: 'right', render: (row) => formatMoney(row.received_cents) },
            ]}
          />
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Produtos mais vendidos"
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                downloadCsv(`produtos-${from}-a-${to}.csv`, [
                  ['Produto', 'Categoria', 'Quantidade', 'Total (R$)'],
                  ...(products.data ?? []).map((product) => [
                    product.product_name,
                    product.category_name ?? '',
                    product.quantity,
                    (product.total_cents / 100).toFixed(2),
                  ]),
                ])
                toast.success('Relatório de produtos exportado.')
              }}
            >
              CSV
            </Button>
          }
        >
          {(products.data ?? []).length === 0 ? (
            <EmptyState title="Sem vendas no período" />
          ) : (
            <DataTable
              rows={products.data ?? []}
              rowKey={(row) => row.product_id}
              columns={[
                { key: 'name', header: 'Produto', render: (row) => row.product_name },
                { key: 'category', header: 'Categoria', render: (row) => row.category_name ?? '—' },
                { key: 'qty', header: 'Qtd', align: 'right', render: (row) => row.quantity },
                { key: 'total', header: 'Total', align: 'right', render: (row) => formatMoney(row.total_cents) },
              ]}
            />
          )}
        </Card>

        <Card title="Vendas por funcionário">
          {(byEmployee.data ?? []).length === 0 ? (
            <EmptyState title="Sem vendas no período" />
          ) : (
            <DataTable
              rows={byEmployee.data ?? []}
              rowKey={(row) => row.profile_id}
              columns={[
                { key: 'name', header: 'Funcionário', render: (row) => row.full_name },
                {
                  key: 'role',
                  header: 'Função',
                  render: (row) => (row.role === 'admin' ? 'Administrador' : row.role === 'manager' ? 'Caixa' : 'Garçom'),
                },
                { key: 'orders', header: 'Pedidos', align: 'right', render: (row) => row.orders_count },
                { key: 'net', header: 'Líquido', align: 'right', render: (row) => formatMoney(row.net_cents) },
                { key: 'cancelled', header: 'Cancelados', align: 'right', render: (row) => row.cancelled_count },
              ]}
            />
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Formas de pagamento">
          {(methods.data ?? []).length === 0 ? (
            <EmptyState title="Sem recebimentos no período" />
          ) : (
            <DataTable
              rows={(methods.data ?? []).filter((row) => row.payments_count > 0)}
              rowKey={(row) => row.method_id}
              columns={[
                { key: 'label', header: 'Forma', render: (row) => row.label },
                { key: 'count', header: 'Recebimentos', align: 'right', render: (row) => row.payments_count },
                { key: 'received', header: 'Recebido', align: 'right', render: (row) => formatMoney(row.received_cents) },
                {
                  key: 'drawer',
                  header: 'Na gaveta',
                  align: 'right',
                  render: (row) => (row.in_drawer_cents > 0 ? formatMoney(row.in_drawer_cents) : '—'),
                },
              ]}
            />
          )}
        </Card>

        <Card title="Fechamentos de caixa e divergências">
          {(cashSessions.data ?? []).length === 0 ? (
            <EmptyState title="Nenhum caixa no período" />
          ) : (
            <DataTable
              rows={cashSessions.data ?? []}
              rowKey={(row) => row.session_id}
              columns={[
                { key: 'opened', header: 'Aberto', render: (row) => formatDateTime(row.opened_at) },
                { key: 'by', header: 'Responsável', render: (row) => row.opened_by_name ?? '—' },
                { key: 'expected', header: 'Esperado', align: 'right', render: (row) => formatMoney(row.expected_cents ?? 0) },
                { key: 'counted', header: 'Contado', align: 'right', render: (row) => formatMoney(row.counted_cents ?? 0) },
                {
                  key: 'diff',
                  header: 'Diferença',
                  align: 'right',
                  render: (row) => (
                    <span className={(row.difference_cents ?? 0) === 0 ? 'text-emerald-700' : 'text-red-700'}>
                      {formatMoney(row.difference_cents ?? 0)}
                    </span>
                  ),
                },
                { key: 'reason', header: 'Justificativa', render: (row) => row.variance_reason ?? '—' },
              ]}
            />
          )}
        </Card>
      </div>

      <Card title="Definições usadas nos indicadores">
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
          <li><strong>Faturamento bruto (itens)</strong>: soma dos itens não cancelados, sem descontos e sem taxas.</li>
          <li><strong>Vendas líquidas válidas</strong>: bruto − descontos + taxas de entrega, apenas pedidos não cancelados.</li>
          <li><strong>Recebido</strong>: pagamentos confirmados cuja <em>data de recebimento</em> cai no período (pagamentos
            estornados não contam).</li>
          <li><strong>Pendente</strong>: total menos pago dos pedidos válidos do período.</li>
          <li><strong>Ticket médio</strong>: vendas líquidas ÷ pedidos válidos.</li>
          <li>Pedidos cancelados aparecem separados e nunca entram como venda válida.</li>
          <li>Não há indicador de lucro: o sistema não possui cadastro de custos e despesas.</li>
        </ul>
      </Card>
    </div>
  )
}

function Metric({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>
    </div>
  )
}
