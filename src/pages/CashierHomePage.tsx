import { useNavigate } from 'react-router-dom'
import { useOpenCashSession, useOrders, useTables } from '../lib/hooks'
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatTile,
} from '../components/ui'
import { Icon } from '../components/icons'
import { duracaoDesde, formatMoney, formatTime, plural } from '../lib/format'
import { translateError } from '../lib/errors'
import { ORDER_STATUS_LABELS, type OrderOverview } from '../lib/types'

/** Tela inicial do caixa: situação da operação e atalhos para o que está pendente. */
export default function CashierHomePage() {
  const navigate = useNavigate()
  const tables = useTables()
  const cash = useOpenCashSession()
  const openOrders = useOrders({ openOnly: true, limit: 200 })
  const deliveries = useOrders({
    serviceMode: 'delivery',
    statuses: ['received', 'confirmed', 'preparing', 'ready', 'out_for_delivery'],
    limit: 100,
  })

  if (tables.isLoading && !tables.data) return <LoadingBlock label="Carregando o painel do caixa…" linhas={5} />

  /**
   * A tela depende de quatro consultas. Antes só o erro de `tables` era
   * mostrado; falha em caixa/pedidos/delivery virava “zero” silencioso, que
   * parece operação vazia e não erro (achado A11).
   */
  const erro = tables.error ?? cash.error ?? openOrders.error ?? deliveries.error
  if (erro) {
    return (
      <ErrorBlock
        message={translateError(erro)}
        onRetry={() => {
          void tables.refetch()
          void cash.refetch()
          void openOrders.refetch()
          void deliveries.refetch()
        }}
      />
    )
  }

  const mesas = tables.data ?? []
  const livres = mesas.filter((mesa) => mesa.status === 'available')
  const emUso = mesas.filter((mesa) => mesa.status !== 'available' && mesa.status !== 'inactive')
  const prontasParaFechar = mesas.filter((mesa) => mesa.status === 'awaiting_close')
  const pedidosAbertos = openOrders.data ?? []
  const deliveryEmAndamento = deliveries.data ?? []

  const saldoSalao = emUso.reduce((soma, mesa) => soma + mesa.balance_cents, 0)
  const saldoDelivery = deliveryEmAndamento.reduce((soma, pedido) => soma + pedido.balance_cents, 0)

  return (
    <div>
      <PageHeader
        titulo="Caixa"
        descricao="O que está acontecendo agora no salão e no delivery — e o que precisa do seu caixa."
        acoes={
          <>
            <Button variant="secondary" icone="mesas" onClick={() => navigate('/mesas')}>
              Mapa de mesas
            </Button>
            {cash.data ? (
              <Button icone="cofre" onClick={() => navigate('/caixa-controle')}>
                Ver turno de caixa
              </Button>
            ) : (
              <Button icone="cofre" onClick={() => navigate('/caixa-controle')}>
                Abrir o caixa
              </Button>
            )}
          </>
        }
      />

      {!cash.data && !cash.isLoading && (
        <div className="mb-5">
          <Callout
            tom="atencao"
            titulo="O caixa está fechado"
            acoes={
              <Button size="sm" icone="cofre" onClick={() => navigate('/caixa-controle')}>
                Abrir agora
              </Button>
            }
          >
            Recebimentos e movimentos de dinheiro só podem ser registrados com um turno de caixa aberto.
          </Callout>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          rotulo="Turno de caixa"
          valor={cash.isLoading ? '…' : cash.data ? 'Aberto' : 'Fechado'}
          icone="cofre"
          tom={cash.data ? 'verde' : 'vermelho'}
          detalhe={
            cash.data
              ? `Aberto por ${cash.data.opened_by_name ?? '—'} às ${formatTime(cash.data.opened_at)} · gaveta esperada ${formatMoney(cash.data.expected_cash_cents)}`
              : 'Sem turno aberto — clique em “Abrir o caixa”'
          }
        />

        <StatTile
          rotulo="Mesas no salão"
          valor={`${livres.length} livres`}
          icone="mesas"
          tom="neutro"
          detalhe={`${emUso.length} em atendimento · ${prontasParaFechar.length} prontas para fechar`}
        />

        <StatTile
          rotulo="Delivery em andamento"
          valor={deliveryEmAndamento.length}
          icone="entrega"
          tom="marca"
          detalhe={`${formatMoney(saldoDelivery)} a receber no delivery`}
        />

        <StatTile
          rotulo="A receber no salão"
          valor={formatMoney(saldoSalao)}
          icone="dinheiro"
          tom="ambar"
          detalhe={`${plural(pedidosAbertos.length, 'conta', 'contas')} em aberto`}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card
          title="Prontas para fechar"
          descricao="Mesas com o saldo já recebido ou aguardando apenas a emissão do fechamento."
          icone="check"
          actions={
            <Badge tone={prontasParaFechar.length > 0 ? 'brand' : 'slate'}>{prontasParaFechar.length}</Badge>
          }
        >
          {prontasParaFechar.length === 0 ? (
            <EmptyState
              icone="caixa"
              title="Nenhuma mesa pronta para fechar"
              description="Quando o cliente pedir a conta ou o pagamento for registrado, a mesa aparece aqui."
            />
          ) : (
            <ul className="space-y-2">
              {prontasParaFechar.map((mesa) => (
                <li
                  key={mesa.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-sky-200 bg-sky-50/70 px-3.5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{mesa.name ?? `Mesa ${mesa.number}`}</p>
                    <p className="num mt-0.5 text-xs text-ink-600">
                      Total {formatMoney(mesa.total_cents)} · recebido {formatMoney(mesa.paid_cents)} ·{' '}
                      <strong className={mesa.balance_cents > 0 ? 'text-brand-700' : 'text-emerald-700'}>
                        falta {formatMoney(mesa.balance_cents)}
                      </strong>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    icone="seta-direita"
                    onClick={() => navigate(`/mesas/${mesa.open_session_id}`)}
                  >
                    Receber
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Contas em aberto"
          descricao="Salão e delivery sem fechamento — ordenadas pelas mais recentes."
          icone="lista"
          actions={<Badge tone="slate">{pedidosAbertos.length}</Badge>}
        >
          {pedidosAbertos.length === 0 ? (
            <EmptyState icone="caixa" title="Nenhuma conta em aberto" />
          ) : (
            <ul className="scroll-thin max-h-80 space-y-2 overflow-y-auto pr-1">
              {pedidosAbertos.slice(0, 40).map((pedido) => (
                <PedidoLinha key={pedido.id} pedido={pedido} onAbrir={() => abrirPedido(pedido)} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {deliveryEmAndamento.length > 0 && (
        <div className="mt-4">
          <Card
            title="Delivery em andamento"
            descricao="Pedidos lançados manualmente (telefone/WhatsApp) que ainda não foram entregues."
            icone="entrega"
            actions={
              <Button size="sm" variant="secondary" onClick={() => navigate('/delivery')}>
                Gerenciar delivery
              </Button>
            }
          >
            <ul className="grid gap-2 sm:grid-cols-2">
              {deliveryEmAndamento.slice(0, 8).map((pedido) => (
                <li key={pedido.id} className="rounded-card border border-ink-200 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      #{pedido.order_number} · {pedido.customer_name_snapshot ?? 'Cliente'}
                    </p>
                    <Badge tone={pedido.balance_cents > 0 ? 'amber' : 'green'} ponto>
                      {pedido.balance_cents > 0 ? 'a receber' : 'pago'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-600">
                    {ORDER_STATUS_LABELS[pedido.status]} · {duracaoDesde(pedido.created_at)} ·{' '}
                    {formatMoney(pedido.total_cents)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="mt-4">
        <Callout tom="info" titulo="Regra de fechamento">
          Pedidos com saldo pendente <strong>não podem</strong> ser marcados como totalmente pagos: o banco recusa
          e exige registro do pagamento — ou um procedimento excepcional do administrador, que fica gravado na
          auditoria.
        </Callout>
      </div>
    </div>
  )

  function abrirPedido(pedido: OrderOverview) {
    if (pedido.table_session_id) navigate(`/mesas/${pedido.table_session_id}`)
    else navigate('/delivery')
  }
}

function PedidoLinha({ pedido, onAbrir }: { pedido: OrderOverview; onAbrir: () => void }) {
  const pago = pedido.balance_cents <= 0
  return (
    <li>
      <button
        onClick={onAbrir}
        className="flex w-full items-center justify-between gap-3 rounded-card border border-ink-200 px-3.5 py-3 text-left transition hover:border-ink-300 hover:bg-ink-50"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">
            #{pedido.order_number}{' '}
            <span className="font-normal text-ink-500">
              {pedido.service_mode === 'dine_in'
                ? `· ${pedido.table_number ? `Mesa ${pedido.table_number}` : 'Salão'}`
                : `· ${pedido.customer_name_snapshot ?? 'Delivery'}`}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-600">
            {ORDER_STATUS_LABELS[pedido.status]} · aberto {duracaoDesde(pedido.created_at)} ·{' '}
            {formatMoney(pedido.total_cents)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={pago ? 'green' : 'amber'} ponto>
            {pago ? 'quitada' : `falta ${formatMoney(pedido.balance_cents)}`}
          </Badge>
          <Icon nome="seta-direita" className="h-4 w-4 text-ink-400" />
        </div>
      </button>
    </li>
  )
}
