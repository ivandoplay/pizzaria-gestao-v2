import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateOrderData, useOnlineStatus, useOrderItems, useOrders } from '../lib/hooks'
import * as api from '../lib/api'
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  useToast,
} from '../components/ui'
import { duracaoDesde, plural } from '../lib/format'
import { detalhesDoItem, selecionarFila } from '../lib/fila'
import { translateError } from '../lib/errors'
import type { OrderItemOverview, OrderOverview } from '../lib/types'

/**
 * Fila de pedidos prontos para o garçom.
 *
 * Esta tela NÃO tem tabela, status nem canal próprios: é uma leitura dos pedidos
 * que já existem (status `ready`, salão). A entrega é feita pela RPC
 * `advance_order_status`, a mesma usada no resto do sistema — o cliente nunca
 * escreve em `orders.status`.
 */

/**
 * Teto de segurança da consulta. A ordenação é feita no banco (ready_at
 * crescente), então se a fila passar disso o que fica de fora são os pedidos
 * prontos há MENOS tempo — os mais críticos continuam visíveis, e um aviso
 * aparece no topo.
 */
const LIMITE_FILA = 200

/** Releitura periódica como rede de segurança para quando o Realtime oscilar. */
const INTERVALO_RELEITURA_MS = 60_000

/** Re-render do tempo relativo ("há 12 min") sem nova consulta. */
const INTERVALO_RELATIVO_MS = 30_000

type EstadoEntrega = 'confirmando' | 'sucesso' | 'conflito' | 'falha'

type EntregaRegistrada = {
  estado: EstadoEntrega
  mensagem?: string
}

/** Códigos do banco que significam "a fila mudou": outro funcionário agiu antes. */
const CODIGOS_DESATUALIZADO = ['NO_STATUS_CHANGE', 'INVALID_TRANSITION', 'SESSION_NOT_OPEN', 'ORDER_ACCOUNT_CLOSED']

function mensagemDoErro(error: unknown): string {
  return String((error as { message?: string })?.message ?? '')
}

export default function ReadyOrdersPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const online = useOnlineStatus()
  const [agora, setAgora] = useState(() => Date.now())
  const [entregas, setEntregas] = useState<Record<string, EntregaRegistrada>>({})

  const filtros = useMemo(
    () =>
      ({
        statuses: ['ready'] as const,
        serviceMode: 'dine_in' as const,
        openOnly: true,
        ordem: 'prontos_mais_antigos' as const,
        limit: LIMITE_FILA,
      }) as Parameters<typeof api.fetchOrders>[0],
    [],
  )

  const pedidosQuery = useOrders(filtros)
  const pedidos = useMemo(() => pedidosQuery.data ?? [], [pedidosQuery.data])

  // ---------------------------------------------------------------------------
  // Elegibilidade: o banco já filtra (status/service_mode/openOnly) e a RPC
  // recusa entrega fora disso; o recorte abaixo é cinto e suspensório para o
  // intervalo entre a consulta e o toque no botão (ex.: conta fechada no caixa).
  // `session_status` nulo NÃO derruba o pedido: pedidos antigos podem não ter
  // essa coluna preenchida, e sumir da tela seria pior do que deixar o banco
  // recusar a entrega com mensagem clara.
  // ---------------------------------------------------------------------------
  const fila = useMemo(() => selecionarFila(pedidos), [pedidos])

  const ids = useMemo(() => fila.map((pedido) => pedido.id), [fila])
  const itensQuery = useOrderItems(ids)
  const itens = itensQuery.data

  const itensPorPedido = useMemo(() => {
    const mapa = new Map<string, OrderItemOverview[]>()
    for (const item of itens ?? []) {
      const atual = mapa.get(item.order_id)
      if (atual) atual.push(item)
      else mapa.set(item.order_id, [item])
    }
    return mapa
  }, [itens])

  const maisAntigo = fila.find((pedido) => pedido.ready_at) ?? null
  const truncada = pedidos.length >= LIMITE_FILA
  const carregando = pedidosQuery.isLoading && pedidos.length === 0
  const falhouSemDados = pedidosQuery.isError && pedidos.length === 0
  const falhouComDados = pedidosQuery.isError && pedidos.length > 0

  // Relógio da tela: só re-renderiza o texto relativo, sem consultar o banco.
  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), INTERVALO_RELATIVO_MS)
    return () => clearInterval(timer)
  }, [])

  // Rede de segurança do Realtime: nova leitura a cada minuto, em silêncio.
  const refetch = pedidosQuery.refetch
  useEffect(() => {
    const timer = setInterval(() => void refetch(), INTERVALO_RELEITURA_MS)
    return () => clearInterval(timer)
  }, [refetch])

  const atualizarTudo = useCallback(async () => {
    await invalidateOrderData(queryClient)
  }, [queryClient])

  const confirmarEntrega = useCallback(
    async (pedido: OrderOverview) => {
      const id = pedido.id
      if (entregas[id]?.estado === 'confirmando' || entregas[id]?.estado === 'sucesso') return

      setEntregas((atual) => ({ ...atual, [id]: { estado: 'confirmando' } }))

      try {
        // A RPC valida perfil, transição, sessão da mesa e conta encerrada
        // dentro da transação: a confirmação só é dada depois da resposta.
        await api.advanceOrderStatus(id, 'delivered_to_table')
        setEntregas((atual) => ({ ...atual, [id]: { estado: 'sucesso' } }))
        toast.success(`Entrega confirmada — mesa ${pedido.table_number ?? '—'}, pedido #${pedido.order_number}.`)
        await atualizarTudo()
      } catch (error) {
        const bruto = mensagemDoErro(error)
        const desatualizado = CODIGOS_DESATUALIZADO.some((codigo) => bruto.includes(codigo))

        if (desatualizado) {
          setEntregas((atual) => ({
            ...atual,
            [id]: { estado: 'conflito', mensagem: translateError(error) },
          }))
          toast.error(`Este pedido mudou enquanto você confirmava: ${translateError(error)}`)
          await atualizarTudo()
          return
        }

        const mensagem = online
          ? translateError(error)
          : 'Sem conexão com o servidor. A entrega não foi registrada.'
        setEntregas((atual) => ({ ...atual, [id]: { estado: 'falha', mensagem } }))
        toast.error(mensagem)
      }
    },
    [atualizarTudo, entregas, online, toast],
  )

  return (
    <div className="space-y-5">
      <PageHeader
        titulo="Pedidos prontos"
        descricao="Pedidos do salão aguardando entrega na mesa. O mais antigo aparece primeiro."
        selo={
          <Badge tone={online ? 'green' : 'amber'}>{online ? 'Conectado' : 'Sem conexão'}</Badge>
        }
        acoes={
          <Button
            variant="secondary"
            icone="atualizar"
            loading={pedidosQuery.isFetching}
            onClick={() => void pedidosQuery.refetch()}
          >
            Atualizar
          </Button>
        }
      />

      {!online && (
        <Callout tom="atencao" titulo="Sem conexão">
          A lista pode estar desatualizada e a entrega não será registrada enquanto o aparelho estiver
          sem internet. O botão só confirma depois da resposta do servidor.
        </Callout>
      )}

      {falhouComDados && (
        <Callout
          tom="atencao"
          titulo="Não foi possível atualizar agora"
          acoes={
            <Button variant="secondary" size="sm" icone="atualizar" onClick={() => void pedidosQuery.refetch()}>
              Tentar de novo
            </Button>
          }
        >
          Os pedidos abaixo podem estar desatualizados. Confirme a entrega apenas depois de atualizar.
        </Callout>
      )}

      {truncada && (
        <Callout tom="info">
          Há mais pedidos prontos do que os {LIMITE_FILA} carregados nesta lista. Os mais antigos aparecem
          primeiro; entregue-os para que os demais sejam exibidos.
        </Callout>
      )}

      {carregando ? (
        <LoadingBlock label="Carregando a fila de prontos…" linhas={3} />
      ) : falhouSemDados ? (
        <ErrorBlock
          message={translateError(pedidosQuery.error)}
          onRetry={() => void pedidosQuery.refetch()}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-pequeno text-ink-500">
            <span className="font-semibold text-ink-800">
              {fila.length === 0
                ? 'Nenhum pedido aguardando entrega'
                : `${fila.length} ${plural(fila.length, 'pedido pronto', 'pedidos prontos')}`}
            </span>
            <span>
              {maisAntigo ? `mais antigo: ${duracaoDesde(maisAntigo.ready_at, agora)}` : 'sem horário de pronto registrado'}
            </span>
            {pedidosQuery.isFetching && <span className="text-ink-400">sincronizando…</span>}
          </div>

          {fila.length === 0 ? (
            <EmptyState
              icone="check"
              title="Nenhum pedido pronto na fila"
              description="Quando a produção marcar um pedido do salão como pronto, ele aparece aqui para o garçom entregar."
            />
          ) : (
            <div className="grade-navegavel grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {fila.map((pedido) => {
                const registro = entregas[pedido.id]
                const estado = registro?.estado ?? null
                const confirmando = estado === 'confirmando'
                const entregue = estado === 'sucesso'
                const itensDoPedido = itensPorPedido.get(pedido.id) ?? []

                return (
                  <Card key={pedido.id} padded={false} className="min-w-0">
                    <div className="flex min-w-0 flex-col gap-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[17px] font-semibold text-ink-900">
                            Mesa {pedido.table_number ?? '—'}
                          </p>
                          <p className="text-pequeno text-ink-500">
                            Pedido #{pedido.order_number}
                            {' · '}
                            {pedido.ready_at ? `pronto ${duracaoDesde(pedido.ready_at, agora)}` : 'Horário indisponível'}
                          </p>
                        </div>
                        <Badge tone={entregue ? 'green' : 'blue'}>{entregue ? 'Entregue' : 'Pronto'}</Badge>
                      </div>

                      <ul className="min-w-0 space-y-1.5 text-pequeno">
                        {itensQuery.isLoading ? (
                          <li className="text-ink-400">Carregando itens…</li>
                        ) : itensDoPedido.length === 0 ? (
                          <li className="text-ink-400">Itens indisponíveis. Atualize a lista.</li>
                        ) : (
                          itensDoPedido.map((item) => {
                            const detalhes = detalhesDoItem(item)
                            return (
                              <li
                                key={item.id}
                                className={`min-w-0 ${item.is_cancelled ? 'text-ink-400 line-through' : 'text-ink-700'}`}
                              >
                                <span className="font-semibold tabular-nums">{item.quantity}×</span>{' '}
                                <span className="break-words">{item.product_name}</span>
                                {item.is_cancelled && <span className="no-underline"> (cancelado)</span>}
                                {detalhes.length > 0 && (
                                  <span className="block break-words text-ink-500">{detalhes.join(' · ')}</span>
                                )}
                              </li>
                            )
                          })
                        )}
                      </ul>

                      {pedido.notes && (
                        <p className="break-words rounded-interno bg-ink-50 px-3 py-2 text-pequeno text-ink-600">
                          Observação do pedido: {pedido.notes}
                        </p>
                      )}

                      {registro?.mensagem && (
                        <Callout tom={estado === 'conflito' ? 'atencao' : 'erro'}>{registro.mensagem}</Callout>
                      )}

                      <Button
                        block
                        size="lg"
                        icone={entregue ? 'check' : undefined}
                        loading={confirmando}
                        disabled={entregue || confirmando || !online}
                        onClick={() => void confirmarEntrega(pedido)}
                      >
                        {entregue
                          ? 'Entrega confirmada'
                          : confirmando
                            ? 'Confirmando…'
                            : estado === 'falha'
                              ? 'Tentar de novo'
                              : 'Confirmar entrega'}
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
