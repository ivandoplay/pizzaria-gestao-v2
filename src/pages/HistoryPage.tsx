import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Select,
  useToast,
} from '../components/ui'
import { dayBounds, downloadCsv, formatDateTime, formatMoney, formatPhone, todayInputValue } from '../lib/format'
import { translateError } from '../lib/errors'
import { ORDER_STATUS_LABELS, type OrderStatus } from '../lib/types'

const PAGE_SIZE = 50

export default function HistoryPage() {
  const toast = useToast()
  const [from, setFrom] = useState(todayInputValue())
  const [to, setTo] = useState(todayInputValue())
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

  if (query.isLoading) return <LoadingBlock label="Consultando o histórico…" />
  if (query.error) return <ErrorBlock message={translateError(query.error)} onRetry={() => void query.refetch()} />

  return (
    <div className="space-y-4">
      <Card title="Filtros">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="De">
            <Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0) }} />
          </Field>
          <Field label="Até">
            <Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(0) }} />
          </Field>
          <Field label="Situação">
            <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}>
              <option value="">Todas</option>
              {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((key) => (
                <option key={key} value={key}>
                  {ORDER_STATUS_LABELS[key]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Modalidade">
            <Select value={serviceMode} onChange={(event) => { setServiceMode(event.target.value); setPage(0) }}>
              <option value="">Todas</option>
              <option value="dine_in">Salão</option>
              <option value="delivery">Delivery</option>
            </Select>
          </Field>
          <Field label="Mesa" hint="Somente pedidos de salão.">
            <Input
              type="number"
              value={tableNumber}
              onChange={(event) => { setTableNumber(event.target.value); setPage(0) }}
              placeholder="ex.: 4"
            />
          </Field>
          <Field label="Busca" className="sm:col-span-2 lg:col-span-3" hint="Número do pedido, nome ou telefone do cliente.">
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder="ex.: 128, Maria, 86999…" />
          </Field>
          <div className="flex items-end gap-2 lg:col-span-2">
            <Button
              variant="secondary"
              onClick={() => {
                downloadCsv(`pedidos-${from}-a-${to}.csv`, [
                  ['Pedido', 'Data', 'Modalidade', 'Mesa', 'Cliente', 'Situação', 'Total (R$)', 'Pago (R$)', 'Falta (R$)', 'Registrado por', 'Conta fechada em', 'Cancelado por'],
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
                toast.success('Página atual exportada em CSV.')
              }}
            >
              Exportar CSV
            </Button>
          </div>
        </div>
      </Card>

      <Card title={`Pedidos (${total})`}>
        {rows.length === 0 ? (
          <EmptyState title="Nenhum pedido no período" description="Ajuste os filtros de data ou limpe a busca." />
        ) : (
          <>
            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => setDetailId(row.id)}
              columns={[
                { key: 'number', header: 'Pedido', render: (row) => `#${row.order_number}` },
                { key: 'when', header: 'Data', render: (row) => formatDateTime(row.created_at) },
                {
                  key: 'where',
                  header: 'Origem',
                  render: (row) =>
                    row.service_mode === 'dine_in' ? `Salão · Mesa ${row.table_number ?? '—'}` : 'Delivery',
                },
                {
                  key: 'customer',
                  header: 'Cliente',
                  render: (row) =>
                    row.service_mode === 'delivery' ? (
                      <div>
                        <p>{row.customer_name ?? '—'}</p>
                        <p className="text-[11px] text-slate-500">{formatPhone(row.customer_phone)}</p>
                      </div>
                    ) : (
                      '—'
                    ),
                },
                {
                  key: 'status',
                  header: 'Situação',
                  render: (row) => (
                    <Badge
                      tone={
                        row.status === 'cancelled'
                          ? 'red'
                          : row.account_closed_at
                            ? 'green'
                            : row.status === 'delivered'
                              ? 'blue'
                              : 'amber'
                      }
                    >
                      {ORDER_STATUS_LABELS[row.status]}
                      {row.account_closed_at ? ' · conta fechada' : ''}
                    </Badge>
                  ),
                },
                { key: 'total', header: 'Total', align: 'right', render: (row) => formatMoney(row.total_cents) },
                {
                  key: 'balance',
                  header: 'Falta',
                  align: 'right',
                  render: (row) => (
                    <span className={row.balance_cents > 0 ? 'text-brand-700' : 'text-emerald-700'}>
                      {formatMoney(row.balance_cents)}
                    </span>
                  ),
                },
                { key: 'by', header: 'Registrado por', render: (row) => row.created_by_name },
              ]}
            />
            <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
              <span>
                Página {page + 1} de {pages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                  Anterior
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Clique em uma linha para ver os detalhes completos do pedido.</p>
          </>
        )}
      </Card>

      <OrderDetail orderId={detailId} onClose={() => setDetailId(null)} />
    </div>
  )
}

/** Detalhes: itens, pagamentos e histórico de situação (somente leitura). */
function OrderDetail({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
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

  return (
    <Modal open={Boolean(orderId)} title="Detalhes do pedido" onClose={onClose} size="lg">
      <div className="space-y-4">
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Itens</h4>
          {(items.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">Sem itens.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(items.data ?? []).map((item) => (
                <li key={item.id} className={`rounded-md border p-2 ${item.is_cancelled ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}>
                  <div className="flex justify-between">
                    <span className="font-medium text-slate-800">
                      {item.quantity}x {item.product_name} ({item.size_name})
                    </span>
                    <span className={item.is_cancelled ? 'text-red-700 line-through' : 'text-slate-800'}>
                      {formatMoney(item.total_cents)}
                    </span>
                  </div>
                  {item.flavors.length > 1 && (
                    <p className="text-[11px] text-slate-600">
                      Sabores: {item.flavors.map((flavor) => flavor.name).join(' + ')}
                      {item.pricing_rule && ` · regra do meio a meio: ${item.pricing_rule === 'highest' ? 'maior valor' : 'média'}`}
                    </p>
                  )}
                  {item.modifiers.length > 0 && (
                    <p className="text-[11px] text-slate-600">
                      Adicionais: {item.modifiers.map((modifier) => `${modifier.option_name} (${formatMoney(modifier.price_cents)})`).join(', ')}
                    </p>
                  )}
                  {item.notes && <p className="text-[11px] italic text-slate-500">Obs.: {item.notes}</p>}
                  {item.is_cancelled && <p className="text-[11px] text-red-700">Cancelado: {item.cancel_reason ?? '—'}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Pagamentos</h4>
          {(payments.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum pagamento registrado.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(payments.data ?? []).map((payment) => (
                <li key={payment.id} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1">
                  <span className={payment.status === 'reversed' ? 'text-red-700 line-through' : 'text-slate-700'}>
                    {formatMoney(payment.amount_cents)} · {payment.method_id}
                    {payment.is_prepaid && ' · antecipado'}
                    {payment.status === 'reversed' && ` · estornado (${payment.reverse_reason ?? '—'})`}
                  </span>
                  <span className="text-[11px] text-slate-500">{formatDateTime(payment.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Histórico de situação</h4>
          {(history.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">Sem registros.</p>
          ) : (
            <ol className="space-y-1 text-[12px] text-slate-600">
              {(history.data ?? []).map((entry) => (
                <li key={entry.id}>
                  {formatDateTime(entry.changed_at)} —{' '}
                  {entry.from_status ? `${ORDER_STATUS_LABELS[entry.from_status as OrderStatus]} → ` : ''}
                  <strong>{ORDER_STATUS_LABELS[entry.to_status as OrderStatus]}</strong>
                  {entry.notes && ` · ${entry.notes}`}
                </li>
              ))}
            </ol>
          )}
        </div>

        <p className="text-[11px] text-slate-500">
          Os valores são os registrados no momento do pedido — preços do cardápio podem ter mudado depois.
        </p>
      </div>
    </Modal>
  )
}
