import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'
import {
  Badge,
  Button,
  Callout,
  Card,
  DataTable,
  ErrorBlock,
  Field,
  IconButton,
  LoadingBlock,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  useToast,
} from '../components/ui'
import { downloadCsv, formatDateTime, formatMoney, plural } from '../lib/format'
import { translateError } from '../lib/errors'

const PAGE_SIZE = 50

/** Ações registradas pelo banco — usadas no filtro rápido (lista real, não inventada). */
const ACOES_CONHECIDAS: { valor: string; rotulo: string }[] = [
  { valor: 'order.create', rotulo: 'Pedido criado' },
  { valor: 'order.status.', rotulo: 'Mudança de situação do pedido' },
  { valor: 'order_item.cancel', rotulo: 'Item cancelado' },
  { valor: 'order.discount', rotulo: 'Desconto aplicado' },
  { valor: 'order.delivery_fee', rotulo: 'Taxa de entrega ajustada' },
  { valor: 'payment.register', rotulo: 'Recebimento registrado' },
  { valor: 'payment.reverse', rotulo: 'Recebimento estornado' },
  { valor: 'table_session.open', rotulo: 'Mesa aberta' },
  { valor: 'table_account.close', rotulo: 'Conta de mesa fechada' },
  { valor: 'delivery_account.close', rotulo: 'Conta de delivery fechada' },
  { valor: 'cash_session.open', rotulo: 'Caixa aberto' },
  { valor: 'cash_session.close', rotulo: 'Caixa fechado' },
  { valor: 'customer.upsert', rotulo: 'Cliente cadastrado/atualizado' },
]

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
  const texto = JSON.stringify(clone, null, 2)
  return texto ?? '—'
}

export default function AuditPage() {
  const toast = useToast()
  const [action, setAction] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.fetchAuditLogs>>['rows'][number] | null>(null)

  const query = useQuery({
    queryKey: ['audit-logs', action, page],
    queryFn: () => api.fetchAuditLogs({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, action: action.trim() || undefined }),
  })

  const rows = (query.data?.rows ?? []).filter((row) => {
    if (!term.trim()) return true
    const needle = term.trim().toLowerCase()
    return (
      row.action.toLowerCase().includes(needle) ||
      (row.actor_name ?? '').toLowerCase().includes(needle) ||
      row.entity_table.toLowerCase().includes(needle) ||
      (row.reason ?? '').toLowerCase().includes(needle)
    )
  })
  const total = query.data?.count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <PageHeader
        titulo="Auditoria"
        descricao="Registro imutável das operações sensíveis: quem fez, quando, em quê e por quê."
        acoes={
          <>
            <IconButton
              nome="atualizar"
              titulo="Recarregar eventos"
              variant="secondary"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            />
            <Button
              variant="secondary"
              icone="baixar"
              disabled={rows.length === 0}
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
                toast.success(`Página ${page + 1} da auditoria exportada em CSV.`)
              }}
            >
              Exportar página
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr] lg:grid-cols-[280px_1fr]">
        <Field label="Tipo de evento" hint="Filtro aplicado no servidor, sobre todo o histórico.">
          <Select
            value={action}
            onChange={(event) => {
              setAction(event.target.value)
              setPage(0)
            }}
          >
            <option value="">Todos os eventos</option>
            {ACOES_CONHECIDAS.map((opcao) => (
              <option key={opcao.valor} value={opcao.valor}>
                {opcao.rotulo} ({opcao.valor})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Busca na página" hint={`Filtra operador, tabela, ação ou motivo nos ${PAGE_SIZE} registros exibidos.`}>
          <SearchInput value={term} onValueChange={setTerm} placeholder="ex.: caixa, payment.reverse, mesa 4…" />
        </Field>
      </div>

      <Card
        title={`Eventos auditados${total > 0 ? ` (${total})` : ''}`}
        icone="auditoria"
        descricao="A auditoria é somente leitura: ninguém — nem o administrador — pode alterar ou apagar um registro."
        padded={false}
      >
        <div className="p-3.5">
          {query.isLoading ? (
            <LoadingBlock label="Carregando a auditoria…" linhas={6} />
          ) : query.error ? (
            <ErrorBlock message={translateError(query.error)} onRetry={() => void query.refetch()} />
          ) : (
            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => setDetail(row)}
              maxHeight="58vh"
              emptyMessage="Nenhum evento encontrado"
              emptyDescription="Ajuste o tipo de evento ou o período para ver outros registros."
              columns={[
                { key: 'when', header: 'Quando', render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.occurred_at)}</span>, width: 'w-40' },
                {
                  key: 'actor',
                  header: 'Operador',
                  render: (row) => (
                    <span className="block">
                      <span className="block text-ink-800">{row.actor_name ?? '—'}</span>
                      {row.actor_role && <span className="text-[11px] text-ink-500">{row.actor_role}</span>}
                    </span>
                  ),
                },
                { key: 'action', header: 'Ação', render: (row) => <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-700">{row.action}</code> },
                { key: 'table', header: 'Tabela', render: (row) => <span className="text-xs text-ink-600">{row.entity_table}</span> },
                { key: 'entity', header: 'Registro', render: (row) => <span className="font-mono text-[11px] text-ink-500">{row.entity_id ? `${row.entity_id.slice(0, 8)}…` : '—'}</span> },
                { key: 'order', header: 'Pedido', align: 'right', render: (row) => (row.order_id ? <span className="font-mono text-[11px]">#{row.order_id}</span> : '—') },
                { key: 'amount', header: 'Valor', align: 'right', render: (row) => (row.amount_cents === null ? '—' : <span className="font-medium">{formatMoney(row.amount_cents)}</span>) },
                { key: 'reason', header: 'Motivo', render: (row) => <span className="text-xs text-ink-600">{row.reason ?? '—'}</span> },
              ]}
              rodape={
                <>
                  <span>
                    Página {page + 1} de {pages} · {plural(total, 'evento', 'eventos')} no total
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

      <div className="mt-4">
        <Callout tom="info" titulo="Para que serve">
          Use a auditoria para conferir descontos concedidos, cancelamentos, estornos e fechamentos excepcionais.
          Cada evento mostra o operador responsável e o motivo informado no momento da operação.
        </Callout>
      </div>

      <Modal
        open={Boolean(detail)}
        title="Detalhe do evento"
        descricao={detail ? formatDateTime(detail.occurred_at) : undefined}
        onClose={() => setDetail(null)}
        size="md"
      >
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Operador">
                {detail.actor_name ?? '—'} {detail.actor_role && <Badge tone="slate">{detail.actor_role}</Badge>}
              </Campo>
              <Campo rotulo="Ação">
                <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[12px]">{detail.action}</code>
              </Campo>
              <Campo rotulo="Registro afetado">
                <span className="font-mono text-[12px]">
                  {detail.entity_table} · {detail.entity_id ?? '—'}
                </span>
              </Campo>
              <Campo rotulo="Pedido">{detail.order_id ? <span className="font-mono">#{detail.order_id}</span> : '—'}</Campo>
              <Campo rotulo="Valor envolvido">
                {detail.amount_cents !== null ? formatMoney(detail.amount_cents) : '—'}
              </Campo>
            </div>

            <Campo rotulo="Motivo informado">
              <p className="whitespace-pre-line">{detail.reason ?? '—'}</p>
            </Campo>

            <Campo rotulo="Detalhes técnicos (campos sensíveis ocultados)">
              <pre className="scroll-thin mt-1 max-h-64 overflow-auto rounded-control bg-ink-900 p-3 text-[11px] leading-relaxed text-ink-100">
                {safeDetails(detail.details as Record<string, unknown>)}
              </pre>
            </Campo>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="rotulo">{rotulo}</p>
      <div className="mt-0.5 text-ink-800">{children}</div>
    </div>
  )
}
