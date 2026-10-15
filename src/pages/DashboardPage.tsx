import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useOpenCashSession, useOrders, useSettings, useTables } from '../lib/hooks'
import * as api from '../lib/api'
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeader,
  SegmentedControl,
  StatTile,
  StatusPill,
  useToast,
} from '../components/ui'
import { Icon } from '../components/icons'
import {
  addDaysInputValue,
  dayBounds,
  downloadCsv,
  formatDate,
  formatMoney,
  plural,
  todayInputValue,
  todayRange,
} from '../lib/format'
import { translateError } from '../lib/errors'
import type { OrderStatus } from '../lib/types'

type PeriodKey = 'today' | '7d' | '30d' | 'custom'

const PERIODOS: { valor: PeriodKey; rotulo: string }[] = [
  { valor: 'today', rotulo: 'Hoje' },
  { valor: '7d', rotulo: '7 dias' },
  { valor: '30d', rotulo: '30 dias' },
  { valor: 'custom', rotulo: 'Personalizado' },
]

export default function DashboardPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [customFrom, setCustomFrom] = useState(todayInputValue())
  const [customTo, setCustomTo] = useState(todayInputValue())

  const range = useMemo(() => {
    if (period === 'today') return todayRange()
    if (period === '7d') {
      return { from: dayBounds(addDaysInputValue(-6)).from, to: dayBounds(addDaysInputValue(0)).to }
    }
    if (period === '30d') {
      return { from: dayBounds(addDaysInputValue(-29)).from, to: dayBounds(addDaysInputValue(0)).to }
    }
    return { from: dayBounds(customFrom).from, to: dayBounds(customTo).to }
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
  const cash = useOpenCashSession()

  const data = summary.data
  const pontos = series.data ?? []
  const maxNet = Math.max(1, ...pontos.map((point) => point.net_cents))
  const totalPeriodo = pontos.reduce((soma, point) => soma + point.net_cents, 0)

  const tableList = tables.data ?? []
  const pedidosAbertos = openOrders.data ?? []
  const producao = pedidosAbertos.filter((order) => ['received', 'confirmed', 'preparing'].includes(order.status))
  const prontos = pedidosAbertos.filter((order) => order.status === 'ready')
  const aReceber = pedidosAbertos.reduce((soma, order) => soma + order.balance_cents, 0)

  function exportarCsv() {
    if (!data) return
    const periodo = period === 'custom' ? `${customFrom}-a-${customTo}` : period
    downloadCsv(`resumo-${periodo}.csv`, [
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
  }

  return (
    <div>
      <PageHeader
        titulo="Painel do dia"
        descricao={`Faturamento, recebimento e operação do período. Fuso da operação: ${
          settings.data?.timezone ?? 'America/Fortaleza'
        }.`}
        acoes={
          <>
            <Button
              variant="secondary"
              icone="atualizar"
              onClick={() => {
                void summary.refetch()
                void series.refetch()
                void topProducts.refetch()
                void paymentsByMethod.refetch()
                void tables.refetch()
                void openOrders.refetch()
              }}
              disabled={summary.isFetching}
            >
              Atualizar
            </Button>
            <Button variant="secondary" icone="baixar" onClick={exportarCsv} disabled={!data}>
              Exportar CSV
            </Button>
          </>
        }
      />

      {/* Filtro de período */}
      <div className="mb-5 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl<PeriodKey> valor={period} onChange={setPeriod} opcoes={PERIODOS} />
        {period === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink-500">
              <span className="mb-1 block font-medium text-ink-600">De</span>
              <Input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="w-40"
              />
            </label>
            <label className="text-xs text-ink-500">
              <span className="mb-1 block font-medium text-ink-600">Até</span>
              <Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="w-40" />
            </label>
          </div>
        )}
        {period !== 'custom' && (
          <p className="text-xs text-ink-500">
            Período analisado: {formatDate(range.from)} até {formatDate(range.to)}
          </p>
        )}
      </div>

      {summary.error && (
        <div className="mb-5">
          <ErrorBlock message={translateError(summary.error)} onRetry={() => void summary.refetch()} />
        </div>
      )}

      {/* Operação agora */}
      <section className="mb-6">
        <h2 className="rotulo mb-2">Acontecendo agora</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            rotulo="Caixa"
            valor={cash.isLoading ? '…' : cash.data ? 'Aberto' : 'Fechado'}
            icone="cofre"
            tom={cash.data ? 'verde' : 'vermelho'}
            detalhe={
              cash.data
                ? `Gaveta esperada ${formatMoney(cash.data.expected_cash_cents)}`
                : 'Sem turno de caixa aberto'
            }
          />
          <StatTile
            rotulo="Mesas em atendimento"
            valor={tableList.filter((mesa) => mesa.status !== 'available' && mesa.status !== 'inactive').length}
            icone="mesas"
            tom="ambar"
            detalhe={`${tableList.filter((mesa) => mesa.status === 'available').length} livres no salão`}
          />
          <StatTile
            rotulo="Em produção"
            valor={producao.length}
            icone="raio"
            tom="marca"
            detalhe={`${plural(prontos.length, 'pronto', 'prontos')} aguardando entrega`}
          />
          <StatTile
            rotulo="A receber agora"
            valor={formatMoney(aReceber)}
            icone="dinheiro"
            detalhe={`${plural(pedidosAbertos.length, 'conta', 'contas')} em aberto`}
          />
        </div>
      </section>

      {/* Indicadores financeiros do período */}
      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="rotulo">Resultado do período</h2>
          {summary.isFetching && <span className="text-[11px] text-ink-400">recalculando…</span>}
        </div>

        {summary.isLoading && !data ? (
          <div className="superficie p-5">
            <LoadingBlock label="Calculando indicadores do período…" linhas={3} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              rotulo="Vendas líquidas"
              valor={formatMoney(data?.net_valid_cents ?? 0)}
              icone="dinheiro"
              tom="marca"
              detalhe={plural(data?.orders_valid_count ?? 0, 'pedido válido', 'pedidos válidos')}
            />
            <StatTile
              rotulo="Recebido"
              valor={formatMoney(data?.received_cents ?? 0)}
              icone="check"
              tom="verde"
              detalhe="Somente pagamentos confirmados"
            />
            <StatTile
              rotulo="Pendente"
              valor={formatMoney(data?.pending_cents ?? 0)}
              icone="relogio"
              tom="ambar"
              detalhe="Saldos em aberto no período"
            />
            <StatTile
              rotulo="Ticket médio"
              valor={formatMoney(data?.ticket_average_cents ?? 0)}
              icone="soma"
              detalhe="Vendas líquidas ÷ pedidos válidos"
            />
          </div>
        )}

        <div className="mt-3 grid gap-2 rounded-card border border-ink-200 bg-white px-4 py-2.5 shadow-card sm:grid-cols-2 lg:grid-cols-4">
          <LinhaDeDetalhe rotulo="Bruto (itens)" valor={formatMoney(data?.gross_items_cents ?? 0)} />
          <LinhaDeDetalhe rotulo="Descontos" valor={formatMoney(data?.discounts_cents ?? 0)} />
          <LinhaDeDetalhe rotulo="Taxas de entrega" valor={formatMoney(data?.delivery_fees_cents ?? 0)} />
          <LinhaDeDetalhe
            rotulo={`Cancelados (${plural(data?.orders_cancelled_count ?? 0, 'pedido', 'pedidos')})`}
            valor={formatMoney(data?.cancelled_cents ?? 0)}
            alerta={(data?.cancelled_cents ?? 0) > 0}
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card
          title="Evolução das vendas"
          descricao={`Vendas líquidas por dia no período selecionado · total ${formatMoney(totalPeriodo)}`}
          icone="relatorios"
        >
          {series.isLoading ? (
            <LoadingBlock label="Carregando série…" linhas={2} />
          ) : pontos.length === 0 ? (
            <EmptyState
              icone="relatorios"
              title="Sem vendas no período"
              description="Nenhum pedido registrado nesta janela de datas."
            />
          ) : (
            <div className="space-y-3">
              {(() => {
                // Altura em pixels (e não em %): porcentagem dentro de uma coluna
                // de altura automática colapsa — era o motivo de a barra de um
                // único dia não aparecer no gráfico.
                const ALTURA_MAXIMA = 150
                const mostrarValores = pontos.length <= 10
                return (
                  <div className="scroll-thin flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: ALTURA_MAXIMA + 44 }}>
                    {pontos.map((point) => {
                      const altura = Math.max(6, Math.round((point.net_cents / maxNet) * ALTURA_MAXIMA))
                      const destaque = point.net_cents === maxNet
                      const titulo = `${formatDate(point.bucket_start)}: ${formatMoney(point.net_cents)} em ${plural(point.orders_count, 'pedido', 'pedidos')}`
                      return (
                        <div
                          key={point.bucket_start}
                          className="group flex min-w-[38px] flex-1 flex-col items-center justify-end gap-1"
                          title={titulo}
                        >
                          <span
                            className={`num whitespace-nowrap text-[10px] font-medium text-ink-500 transition ${
                              mostrarValores ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                          >
                            {formatMoney(point.net_cents)}
                          </span>
                          <div
                            className={`w-full max-w-[52px] rounded-t-md transition-all duration-200 group-hover:opacity-90 ${
                              destaque ? 'bg-brand-600' : 'bg-brand-400'
                            }`}
                            style={{ height: altura }}
                          />
                          <span className="whitespace-nowrap text-[10px] text-ink-500">
                            {new Date(point.bucket_start).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              timeZone: settings.data?.timezone ?? 'America/Fortaleza',
                            })}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-3">
                <Badge tone="brand">
                  Salão: {plural(data?.dine_in.orders_count ?? 0, 'pedido', 'pedidos')} ·{' '}
                  {formatMoney(data?.dine_in.net_cents ?? 0)}
                </Badge>
                <Badge tone="blue">
                  Delivery: {plural(data?.delivery.orders_count ?? 0, 'pedido', 'pedidos')} ·{' '}
                  {formatMoney(data?.delivery.net_cents ?? 0)}
                </Badge>
              </div>
            </div>
          )}
        </Card>

        <Card title="Produtos mais vendidos" descricao="Top 8 do período, por valor vendido." icone="cardapio">
          {topProducts.isLoading ? (
            <LoadingBlock label="Carregando produtos…" linhas={4} />
          ) : (topProducts.data ?? []).length === 0 ? (
            <EmptyState icone="cardapio" title="Sem vendas no período" />
          ) : (
            <ol className="space-y-2.5">
              {(topProducts.data ?? []).map((product, indice) => (
                <li key={product.product_id} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-xs font-semibold text-ink-600">
                    {indice + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink-800">{product.product_name}</span>
                    <span className="text-[11px] text-ink-500">{plural(product.quantity, 'unidade', 'unidades')}</span>
                  </span>
                  <span className="num shrink-0 text-[13px] font-semibold text-ink-900">
                    {formatMoney(product.total_cents)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Recebimentos por forma de pagamento" icone="dinheiro">
          {paymentsByMethod.isLoading ? (
            <LoadingBlock label="Carregando formas…" linhas={3} />
          ) : (paymentsByMethod.data ?? []).filter((row) => row.received_cents > 0 || row.payments_count > 0).length === 0 ? (
            <EmptyState icone="dinheiro" title="Sem recebimentos no período" />
          ) : (
            <ul className="space-y-2">
              {(paymentsByMethod.data ?? [])
                .filter((row) => row.received_cents > 0 || row.payments_count > 0)
                .map((row) => (
                  <li key={row.method_id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-ink-700">{row.label}</span>
                      {row.in_drawer_cents > 0 && <Badge tone="blue">gaveta</Badge>}
                    </span>
                    <span className="num shrink-0 font-medium text-ink-900">{formatMoney(row.received_cents)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card title="Mesas agora" icone="mesas">
          <ul className="space-y-1.5 text-sm">
            <Linha rotulo="Disponíveis" valor={tableList.filter((mesa) => mesa.status === 'available').length} />
            <Linha
              rotulo="Em atendimento"
              valor={tableList.filter((mesa) => mesa.status !== 'available' && mesa.status !== 'inactive').length}
            />
            <Linha rotulo="Aguardando fechamento" valor={tableList.filter((mesa) => mesa.status === 'awaiting_close').length} />
            <Linha rotulo="Atenção (mais de 2h)" valor={tableList.filter((mesa) => mesa.status === 'attention').length} />
          </ul>
          <Button variant="secondary" size="sm" className="mt-3" icone="mesas" onClick={() => navigate('/mesas')}>
            Abrir mapa de mesas
          </Button>
        </Card>

        <Card title="Produção" icone="raio" descricao="Conduzida pelo caixa/administrador — não existe perfil de cozinha nesta versão.">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-card border border-amber-200 bg-amber-50/60 p-3">
              <p className="num text-2xl font-semibold text-ink-900">{producao.length}</p>
              <p className="text-[11px] text-ink-500">recebido/confirmado/em preparo</p>
            </div>
            <div className="rounded-card border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="num text-2xl font-semibold text-ink-900">{prontos.length}</p>
              <p className="text-[11px] text-ink-500">prontos aguardando entrega</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="Pedidos em andamento"
          descricao="Contas abertas no salão e no delivery."
          icone="entrega"
          padded={false}
          actions={
            <Button size="sm" variant="secondary" icone="caixa" onClick={() => navigate('/caixa')}>
              Ir para o caixa
            </Button>
          }
        >
          <div className="p-3.5">
            {pedidosAbertos.length === 0 ? (
              <EmptyState icone="check" title="Nenhum pedido em aberto" description="Todas as contas do período foram encerradas." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {pedidosAbertos.slice(0, 12).map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="text-[13px] font-semibold text-ink-900">#{order.order_number}</span>
                      <StatusPill status={order.status as OrderStatus} />
                      <span className="truncate text-[13px] text-ink-600">
                        {order.service_mode === 'dine_in'
                          ? `Mesa ${order.table_number ?? '—'}`
                          : order.customer_name_snapshot ?? 'Delivery'}{' '}
                        · {order.created_by_name}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="num text-[13px] font-medium text-ink-800">{formatMoney(order.total_cents)}</span>
                      {order.balance_cents > 0 ? (
                        <Badge tone="amber" ponto>
                          falta {formatMoney(order.balance_cents)}
                        </Badge>
                      ) : (
                        <Badge tone="green" ponto>
                          quitada
                        </Badge>
                      )}
                      <Icon nome="seta-direita" className="h-4 w-4 text-ink-400" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Callout tom="info" titulo="Como ler estes números">
          Os indicadores são de <strong>faturamento e recebimento</strong>. O sistema não tem cadastro de custos e
          despesas, por isso não existe indicador de lucro — as definições exatas de cada número estão em{' '}
          <strong>docs/RELATORIOS.md</strong>.
        </Callout>
      </div>
    </div>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-ink-600">{rotulo}</span>
      <span className="num font-medium text-ink-900">{valor}</span>
    </li>
  )
}

/**
 * Linha de detalhamento do período (bruto, descontos, taxas, cancelados).
 * Fica fora da faixa de indicadores de propósito: os números que o dono olha
 * todo dia são quatro — o resto é conferência.
 */
function LinhaDeDetalhe({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-ink-100 py-1.5 sm:border-l sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
      <span className="text-pequeno text-ink-500">{rotulo}</span>
      <span className={`num text-pequeno font-semibold ${alerta ? 'text-rose-700' : 'text-ink-800'}`}>{valor}</span>
    </div>
  )
}
