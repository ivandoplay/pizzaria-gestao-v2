import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'
import { Badge, Button, Card, DataTable, EmptyState, ErrorBlock, Field, Input, LoadingBlock, Modal, useToast } from '../components/ui'
import { downloadCsv, formatDateTime, formatMoney } from '../lib/format'
import { translateError } from '../lib/errors'

const PAGE_SIZE = 50

const SENSITIVE_KEYS = /password|senha|token|secret|segredo|authorization|api[_-]?key|service[_-]?role|credential/i

/** Mostra os detalhes do evento, ocultando campos sensíveis por precaução. */
function safeDetails(details: Record<string, unknown> | null): string {
  if (!details) return '—'
  const clone: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_KEYS.test(key)) continue
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      clone[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(([innerKey]) => !SENSITIVE_KEYS.test(innerKey)),
      )
    } else {
      clone[key] = value
    }
  }
  const text = JSON.stringify(clone)
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

export default function AuditPage() {
  const toast = useToast()
  const [action, setAction] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.fetchAuditLogs>>['rows'][number] | null>(null)

  const query = useQuery({
    queryKey: ['audit-logs', action, term, page],
    queryFn: () => api.fetchAuditLogs({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, action: action.trim() || undefined }),
  })

  const rows = (query.data?.rows ?? []).filter((row) => {
    if (!term.trim()) return true
    const needle = term.trim().toLowerCase()
    return (
      row.action.toLowerCase().includes(needle) ||
      (row.actor_name ?? '').toLowerCase().includes(needle) ||
      row.entity_table.toLowerCase().includes(needle)
    )
  })
  const total = query.data?.count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (query.isLoading) return <LoadingBlock label="Carregando a auditoria…" />
  if (query.error) return <ErrorBlock message={translateError(query.error)} onRetry={() => void query.refetch()} />

  return (
    <div className="space-y-4">
      <Card title="Filtros">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ação (contém)" hint="ex.: payment., order.cancel, auth.employee">
            <Input value={action} onChange={(event) => { setAction(event.target.value); setPage(0) }} placeholder="payment" />
          </Field>
          <Field label="Busca na página" hint="Filtra por operador, tabela ou ação nos 50 registros exibidos.">
            <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="caixa, profiles…" />
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => {
                downloadCsv(`auditoria-pagina-${page + 1}.csv`, [
                  ['Quando', 'Operador', 'Função', 'Ação', 'Tabela', 'Registro', 'Pedido', 'Valor (R$)', 'Motivo'],
                  ...rows.map((row) => [
                    formatDateTime(row.occurred_at),
                    row.actor_name ?? '',
                    row.actor_role ?? '',
                    row.action,
                    row.entity_table,
                    row.entity_id ?? '',
                    row.order_id ?? '',
                    row.amount_cents === null ? '' : (row.amount_cents / 100).toFixed(2),
                    row.reason ?? '',
                  ]),
                ])
                toast.success('Página da auditoria exportada.')
              }}
            >
              Exportar CSV
            </Button>
          </div>
        </div>
      </Card>

      <Card title={`Eventos auditados (${total})`}>
        {rows.length === 0 ? (
          <EmptyState title="Nenhum evento encontrado" description="Ajuste os filtros ou o período." />
        ) : (
          <>
            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => setDetail(row)}
              columns={[
                { key: 'when', header: 'Quando', render: (row) => formatDateTime(row.occurred_at) },
                { key: 'actor', header: 'Operador', render: (row) => row.actor_name ?? '—' },
                { key: 'action', header: 'Ação', render: (row) => <span className="font-mono text-[12px]">{row.action}</span> },
                { key: 'table', header: 'Tabela', render: (row) => row.entity_table },
                { key: 'entity', header: 'Registro', render: (row) => (row.entity_id ? `${row.entity_id.slice(0, 8)}…` : '—') },
                { key: 'order', header: 'Pedido', align: 'right', render: (row) => (row.order_id ? `#${row.order_id}` : '—') },
                {
                  key: 'amount',
                  header: 'Valor',
                  align: 'right',
                  render: (row) => (row.amount_cents === null ? '—' : formatMoney(row.amount_cents)),
                },
                { key: 'reason', header: 'Motivo', render: (row) => row.reason ?? '—' },
              ]}
            />
            <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
              <span>
                Página {page + 1} de {pages} · {total} evento(s)
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                  Anterior
                </Button>
                <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage((current) => current + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          </>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          A auditoria é somente leitura: os operadores podem inserir eventos (pelo sistema), mas ninguém — nem o
          administrador — pode alterar ou apagar registros.
        </p>
      </Card>

      <Modal open={Boolean(detail)} title="Detalhe do evento" onClose={() => setDetail(null)} size="md">
        {detail && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Quando</span>
              <span>{formatDateTime(detail.occurred_at)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Operador</span>
              <span>
                {detail.actor_name ?? '—'} {detail.actor_role && <Badge tone="slate">{detail.actor_role}</Badge>}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Ação</span>
              <span className="font-mono text-[12px]">{detail.action}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Registro</span>
              <span className="font-mono text-[12px]">
                {detail.entity_table} · {detail.entity_id ?? '—'}
              </span>
            </div>
            {detail.order_id && (
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Pedido</span>
                <span>#{detail.order_id}</span>
              </div>
            )}
            {detail.amount_cents !== null && (
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Valor</span>
                <span>{formatMoney(detail.amount_cents)}</span>
              </div>
            )}
            <div>
              <p className="text-slate-500">Motivo</p>
              <p className="whitespace-pre-line">{detail.reason ?? '—'}</p>
            </div>
            <div>
              <p className="text-slate-500">Detalhes (campos sensíveis ocultados)</p>
              <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-slate-50 p-2 text-[11px] text-slate-700">
                {safeDetails(detail.details as Record<string, unknown>)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
