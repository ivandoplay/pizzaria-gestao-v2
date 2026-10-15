import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'
import { useProfiles } from '../lib/hooks'
import {
  Button,
  Callout,
  Card,
  DataTable,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  PageHeader,
  SegmentedControl,
  Select,
  StatTile,
  useToast,
} from '../components/ui'
import {
  addDaysInputValue,
  dayBounds,
  downloadCsv,
  formatDate,
  formatDateTime,
  formatMoney,
  plural,
  todayInputValue,
} from '../lib/format'
import { translateError } from '../lib/errors'
import { ROLE_LABELS } from '../lib/types'

type Bucket = 'day' | 'week' | 'month'
type Atalho = 'hoje' | 'ontem' | '7d' | '30d' | 'mes' | 'custom'

export default function ReportsPage() {
  const toast = useToast()
  const [from, setFrom] = useState(todayInputValue())
  const [to, setTo] = useState(todayInputValue())
  const [atalho, setAtalho] = useState<Atalho>('hoje')
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

  const data = summary.data
  const pontos = series.data ?? []
  const maiorLiquido = Math.max(1, ...pontos.map((point) => point.net_cents))
  const divergencias = (cashSessions.data ?? []).filter((row) => (row.difference_cents ?? 0) !== 0)

  function aplicarAtalho(valor: Atalho) {
    setAtalho(valor)
    if (valor === 'hoje') {
      setFrom(todayInputValue())
      setTo(todayInputValue())
    } else if (valor === 'ontem') {
      setFrom(addDaysInputValue(-1))
      setTo(addDaysInputValue(-1))
    } else if (valor === '7d') {
      setFrom(addDaysInputValue(-6))
      setTo(todayInputValue())
    } else if (valor === '30d') {
      setFrom(addDaysInputValue(-29))
      setTo(todayInputValue())
    } else if (valor === 'mes') {
      const hoje = todayInputValue()
      setFrom(`${hoje.slice(0, 7)}-01`)
      setTo(hoje)
    }
  }

  function exportarResumo() {
    if (!data) return
    downloadCsv(`resumo-gerencial-${from}-a-${to}.csv`, [
      ['Indicador', 'Valor'],
      ['Período', `${from} a ${to}`],
      ['Modalidade', serviceMode === '' ? 'Salão + delivery' : serviceMode === 'dine_in' ? 'Somente salão' : 'Somente delivery'],
      ['Faturamento bruto (itens)', (data.gross_items_cents / 100).toFixed(2)],
      ['Descontos', (data.discounts_cents / 100).toFixed(2)],
      ['Taxas de entrega', (data.delivery_fees_cents / 100).toFixed(2)],
      ['Vendas líquidas válidas', (data.net_valid_cents / 100).toFixed(2)],
      ['Recebido no período', (data.received_cents / 100).toFixed(2)],
      ['Pendente', (data.pending_cents / 100).toFixed(2)],
      ['Pedidos válidos', data.orders_valid_count],
      ['Pedidos cancelados', data.orders_cancelled_count],
      ['Cancelados (valor)', (data.cancelled_cents / 100).toFixed(2)],
      ['Ticket médio', (data.ticket_average_cents / 100).toFixed(2)],
      ['Salão — pedidos', data.dine_in.orders_count],
      ['Salão — líquido', (data.dine_in.net_cents / 100).toFixed(2)],
      ['Delivery — pedidos', data.delivery.orders_count],
      ['Delivery — líquido', (data.delivery.net_cents / 100).toFixed(2)],
    ])
    toast.success('Resumo gerencial exportado em CSV.')
  }

  if (summary.error) {
    return (
      <div>
        <PageHeader titulo="Relatórios" />
        <Callout tom="erro" titulo="Não foi possível gerar os relatórios">
          {translateError(summary.error)}
        </Callout>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        titulo="Relatórios"
        descricao="Faturamento, recebimento, produtos, equipe e conferência de caixa — sempre com as definições documentadas."
        acoes={
          <>
            <IconButton
              nome="atualizar"
              titulo="Recalcular relatórios"
              variant="secondary"
              disabled={summary.isFetching}
              onClick={() => {
                void summary.refetch()
                void series.refetch()
                void products.refetch()
                void byEmployee.refetch()
                void methods.refetch()
                void cashSessions.refetch()
              }}
            />
            <Button variant="secondary" icone="baixar" onClick={exportarResumo} disabled={!data}>
              Exportar resumo
            </Button>
          </>
        }
      />

      <Card className="mb-4" title="Filtros" icone="filtro" descricao="Aplicados aos indicadores, às séries e aos relatórios marcados abaixo.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<Atalho>
              valor={atalho}
              onChange={aplicarAtalho}
              opcoes={[
                { valor: 'hoje', rotulo: 'Hoje' },
                { valor: 'ontem', rotulo: 'Ontem' },
                { valor: '7d', rotulo: '7 dias' },
                { valor: '30d', rotulo: '30 dias' },
                { valor: 'mes', rotulo: 'Mês atual' },
                { valor: 'custom', rotulo: 'Escolher' },
              ]}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="De">
              <Input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value)
                  setAtalho('custom')
                }}
              />
            </Field>
            <Field label="Até">
              <Input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value)
                  setAtalho('custom')
                }}
              />
            </Field>
            <Field label="Modalidade" hint="Aplica aos indicadores e à série.">
              <Select value={serviceMode} onChange={(event) => setServiceMode(event.target.value as typeof serviceMode)}>
                <option value="">Salão + delivery</option>
                <option value="dine_in">Somente salão</option>
                <option value="delivery">Somente delivery</option>
              </Select>
            </Field>
            <Field label="Funcionário" hint="Aplica apenas aos indicadores.">
              <Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                <option value="">Todos</option>
                {(employees.data ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.full_name} ({ROLE_LABELS[profile.role]})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Agrupar série por">
              <Select value={bucket} onChange={(event) => setBucket(event.target.value as Bucket)}>
                <option value="day">Dia</option>
                <option value="week">Semana</option>
                <option value="month">Mês</option>
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      {summary.isLoading && !data ? (
        <div className="superficie mb-4 p-5">
          <LoadingBlock label="Gerando relatórios…" linhas={4} />
        </div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              rotulo="Vendas líquidas válidas"
              valor={formatMoney(data?.net_valid_cents ?? 0)}
              icone="dinheiro"
              tom="marca"
              detalhe="Bruto − descontos + taxas"
            />
            <StatTile
              rotulo="Recebido no período"
              valor={formatMoney(data?.received_cents ?? 0)}
              icone="check"
              tom="verde"
              detalhe="Data do recebimento, não da venda"
            />
            <StatTile
              rotulo="Pendente"
              valor={formatMoney(data?.pending_cents ?? 0)}
              icone="relogio"
              tom="ambar"
              detalhe="Saldos ainda não pagos"
            />
            <StatTile
              rotulo="Pedidos válidos"
              valor={data?.orders_valid_count ?? 0}
              icone="lista"
              detalhe={`${plural(data?.orders_cancelled_count ?? 0, 'cancelado', 'cancelados')} no período`}
            />
          </div>

          {/* Os indicadores secundários ficam em uma lista de conferência, não em
              cartões: são doze números que se leem em bloco, e doze cartões
              competiriam com os quatro principais. */}
          <Card
            className="mb-4"
            title="Detalhamento do período"
            icone="lista"
            descricao="Indicadores de conferência — os mesmos números usados nos relatórios exportados."
          >
            <div className="grid gap-x-8 gap-y-0 sm:grid-cols-2 xl:grid-cols-3">
              <Linha rotulo="Faturamento bruto (itens)" dica="Sem descontos e sem taxas">
                {formatMoney(data?.gross_items_cents ?? 0)}
              </Linha>
              <Linha rotulo="Descontos" dica="Somente autorizados e auditados">
                {formatMoney(data?.discounts_cents ?? 0)}
              </Linha>
              <Linha rotulo="Taxas de entrega" dica="Cobradas no delivery">
                {formatMoney(data?.delivery_fees_cents ?? 0)}
              </Linha>
              <Linha rotulo="Ticket médio" dica="Vendas líquidas ÷ pedidos válidos">
                {formatMoney(data?.ticket_average_cents ?? 0)}
              </Linha>
              <Linha rotulo="Salão — pedidos" dica={`líquido ${formatMoney(data?.dine_in.net_cents ?? 0)}`}>
                {data?.dine_in.orders_count ?? 0}
              </Linha>
              <Linha rotulo="Delivery — pedidos" dica={`líquido ${formatMoney(data?.delivery.net_cents ?? 0)}`}>
                {data?.delivery.orders_count ?? 0}
              </Linha>
              <Linha
                rotulo="Cancelados"
                dica={`${plural(data?.orders_cancelled_count ?? 0, 'pedido', 'pedidos')} fora da venda válida`}
                alerta={(data?.cancelled_cents ?? 0) > 0}
              >
                {formatMoney(data?.cancelled_cents ?? 0)}
              </Linha>
              <Linha
                rotulo="Caixas com divergência"
                dica={`${plural(cashSessions.data?.length ?? 0, 'turno', 'turnos')} no período`}
                alerta={divergencias.length > 0}
              >
                {divergencias.length}
              </Linha>
            </div>
          </Card>
        </>
      )}

      <Card
        className="mb-4"
        title="Série do período"
        icone="relatorios"
        descricao={`Recebimento e vendas agrupados por ${bucket === 'day' ? 'dia' : bucket === 'week' ? 'semana' : 'mês'}.`}
        padded={false}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icone="baixar"
            disabled={pontos.length === 0}
            onClick={() => {
              downloadCsv(`serie-${from}-a-${to}.csv`, [
                ['Período', 'Pedidos', 'Bruto (R$)', 'Descontos (R$)', 'Líquido (R$)', 'Recebido (R$)'],
                ...pontos.map((point) => [
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
            CSV
          </Button>
        }
      >
        <div className="p-3.5">
          <DataTable
            rows={pontos}
            rowKey={(row) => row.bucket_start}
            maxHeight="46vh"
            emptyMessage="Sem dados no período"
            emptyDescription="Nenhum pedido registrado nesta janela de datas."
            columns={[
              { key: 'period', header: 'Período', render: (row) => <span className="whitespace-nowrap">{formatDate(row.bucket_start)}</span>, width: 'w-32' },
              { key: 'orders', header: 'Pedidos', align: 'right', render: (row) => row.orders_count },
              { key: 'gross', header: 'Bruto', align: 'right', render: (row) => formatMoney(row.gross_cents) },
              { key: 'discount', header: 'Descontos', align: 'right', render: (row) => formatMoney(row.discount_cents) },
              {
                key: 'net',
                header: 'Líquido',
                align: 'right',
                render: (row) => (
                  <span className="relative inline-flex min-w-[110px] justify-end">
                    <span
                      className="absolute inset-y-0 right-0 -z-0 rounded bg-brand-50"
                      style={{ width: `${Math.max(2, (row.net_cents / maiorLiquido) * 100)}%` }}
                      aria-hidden
                    />
                    <span className="relative font-semibold text-ink-900">{formatMoney(row.net_cents)}</span>
                  </span>
                ),
              },
              {
                key: 'received',
                header: 'Recebido',
                align: 'right',
                render: (row) => <span className="text-emerald-700">{formatMoney(row.received_cents)}</span>,
              },
            ]}
          />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Produtos mais vendidos"
          icone="cardapio"
          descricao="Considera todos os pedidos do período (sem o filtro de modalidade/funcionário)."
          padded={false}
          actions={
            <Button
              size="sm"
              variant="secondary"
              icone="baixar"
              disabled={(products.data ?? []).length === 0}
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
          <div className="p-3.5">
            <DataTable
              rows={products.data ?? []}
              rowKey={(row) => row.product_id}
              maxHeight="46vh"
              emptyMessage="Sem vendas no período"
              columns={[
                { key: 'name', header: 'Produto', render: (row) => <span className="text-ink-800">{row.product_name}</span> },
                { key: 'category', header: 'Categoria', render: (row) => <span className="text-xs text-ink-500">{row.category_name ?? '—'}</span> },
                { key: 'qty', header: 'Qtd', align: 'right', render: (row) => <span className="font-medium">{row.quantity}</span> },
                { key: 'total', header: 'Total', align: 'right', render: (row) => <span className="font-medium">{formatMoney(row.total_cents)}</span> },
              ]}
            />
          </div>
        </Card>

        <Card
          title="Vendas por funcionário"
          icone="equipe"
          descricao="Quem registrou os pedidos do período (líquido e cancelamentos)."
          padded={false}
        >
          <div className="p-3.5">
            <DataTable
              rows={byEmployee.data ?? []}
              rowKey={(row) => row.profile_id}
              maxHeight="46vh"
              emptyMessage="Sem vendas no período"
              columns={[
                { key: 'name', header: 'Funcionário', render: (row) => <span className="text-ink-800">{row.full_name}</span> },
                { key: 'role', header: 'Função', render: (row) => <span className="text-xs text-ink-500">{ROLE_LABELS[row.role]}</span> },
                { key: 'orders', header: 'Pedidos', align: 'right', render: (row) => row.orders_count },
                { key: 'net', header: 'Líquido', align: 'right', render: (row) => <span className="font-medium">{formatMoney(row.net_cents)}</span> },
                {
                  key: 'cancelled',
                  header: 'Cancelados',
                  align: 'right',
                  render: (row) => (
                    <span className={row.cancelled_count > 0 ? 'font-medium text-red-700' : 'text-ink-400'}>
                      {row.cancelled_count}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Formas de pagamento" icone="dinheiro" padded={false}>
          <div className="p-3.5">
            <DataTable
              rows={(methods.data ?? []).filter((row) => row.payments_count > 0)}
              rowKey={(row) => row.method_id}
              emptyMessage="Sem recebimentos no período"
              columns={[
                { key: 'label', header: 'Forma', render: (row) => <span className="text-ink-800">{row.label}</span> },
                { key: 'count', header: 'Recebimentos', align: 'right', render: (row) => row.payments_count },
                { key: 'received', header: 'Recebido', align: 'right', render: (row) => <span className="font-medium">{formatMoney(row.received_cents)}</span> },
                {
                  key: 'drawer',
                  header: 'Na gaveta',
                  align: 'right',
                  render: (row) => (row.in_drawer_cents > 0 ? formatMoney(row.in_drawer_cents) : '—'),
                },
              ]}
            />
          </div>
        </Card>

        <Card title="Fechamentos de caixa e divergências" icone="cofre" padded={false}>
          <div className="p-3.5">
            <DataTable
              rows={cashSessions.data ?? []}
              rowKey={(row) => row.session_id}
              maxHeight="46vh"
              emptyMessage="Nenhum caixa no período"
              columns={[
                { key: 'opened', header: 'Aberto', render: (row) => <span className="whitespace-nowrap text-xs">{formatDateTime(row.opened_at)}</span>, width: 'w-40' },
                { key: 'by', header: 'Responsável', render: (row) => <span className="text-xs text-ink-600">{row.opened_by_name ?? '—'}</span> },
                { key: 'expected', header: 'Esperado', align: 'right', render: (row) => formatMoney(row.expected_cents ?? 0) },
                { key: 'counted', header: 'Contado', align: 'right', render: (row) => formatMoney(row.counted_cents ?? 0) },
                {
                  key: 'diff',
                  header: 'Diferença',
                  align: 'right',
                  render: (row) => (
                    <span className={(row.difference_cents ?? 0) === 0 ? 'text-emerald-700' : 'font-medium text-red-700'}>
                      {formatMoney(row.difference_cents ?? 0)}
                    </span>
                  ),
                },
                { key: 'reason', header: 'Justificativa', render: (row) => <span className="text-xs text-ink-600">{row.variance_reason ?? '—'}</span> },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Definições usadas nos indicadores" icone="info">
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-600">
            <li>
              <strong>Faturamento bruto (itens)</strong>: soma dos itens não cancelados, sem descontos e sem taxas.
            </li>
            <li>
              <strong>Vendas líquidas válidas</strong>: bruto − descontos + taxas de entrega, apenas pedidos não
              cancelados.
            </li>
            <li>
              <strong>Recebido</strong>: pagamentos confirmados cuja <em>data de recebimento</em> cai no período
              (estornos não contam).
            </li>
            <li>
              <strong>Pendente</strong>: total menos pago dos pedidos válidos do período.
            </li>
            <li>
              <strong>Ticket médio</strong>: vendas líquidas ÷ pedidos válidos.
            </li>
            <li>Pedidos cancelados aparecem separados e nunca entram como venda válida.</li>
            <li>
              Não há indicador de lucro: o sistema não possui cadastro de custos e despesas. As definições completas
              estão em <strong>docs/RELATORIOS.md</strong>.
            </li>
          </ul>
        </Card>
      </div>
    </div>
  )
}

/** Linha de indicador de conferência (rótulo, dica e valor). */
function Linha({
  rotulo,
  dica,
  alerta,
  children,
}: {
  rotulo: string
  dica?: string
  alerta?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-100 py-2.5 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0 xl:[&:nth-last-child(3)]:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-pequeno text-ink-700">{rotulo}</p>
        {dica && <p className="truncate text-[12px] text-ink-400">{dica}</p>}
      </div>
      <span className={`num shrink-0 text-base font-semibold ${alerta ? 'text-rose-700' : 'text-ink-900'}`}>
        {children}
      </span>
    </div>
  )
}
