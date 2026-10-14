import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'
import {
  Badge,
  Button,
  Callout,
  Card,
  DataTable,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
  StatusPill,
  useToast,
} from '../components/ui'
import {
  addDaysInputValue,
  dayBounds,
  downloadCsv,
  formatDateTime,
  formatMoney,
  formatPhone,
  todayInputValue,
} from '../lib/format'
import { translateError } from '../lib/errors'
import { ORDER_STATUS_LABELS, type OrderStatus } from '../lib/types'
import { usePaymentMethods } from '../lib/hooks'

const PAGE_SIZE = 50

type Atalho = 'hoje' | 'ontem' | '7d' | '30d' | 'custom'

export default function HistoryPage() {
  const toast = useToast()
  const [from, setFrom] = useState(todayInputValue())
  const [to, setTo] = useState(todayInputValue())
  const [atalho, setAtalho] = useState<Atalho>('hoje')
  const [status, setStatus] = useState('')
  const [serviceMode, setServiceMode] = useState('')
  const [tableNumber, setTableNumber] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [detailId, setDetailId] = useState<string | null>(null)

  const range = useMemo(() => ({ from: dayBounds(from).from, to: dayBounds(to).to }), [from, to])

  const query = useQuery({
    queryKey: ['orders-page', range, status, serviceMode, tableNumber, search, page],
    queryFn: () =>
      api.getOrdersPage({
        from: range.from,
        to: range.to,
        status: status || null,
        serviceMode: serviceMode || null,
        tableNumber: tableNumber ? Number(tableNumber) : null,
        search: search.trim() || null,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  })

  const rows = query.data ?? []
  const total = rows[0]?.total_count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const totaisPagina = useMemo(
    () => ({
      total: rows.reduce((soma, row) => soma + row.total_cents, 0),
      pago: rows.reduce((soma, row) => soma + row.paid_cents, 0),
      falta: rows.reduce((soma, row) => soma + row.balance_cents, 0),
    }),
    [rows],
  )

  function aplicarAtalho(valor: Atalho) {
    setAtalho(valor)
    setPage(0)
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
    }
  }

  function exportar() {
    downloadCsv(`pedidos-${from}-a-${to}.csv`, [
      [
        'Pedido',
        'Data',
        'Modalidade',
        'Mesa',
        'Cliente',
        'Situação',
        'Total (R$)',
        'Pago (R$)',
        'Falta (R$)',
        'Registrado por',
        'Conta fechada em',
        'Motivo do cancelamento',
      ],
      ...rows.map((row) => [
        row.order_number,
        formatDateTime(row.created_at),
        row.service_mode === 'dine_in' ? 'Salão' : 'Delivery',
        row.table_number ?? '',
        row.customer_name ?? '',
        ORDER_STATUS_LABELS[row.status],
        (row.total_cents / 100).toFixed(2),
        (row.paid_cents / 100).toFixed(2),
        (row.balance_cents / 100).toFixed(2),
        row.created_by_name,
        row.account_closed_at ? formatDateTime(row.account_closed_at) : '',
        row.cancel_reason ?? '',
      ]),
    ])
    toast.success(`Página ${page + 1} exportada em CSV (${rows.length} pedido(s)).`)
  }

  function limparFiltros() {
    aplicarAtalho('hoje')
    setStatus('')
    setServiceMode('')
    setTableNumber('')
    setSearch('')
  }

  return (
    <div>
      <PageHeader
        titulo="Histórico de pedidos"
        descricao="Consulta completa de salão e delivery, com itens, recebimentos e mudanças de situação."
        acoes={
          <>
            <IconButton
              nome="atualizar"
              titulo="Recarregar"
              variant="secondary"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            />
            <Button variant="secondary" icone="baixar" onClick={exportar} disabled={rows.length === 0}>
              Exportar página
            </Button>
          </>
        }
      />

      <Card className="mb-4" icone="filtro" title="Filtros" descricao="O período é aplicado no servidor, no fuso da pizzaria.">
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
                { valor: 'custom', rotulo: 'Escolher' },
              ]}
            />
            <Button variant="ghost" size="sm" icone="lixeira" onClick={limparFiltros}>
              Limpar filtros
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="De">
              <Input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value)
                  setAtalho('custom')
                  setPage(0)
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
                  setPage(0)
                }}
              />
            </Field>
            <Field label="Situação">
              <Select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value)
                  setPage(0)
                }}
              >
                <option value="">Todas as situações</option>
                {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((key) => (
                  <option key={key} value={key}>
                    {ORDER_STATUS_LABELS[key]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Modalidade">
              <Select
                value={serviceMode}
                onChange={(event) => {
                  setServiceMode(event.target.value)
                  setPage(0)
                }}
              >
                <option value="">Salão e delivery</option>
                <option value="dine_in">Salão</option>
                <option value="delivery">Delivery</option>
              </Select>
            </Field>
            <Field label="Mesa" hint="Somente pedidos de salão.">
              <Input
                type="number"
                min={1}
                value={tableNumber}
                onChange={(event) => {
                  setTableNumber(event.target.value)
                  setPage(0)
                }}
                placeholder="ex.: 4"
              />
            </Field>
            <Field
              label="Busca"
              className="sm:col-span-2 lg:col-span-3"
              hint="Número do pedido, nome ou telefone do cliente."
            >
              <SearchInput
                value={search}
                onValueChange={(valor) => {
                  setSearch(valor)
                  setPage(0)
                }}
                placeholder="ex.: 128, Maria, (86) 99999…"
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card
        title={`Pedidos encontrados${total > 0 ? `: ${total}` : ''}`}
        icone="historico"
        descricao="Clique em uma linha para ver itens, recebimentos e histórico de situação."
        padded={false}
      >
        <div className="p-3.5">
          {query.isLoading ? (
            <LoadingBlock label="Consultando o histórico…" linhas={6} />
          ) : query.error ? (
            <div>
              <Callout tom="erro" titulo="Não foi possível consultar o histórico">
                {translateError(query.error)}
              </Callout>
              <Button variant="secondary" className="mt-3" icone="atualizar" onClick={() => void query.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : (
            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => setDetailId(row.id)}
              maxHeight="58vh"
              emptyMessage="Nenhum pedido no período"
              emptyDescription="Ajuste as datas, a situação ou limpe a busca para encontrar outros pedidos."
              columns={[
                {
                  key: 'number',
                  header: 'Pedido',
                  render: (row) => <span className="font-semibold text-ink-900">#{row.order_number}</span>,
                  width: 'w-24',
                },
                {
                  key: 'when',
                  header: 'Data',
                  render: (row) => <span className="whitespace-nowrap text-xs">{formatDateTime(row.created_at)}</span>,
                  width: 'w-40',
                },
                {
                  key: 'where',
                  header: 'Origem',
                  render: (row) =>
                    row.service_mode === 'dine_in' ? (
                      `Salão · Mesa ${row.table_number ?? '—'}`
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Badge tone="blue">delivery</Badge>
                      </span>
                    ),
                },
                {
                  key: 'customer',
                  header: 'Cliente',
                  render: (row) =>
                    row.service_mode === 'delivery' ? (
                      <span>
                        <span className="block text-ink-800">{row.customer_name ?? '—'}</span>
                        <span className="text-[11px] text-ink-500">{formatPhone(row.customer_phone)}</span>
                      </span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    ),
                },
                {
                  key: 'status',
                  header: 'Situação',
                  render: (row) => (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusPill status={row.status} />
                      {row.account_closed_at && <Badge tone="slate">conta fechada</Badge>}
                    </span>
                  ),
                },
                { key: 'total', header: 'Total', align: 'right', render: (row) => <span className="font-medium">{formatMoney(row.total_cents)}</span> },
                {
                  key: 'balance',
                  header: 'Falta',
                  align: 'right',
                  render: (row) => (
                    <span className={row.balance_cents > 0 ? 'font-medium text-brand-700' : 'text-emerald-700'}>
                      {formatMoney(row.balance_cents)}
                    </span>
                  ),
                },
                { key: 'by', header: 'Registrado por', render: (row) => <span className="text-xs text-ink-600">{row.created_by_name}</span> },
              ]}
              rodape={
                <>
                  <span>
                    Página {page + 1} de {pages} · nesta página: {formatMoney(totaisPagina.total)} em vendas,{' '}
                    {formatMoney(totaisPagina.pago)} recebido, {formatMoney(totaisPagina.falta)} em aberto
                  </span>
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icone="seta-esquerda"
                      disabled={page === 0}
                      onClick={() => setPage((current) => Math.max(0, current - 1))}
                    >
                      Anterior
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      iconeDireita="seta-direita"
                      disabled={page + 1 >= pages}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Próxima
                    </Button>
                  </span>
                </>
              }
            />
          )}
        </div>
      </Card>

      <OrderDetail orderId={detailId} onClose={() => setDetailId(null)} />
    </div>
  )
}

/** Detalhes: itens, pagamentos e histórico de situação (somente leitura). */
function OrderDetail({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const metodos = usePaymentMethods(true)
  const items = useQuery({
    queryKey: ['history-items', orderId],
    queryFn: () => api.fetchOrderItems(orderId ? [orderId] : []),
    enabled: Boolean(orderId),
  })
  const payments = useQuery({
    queryKey: ['history-payments', orderId],
    queryFn: () => api.fetchPayments(orderId ? [orderId] : []),
    enabled: Boolean(orderId),
  })
  const history = useQuery({
    queryKey: ['history-status', orderId],
    queryFn: () => api.fetchStatusHistory(orderId ? [orderId] : []),
    enabled: Boolean(orderId),
  })

  const nomeMetodo = (id: string) => metodos.data?.find((metodo) => metodo.id === id)?.label ?? 'forma não identificada'
  const itens = items.data ?? []
  const pagamentos = payments.data ?? []
  const totalPago = pagamentos
    .filter((payment) => payment.status === 'confirmed')
    .reduce((soma, payment) => soma + payment.amount_cents, 0)
  const totalItens = itens.filter((item) => !item.is_cancelled).reduce((soma, item) => soma + item.total_cents, 0)

  return (
    <Modal
      open={Boolean(orderId)}
      title="Detalhes do pedido"
      descricao="Registro histórico — os valores são os gravados no momento do pedido."
      onClose={onClose}
      size="lg"
    >
      <div className="space-y-5">
        <section>
          <h4 className="rotulo mb-2">Itens</h4>
          {items.isLoading ? (
            <LoadingBlock label="Carregando itens…" linhas={3} />
          ) : itens.length === 0 ? (
            <p className="text-sm text-ink-500">Sem itens registrados.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {itens.map((item) => (
                <li
                  key={item.id}
                  className={`rounded-control border p-2.5 ${
                    item.is_cancelled ? 'border-red-200 bg-red-50/60' : 'border-ink-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={`font-medium ${item.is_cancelled ? 'text-ink-500 line-through' : 'text-ink-900'}`}>
                      <span className="num">{item.quantity}×</span> {item.product_name}{' '}
                      <span className="font-normal text-ink-500">({item.size_name})</span>
                    </span>
                    <span className={`num shrink-0 ${item.is_cancelled ? 'text-red-700 line-through' : 'font-medium text-ink-900'}`}>
                      {formatMoney(item.total_cents)}
                    </span>
                  </div>
                  {item.flavors.length > 1 && (
                    <p className="text-[11px] text-ink-600">
                      Sabores: {item.flavors.map((flavor) => flavor.name).join(' + ')}
                      {item.pricing_rule &&
                        ` · regra do meio a meio: ${item.pricing_rule === 'highest' ? 'maior valor' : 'média'}`}
                    </p>
                  )}
                  {item.modifiers.length > 0 && (
                    <p className="text-[11px] text-ink-600">
                      Adicionais:{' '}
                      {item.modifiers
                        .map((modifier) => `${modifier.option_name} (${formatMoney(modifier.price_cents)})`)
                        .join(', ')}
                    </p>
                  )}
                  {item.notes && <p className="text-[11px] italic text-ink-500">Obs.: {item.notes}</p>}
                  {item.is_cancelled && (
                    <p className="text-[11px] font-medium text-red-700">Cancelado: {item.cancel_reason ?? '—'}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {itens.length > 0 && (
            <p className="mt-2 flex justify-between border-t border-ink-100 pt-2 text-sm">
              <span className="text-ink-500">Soma dos itens válidos</span>
              <span className="num font-semibold text-ink-900">{formatMoney(totalItens)}</span>
            </p>
          )}
        </section>

        <section>
          <h4 className="rotulo mb-2">Recebimentos</h4>
          {payments.isLoading ? (
            <LoadingBlock label="Carregando recebimentos…" linhas={2} />
          ) : pagamentos.length === 0 ? (
            <p className="text-sm text-ink-500">Nenhum recebimento registrado para este pedido.</p>
          ) : (
            <>
              <ul className="space-y-1.5 text-sm">
                {pagamentos.map((payment) => (
                  <li
                    key={payment.id}
                    className={`flex items-center justify-between gap-3 rounded-control border px-2.5 py-2 ${
                      payment.status === 'reversed' ? 'border-red-200 bg-red-50/60' : 'border-ink-200'
                    }`}
                  >
                    <span className={payment.status === 'reversed' ? 'text-ink-500' : 'text-ink-800'}>
                      <span className={`num font-medium ${payment.status === 'reversed' ? 'line-through' : ''}`}>
                        {formatMoney(payment.amount_cents)}
                      </span>{' '}
                      · {nomeMetodo(payment.method_id)}
                      {payment.change_cents > 0 && ` · troco ${formatMoney(payment.change_cents)}`}
                      {payment.is_prepaid && ' · antecipado'}
                      {payment.status === 'reversed' && ` · estornado (${payment.reverse_reason ?? 'sem motivo'})`}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-500">{formatDateTime(payment.created_at)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex justify-between border-t border-ink-100 pt-2 text-sm">
                <span className="text-ink-500">Total recebido (confirmados)</span>
                <span className="num font-semibold text-emerald-700">{formatMoney(totalPago)}</span>
              </p>
            </>
          )}
        </section>

        <section>
          <h4 className="rotulo mb-2">Histórico de situação</h4>
          {history.isLoading ? (
            <LoadingBlock label="Carregando histórico…" linhas={2} />
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-500">Sem mudanças registradas.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-ink-200 pl-4 text-[13px]">
              {(history.data ?? []).map((entry) => (
                <li key={entry.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-ink-300 ring-4 ring-white" />
                  <p className="text-ink-800">
                    {entry.from_status ? `${ORDER_STATUS_LABELS[entry.from_status as OrderStatus]} → ` : ''}
                    <strong>{ORDER_STATUS_LABELS[entry.to_status as OrderStatus]}</strong>
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {formatDateTime(entry.changed_at)}
                    {entry.notes ? ` · ${entry.notes}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <Callout tom="info">
          Preços, descontos e taxas ficam congelados no pedido: mudanças posteriores no cardápio não alteram este
          histórico.
        </Callout>
      </div>
    </Modal>
  )
}
