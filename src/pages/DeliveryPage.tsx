import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { invalidateOrderData, useMenu, useOrders, useSettings, useZones } from '../lib/hooks'
import * as api from '../lib/api'
import { OrderComposer, type MenuData } from '../components/OrderComposer'
import { PaymentModal } from '../components/PaymentPanel'
import { DiscountDialog } from '../components/DiscountDialog'
import {
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  SegmentedControl,
  StatTile,
  StatusPill,
  Textarea,
  useToast,
} from '../components/ui'
import { Icon } from '../components/icons'
import { duracaoDesde, formatDateTime, formatMoney, formatPhone, formatTime, parseMoneyToCents } from '../lib/format'
import { useChaveIdempotente } from '../lib/idempotencia'
import { translateError } from '../lib/errors'
import { valoresRecibo } from '../lib/recibo'
import { ORDER_STATUS_LABELS, type CartItem, type OrderOverview, type OrderStatus } from '../lib/types'

const PROXIMO_PASSO: Record<string, { status: OrderStatus; label: string } | undefined> = {
  received: { status: 'confirmed', label: 'Confirmar pedido' },
  confirmed: { status: 'preparing', label: 'Iniciar preparo' },
  preparing: { status: 'ready', label: 'Marcar pronto' },
  ready: { status: 'out_for_delivery', label: 'Saiu para entrega' },
  out_for_delivery: { status: 'delivered', label: 'Confirmar entrega' },
}

type Filtro = 'andamento' | 'entregues' | 'todos'

export default function DeliveryPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { isAdmin, isManager } = useAuth()

  const deliveryOrders = useOrders({ serviceMode: 'delivery', limit: 200 })
  const menuQuery = useMenu()
  const settings = useSettings()
  const zones = useZones()

  const [showNew, setShowNew] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [cliente, setCliente] = useState({ nome: '', telefone: '' })
  // Cliente recorrente (seção 8.1): encontrado pelo telefone, com o endereço da
  // última entrega pronto para preencher — o caixa não redigita a cada pedido.
  const [recorrente, setRecorrente] = useState<api.ClienteRecorrente | null>(null)
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const [telefoneBuscado, setTelefoneBuscado] = useState('')
  const [endereco, setEndereco] = useState({
    rua: '',
    numero: '',
    complemento: '',
    bairro: '',
    referencia: '',
    observacoes: '',
  })
  const [pagamento, setPagamento] = useState<OrderOverview | null>(null)
  const [descontoPedido, setDescontoPedido] = useState<OrderOverview | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('andamento')
  const [busca, setBusca] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cancelar, setCancelar] = useState<OrderOverview | null>(null)
  const [motivo, setMotivo] = useState('')
  const [taxa, setTaxa] = useState<{ order: OrderOverview; valor: string; motivo: string } | null>(null)
  const [fechamento, setFechamento] = useState<{ order: OrderOverview; motivo: string } | null>(null)
  const [agora, setAgora] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const lista = useMemo(() => deliveryOrders.data ?? [], [deliveryOrders.data])
  const ids = useMemo(() => lista.map((order) => order.id), [lista])

  // Endereço completo do snapshot do pedido (o que o entregador precisa ler).
  const enderecos = useQuery({
    queryKey: ['delivery-addresses', ids],
    queryFn: () => api.fetchDeliveryAddresses(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
  })

  const menuData: MenuData = {
    categories: menuQuery.data?.categories ?? [],
    products: menuQuery.data?.products ?? [],
    sizes: menuQuery.data?.sizes ?? [],
    variants: menuQuery.data?.variants ?? [],
    groups: menuQuery.data?.groups ?? [],
    options: menuQuery.data?.options ?? [],
    links: menuQuery.data?.links ?? [],
  }

  const taxaDoBairro = useMemo(() => {
    const zona = (zones.data ?? []).find(
      (candidato) => candidato.neighborhood.trim().toLowerCase() === endereco.bairro.trim().toLowerCase(),
    )
    return zona ? zona.fee_cents : (settings.data?.default_delivery_fee_cents ?? 0)
  }, [endereco.bairro, settings.data?.default_delivery_fee_cents, zones.data])

  const cartSubtotal = cart.reduce((soma, item) => soma + item.preview.unit_price_cents * item.quantity, 0)
  /** Configuração com efeito no servidor (migração 0015). 0 = sem mínimo. */
  const pedidoMinimo = settings.data?.min_delivery_order_cents ?? 0
  const abaixoDoMinimo = pedidoMinimo > 0 && cartSubtotal < pedidoMinimo

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return lista
      .filter((order) => {
        if (filtro === 'andamento') return !['delivered', 'cancelled'].includes(order.status)
        if (filtro === 'entregues') return order.status === 'delivered'
        return true
      })
      .filter((order) =>
        termo
          ? (order.customer_name_snapshot ?? '').toLowerCase().includes(termo) ||
            String(order.order_number).includes(termo) ||
            (order.customer_phone_snapshot ?? '').includes(termo)
          : true,
      )
  }, [lista, filtro, busca])

  /**
   * Chave de idempotência do pedido de delivery: acompanha o CONTEÚDO
   * (cliente + endereço + itens). Repetir o envio depois de uma resposta
   * perdida devolve o mesmo pedido; mudar qualquer dado cria um pedido novo.
   */
  /**
   * Busca o cliente quando o telefone fica completo (10 ou 11 dígitos).
   *
   * A consulta é adiada em 400 ms para não acontecer a cada tecla e só roda com
   * o telefone inteiro: procurar por "9" traria qualquer cliente. Falha de rede
   * não bloqueia o cadastro — o pedido continua sendo lançado como novo.
   */
  useEffect(() => {
    const digitos = cliente.telefone.replace(/\D/g, '')
    if (digitos.length < 10 || digitos === telefoneBuscado) return
    let cancelado = false
    setBuscandoCliente(true)
    const timer = window.setTimeout(async () => {
      try {
        const achado = await api.findCustomerByPhone(digitos)
        if (cancelado) return
        setRecorrente(achado)
        setTelefoneBuscado(digitos)
        // Nome em branco é preenchido com o do cadastro; o que o operador já
        // digitou nunca é sobrescrito.
        if (achado) setCliente((atual) => (atual.nome.trim() ? atual : { ...atual, nome: achado.name }))
      } catch {
        if (!cancelado) setRecorrente(null)
      } finally {
        if (!cancelado) setBuscandoCliente(false)
      }
    }, 400)
    return () => {
      cancelado = true
      window.clearTimeout(timer)
    }
  }, [cliente.telefone, telefoneBuscado])

  function usarEnderecoDoCliente() {
    if (!recorrente?.endereco) return
    const { street, number, complement, neighborhood, reference, notes } = recorrente.endereco
    setEndereco({
      rua: street,
      numero: number,
      complemento: complement ?? '',
      bairro: neighborhood,
      referencia: reference ?? '',
      observacoes: notes ?? '',
    })
    setCliente((atual) => ({ ...atual, nome: atual.nome.trim() || recorrente.name }))
    toast.success(`Endereço de ${recorrente.name} preenchido a partir da última entrega.`)
  }

  const assinaturaDoPedido = useMemo(
    () => JSON.stringify({ cliente, endereco, cart }),
    [cliente, endereco, cart],
  )
  const { chave: chaveDoPedido, renovar: renovarChaveDoPedido } = useChaveIdempotente(assinaturaDoPedido)

  const resumo = useMemo(() => {
    const abertos = lista.filter((order) => !['delivered', 'cancelled'].includes(order.status))
    const emRota = lista.filter((order) => order.status === 'out_for_delivery')
    return {
      abertos: abertos.length,
      emRota: emRota.length,
      aReceber: abertos.reduce((soma, order) => soma + order.balance_cents, 0),
      taxas: abertos.reduce((soma, order) => soma + order.delivery_fee_cents, 0),
    }
  }, [lista, agora])

  async function criarPedido() {
    if (cart.length === 0) {
      toast.error('Adicione ao menos um item ao pedido.')
      return
    }
    if (abaixoDoMinimo) {
      toast.error(
        `O pedido mínimo para delivery é ${formatMoney(pedidoMinimo)} em itens. Faltam ${formatMoney(
          pedidoMinimo - cartSubtotal,
        )}.`,
      )
      return
    }
    if (!cliente.nome.trim() || cliente.telefone.replace(/\D/g, '').length < 10) {
      toast.error('Informe o nome e o telefone com DDD do cliente.')
      return
    }
    if (!endereco.rua.trim() || !endereco.numero.trim() || !endereco.bairro.trim()) {
      toast.error('Informe rua, número e bairro do endereço de entrega.')
      return
    }

    setBusy(true)
    try {
      const order = await api.createOrder(
        {
          service_mode: 'delivery',
          customer: { name: cliente.nome.trim(), phone: cliente.telefone.trim() },
          address: {
            street: endereco.rua.trim(),
            number: endereco.numero.trim(),
            complement: endereco.complemento.trim() || undefined,
            neighborhood: endereco.bairro.trim(),
            reference: endereco.referencia.trim() || undefined,
            delivery_notes: endereco.observacoes.trim() || undefined,
          },
          delivery_notes: endereco.observacoes.trim() || undefined,
          items: cart.map((item) => ({
            product_id: item.product_id,
            variant_id: item.variant_id,
            quantity: item.quantity,
            notes: item.notes || undefined,
            flavor_product_ids: item.flavor_product_ids,
            modifier_option_ids: item.modifier_option_ids,
          })),
        },
        chaveDoPedido,
      )

      toast.success(`Pedido #${order.order_number} registrado para entrega.`)
      renovarChaveDoPedido()
      setCart([])
      setCliente({ nome: '', telefone: '' })
      setRecorrente(null)
      setTelefoneBuscado('')
      setEndereco({ rua: '', numero: '', complemento: '', bairro: '', referencia: '', observacoes: '' })
      setShowNew(false)
      invalidateOrderData(queryClient)
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function avancar(order: OrderOverview) {
    const proximo = PROXIMO_PASSO[order.status]
    if (!proximo) return
    setBusyId(order.id)
    try {
      await api.advanceOrderStatus(
        order.id,
        proximo.status,
        proximo.status === 'out_for_delivery' ? 'Saiu para entrega' : undefined,
      )
      toast.success(`Pedido #${order.order_number}: ${ORDER_STATUS_LABELS[proximo.status]}.`)
      invalidateOrderData(queryClient)
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusyId(null)
    }
  }

  async function confirmarCancelamento() {
    if (!cancelar) return
    setBusy(true)
    try {
      await api.advanceOrderStatus(cancelar.id, 'cancelled', motivo.trim())
      toast.success(`Pedido #${cancelar.order_number} cancelado. O registro foi preservado e fica auditado.`)
      invalidateOrderData(queryClient)
      setCancelar(null)
      setMotivo('')
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function salvarTaxa() {
    if (!taxa) return
    setBusy(true)
    try {
      await api.setDeliveryFee(taxa.order.id, parseMoneyToCents(taxa.valor), taxa.motivo.trim())
      toast.success('Taxa de entrega ajustada (alteração auditada).')
      invalidateOrderData(queryClient)
      setTaxa(null)
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function fecharConta(order: OrderOverview, forcar: boolean) {
    setBusy(true)
    try {
      await api.closeDeliveryAccount(order.id, forcar ? { force: true, reason: fechamento?.motivo.trim() } : undefined)
      toast.success(`Conta do pedido #${order.order_number} fechada.`)
      invalidateOrderData(queryClient)
      setFechamento(null)
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  /** Comanda de entrega: o entregador precisa do endereço completo e do valor. */
  function imprimirComanda(order: OrderOverview) {
    const enderecoCompleto = enderecos.data?.[order.id]
    const valores = valoresRecibo([order])
    api.printReceipt({
      title: 'Comanda de entrega',
      subtitle: `Pedido #${order.order_number} · ${order.customer_name_snapshot ?? ''}`,
      lines: [
        { label: 'Telefone', value: formatPhone(order.customer_phone_snapshot) },
        {
          label: 'Endereço',
          value: enderecoCompleto
            ? `${enderecoCompleto.street ?? ''}, ${enderecoCompleto.number ?? ''}${
                enderecoCompleto.complement ? ` - ${enderecoCompleto.complement}` : ''
              }`
            : '—',
        },
        { label: 'Bairro', value: order.delivery_neighborhood ?? '—' },
        { label: 'Referência', value: enderecoCompleto?.reference ?? '—' },
        // Somados a partir do pedido: subtotal - desconto + taxa = total.
        // Sem a linha do desconto, a comanda não fechava quando havia desconto.
        { label: 'Itens', value: formatMoney(valores.subtotal) },
        ...(valores.desconto > 0 ? [{ label: 'Desconto', value: `- ${formatMoney(valores.desconto)}` }] : []),
        { label: 'Taxa de entrega', value: formatMoney(valores.taxa) },
        { label: 'Total', value: formatMoney(valores.total), emphasis: true },
        { label: 'Já pago', value: formatMoney(valores.recebido) },
        { label: 'Cobrar na entrega', value: formatMoney(valores.saldo), emphasis: true },
      ],
      items: [],
      footer: order.delivery_notes ? `Observações: ${order.delivery_notes}` : 'Conferir o endereço antes de sair.',
    })
  }

  if (deliveryOrders.isLoading && !deliveryOrders.data) {
    return <LoadingBlock label="Carregando delivery…" linhas={5} />
  }
  if (deliveryOrders.error) {
    return <ErrorBlock message={translateError(deliveryOrders.error)} onRetry={() => void deliveryOrders.refetch()} />
  }

  return (
    <div>
      <PageHeader
        titulo="Delivery"
        descricao="Pedidos recebidos por telefone ou WhatsApp e lançados manualmente — o sistema não integra canais automáticos."
        acoes={
          <>
            <IconButton
              nome="atualizar"
              titulo="Atualizar agora"
              variant="secondary"
              onClick={() => void deliveryOrders.refetch()}
              disabled={deliveryOrders.isFetching}
            />
            <Button icone="mais" onClick={() => setShowNew(true)}>
              Novo pedido
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile rotulo="Em andamento" valor={resumo.abertos} icone="entrega" tom="marca" detalhe="pedidos não entregues" />
        <StatTile rotulo="Na rua agora" valor={resumo.emRota} icone="raio" tom="ambar" detalhe="saiu para entrega" />
        <StatTile rotulo="A receber" valor={formatMoney(resumo.aReceber)} icone="dinheiro" detalhe="saldo dos pedidos abertos" />
        <StatTile rotulo="Taxas de entrega" valor={formatMoney(resumo.taxas)} icone="local" detalhe="somadas nos pedidos abertos" />
      </div>

      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl<Filtro>
          valor={filtro}
          onChange={setFiltro}
          opcoes={[
            { valor: 'andamento', rotulo: 'Em andamento', icone: 'entrega' },
            { valor: 'entregues', rotulo: 'Entregues', icone: 'check' },
            { valor: 'todos', rotulo: 'Todos', icone: 'lista' },
          ]}
        />
        <div className="sm:w-80">
          <Input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar cliente, telefone ou nº…"
          />
        </div>
      </div>

      {filtrados.length === 0 ? (
        <EmptyState
          icone="entrega"
          title={busca ? 'Nenhum pedido encontrado' : 'Nenhum pedido de delivery neste filtro'}
          description={
            busca
              ? 'Confira o termo digitado ou limpe a busca.'
              : 'Os pedidos recebidos por telefone ou WhatsApp são lançados aqui manualmente.'
          }
          action={
            <Button icone="mais" onClick={() => setShowNew(true)}>
              Registrar pedido
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtrados.map((order) => {
            const enderecoCompleto = enderecos.data?.[order.id]
            const minutos = Math.floor((agora - new Date(order.created_at).getTime()) / 60000)
            const atrasado = !['delivered', 'cancelled', 'out_for_delivery'].includes(order.status) && minutos > 45
            return (
              <article
                key={order.id}
                className={`flex flex-col overflow-hidden rounded-card border bg-white shadow-card ${
                  order.status === 'cancelled'
                    ? 'border-red-200 bg-red-50/40'
                    : atrasado
                      ? 'border-amber-300'
                      : 'border-ink-200'
                }`}
              >
                <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">
                      #{order.order_number}
                      <span className="truncate font-normal text-ink-700">
                        {order.customer_name_snapshot ?? 'Cliente'}
                      </span>
                    </p>
                    <a
                      href={`tel:${(order.customer_phone_snapshot ?? '').replace(/\D/g, '')}`}
                      className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
                    >
                      <Icon nome="telefone" className="h-3.5 w-3.5" />
                      {formatPhone(order.customer_phone_snapshot)}
                    </a>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill status={order.status} />
                    <span className={`text-[11px] ${atrasado ? 'font-semibold text-amber-700' : 'text-ink-500'}`}>
                      {formatTime(order.created_at)} · {duracaoDesde(order.created_at, agora)}
                      {atrasado && ' · atenção'}
                    </span>
                  </div>
                </header>

                <div className="flex-1 space-y-2.5 px-4 py-3 text-[13px] text-ink-700">
                  <p className="flex items-start gap-2">
                    <Icon nome="local" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                    <span className="min-w-0">
                      {enderecoCompleto ? (
                        <>
                          <span className="block font-medium text-ink-800">
                            {enderecoCompleto.street}, {enderecoCompleto.number}
                            {enderecoCompleto.complement ? ` — ${enderecoCompleto.complement}` : ''}
                          </span>
                          <span className="block text-ink-500">
                            {order.delivery_neighborhood ?? enderecoCompleto.neighborhood}
                            {enderecoCompleto.reference ? ` · ref.: ${enderecoCompleto.reference}` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-500">
                          Bairro: {order.delivery_neighborhood ?? '—'} (endereço completo indisponível)
                        </span>
                      )}
                    </span>
                  </p>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-control bg-ink-50/70 px-3 py-2">
                    <span className="text-ink-500">Itens</span>
                    <span className="num text-right">{formatMoney(order.subtotal_cents)}</span>
                    <span className="text-ink-500">Taxa de entrega</span>
                    <span className="num text-right">{formatMoney(order.delivery_fee_cents)}</span>
                    {order.discount_cents > 0 && (
                      <>
                        <span className="text-ink-500">Desconto</span>
                        <span className="num text-right">- {formatMoney(order.discount_cents)}</span>
                      </>
                    )}
                    <span className="font-medium text-ink-700">Total</span>
                    <span className="num text-right font-semibold text-ink-900">{formatMoney(order.total_cents)}</span>
                    <span className="text-ink-500">Já recebido</span>
                    <span className="num text-right">{formatMoney(order.paid_cents)}</span>
                    <span className="font-medium text-ink-700">
                      {order.balance_cents > 0 ? 'Cobrar na entrega' : 'Quitado'}
                    </span>
                    <span
                      className={`num text-right font-semibold ${
                        order.balance_cents > 0 ? 'text-brand-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatMoney(order.balance_cents)}
                    </span>
                  </div>

                  {order.change_given_cents > 0 && (
                    <p className="text-xs text-ink-500">Troco entregue: {formatMoney(order.change_given_cents)}</p>
                  )}
                  {order.delivery_notes && (
                    <p className="flex items-start gap-2 text-xs italic text-ink-500">
                      <Icon nome="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {order.delivery_notes}
                    </p>
                  )}
                  {order.cancel_reason && (
                    <p className="text-xs font-medium text-red-700">Cancelado: {order.cancel_reason}</p>
                  )}
                  {order.account_closed_at && (
                    <p className="text-xs text-emerald-700">Conta fechada em {formatDateTime(order.account_closed_at)}</p>
                  )}
                </div>

                <footer className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-4 py-3">
                  {PROXIMO_PASSO[order.status] && (
                    <Button
                      size="sm"
                      icone="seta-direita"
                      loading={busyId === order.id}
                      onClick={() => avancar(order)}
                    >
                      {PROXIMO_PASSO[order.status]?.label}
                    </Button>
                  )}
                  {!order.account_closed_at && order.status !== 'cancelled' && order.balance_cents > 0 && (
                    <Button size="sm" variant="secondary" icone="dinheiro" onClick={() => setPagamento(order)}>
                      Receber
                    </Button>
                  )}
                  {!order.account_closed_at && order.status !== 'cancelled' && order.balance_cents === 0 && order.total_cents > 0 && (
                    <Button size="sm" variant="success" icone="check" onClick={() => fecharConta(order, false)}>
                      Fechar conta
                    </Button>
                  )}
                  <IconButton
                    nome="imprimir"
                    titulo="Imprimir comanda de entrega"
                    size="sm"
                    variant="secondary"
                    onClick={() => imprimirComanda(order)}
                  />
                  {isManager && !order.account_closed_at && order.status !== 'cancelled' && order.subtotal_cents > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setDescontoPedido(order)}>
                      Desconto
                    </Button>
                  )}
                  {isAdmin && !order.account_closed_at && order.status !== 'cancelled' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setTaxa({
                          order,
                          valor: (order.delivery_fee_cents / 100).toFixed(2).replace('.', ','),
                          motivo: '',
                        })
                      }
                    >
                      Ajustar taxa
                    </Button>
                  )}
                  {isAdmin && order.balance_cents > 0 && !order.account_closed_at && order.status !== 'cancelled' && (
                    <Button size="sm" variant="ghost" onClick={() => setFechamento({ order, motivo: '' })}>
                      Fechar com saldo
                    </Button>
                  )}
                  {order.status !== 'cancelled' && order.status !== 'delivered' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => {
                        setCancelar(order)
                        setMotivo('')
                      }}
                    >
                      Cancelar
                    </Button>
                  )}
                </footer>
              </article>
            )
          })}
        </div>
      )}

      <DiscountDialog
        pedido={descontoPedido}
        limitePct={
          isAdmin
            ? settings.data?.max_discount_pct_hard ?? 0
            : settings.data?.max_discount_pct_without_auth ?? 0
        }
        onClose={() => setDescontoPedido(null)}
        onSaved={() => {
          invalidateOrderData(queryClient)
          void deliveryOrders.refetch()
        }}
      />

      {pagamento && (
        <PaymentModal
          orderId={pagamento.id}
          orderNumber={pagamento.order_number}
          totalCents={pagamento.total_cents}
          paidCents={pagamento.paid_cents}
          descricaoPedido={`${pagamento.customer_name_snapshot ?? 'Delivery'} · ${pagamento.delivery_neighborhood ?? ''}`}
          onClose={() => {
            setPagamento(null)
            void deliveryOrders.refetch()
          }}
        />
      )}

      {/* Cancelamento com motivo obrigatório */}
      <ConfirmDialog
        open={Boolean(cancelar)}
        title={`Cancelar pedido #${cancelar?.order_number ?? ''}`}
        tone="danger"
        confirmLabel="Cancelar pedido"
        loading={busy}
        onCancel={() => setCancelar(null)}
        onConfirm={confirmarCancelamento}
        message={
          <div className="space-y-3">
            <p>
              O pedido do cliente <strong>{cancelar?.customer_name_snapshot}</strong> será marcado como cancelado. O
              registro não é apagado: fica no histórico com o motivo, o autor e o horário.
            </p>
            <Field label="Motivo do cancelamento" obrigatorio hint="Mínimo de 3 caracteres.">
              <Input
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                placeholder="ex.: cliente desistiu, endereço fora da área"
                autoFocus
              />
            </Field>
          </div>
        }
      />

      {/* Ajuste da taxa de entrega */}
      <Modal
        open={Boolean(taxa)}
        title={`Ajustar taxa — pedido #${taxa?.order.order_number ?? ''}`}
        descricao="Operação exclusiva do administrador e registrada na auditoria."
        onClose={() => setTaxa(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTaxa(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              onClick={salvarTaxa}
              loading={busy}
              disabled={!taxa?.motivo || taxa.motivo.trim().length < 3}
            >
              Salvar taxa
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nova taxa de entrega (R$)" obrigatorio>
            <Input
              value={taxa?.valor ?? ''}
              onChange={(event) => setTaxa((atual) => (atual ? { ...atual, valor: event.target.value } : atual))}
              inputMode="decimal"
              autoFocus
            />
          </Field>
          <Field label="Motivo do ajuste" obrigatorio hint="Mínimo de 3 caracteres.">
            <Input
              value={taxa?.motivo ?? ''}
              onChange={(event) => setTaxa((atual) => (atual ? { ...atual, motivo: event.target.value } : atual))}
              placeholder="ex.: bairro além do limite cadastrado"
            />
          </Field>
          <Callout tom="info">
            A taxa oficial do pedido é recalculada pelo servidor; o valor anterior fica no histórico de auditoria.
          </Callout>
        </div>
      </Modal>

      {/* Fechamento excepcional com saldo */}
      <Modal
        open={Boolean(fechamento)}
        title={`Fechar com saldo — pedido #${fechamento?.order.order_number ?? ''}`}
        descricao="Procedimento excepcional, exclusivo do administrador."
        onClose={() => setFechamento(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFechamento(null)} disabled={busy}>
              Voltar
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={!fechamento?.motivo || fechamento.motivo.trim().length < 3}
              onClick={() => fechamento && fecharConta(fechamento.order, true)}
            >
              Fechar com saldo
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Callout tom="atencao" titulo={`Saldo pendente de ${formatMoney(fechamento?.order.balance_cents ?? 0)}`}>
            O pedido será encerrado mesmo sem o pagamento. A justificativa fica gravada na auditoria e o saldo aparece
            nos relatórios.
          </Callout>
          <Field label="Justificativa" obrigatorio hint="Mínimo de 3 caracteres.">
            <Textarea
              value={fechamento?.motivo ?? ''}
              onChange={(event) =>
                setFechamento((atual) => (atual ? { ...atual, motivo: event.target.value } : atual))
              }
              placeholder="ex.: cliente não pagou na entrega e não retornou o contato"
            />
          </Field>
        </div>
      </Modal>

      {/* Novo pedido */}
      <Modal
        open={showNew}
        title="Novo pedido de delivery"
        descricao="Dados do cliente, endereço e itens. O valor oficial é calculado pelo servidor."
        onClose={() => setShowNew(false)}
        size="xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowNew(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              icone="check"
              onClick={criarPedido}
              loading={busy}
              disabled={cart.length === 0 || abaixoDoMinimo}
            >
              Registrar pedido · {formatMoney(cartSubtotal + taxaDoBairro)}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Card title="Cliente" icone="usuario">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome do cliente" obrigatorio>
                <Input value={cliente.nome} onChange={(event) => setCliente({ ...cliente, nome: event.target.value })} />
              </Field>
              <Field label="Telefone com DDD" obrigatorio hint="Clientes recorrentes são reconhecidos pelo telefone.">
                <Input
                  value={cliente.telefone}
                  onChange={(event) => setCliente({ ...cliente, telefone: event.target.value })}
                  placeholder="(86) 99999-0000"
                  inputMode="tel"
                />
              </Field>
            </div>
          </Card>

          {buscandoCliente && (
            <p className="text-pequeno text-ink-500">Procurando pedidos anteriores deste telefone…</p>
          )}

          {recorrente && !buscandoCliente && (
            <Callout
              tom="info"
              titulo={`Cliente recorrente: ${recorrente.name}`}
              acoes={
                recorrente.endereco ? (
                  <Button size="sm" variant="secondary" icone="local" onClick={usarEnderecoDoCliente}>
                    Usar o endereço anterior
                  </Button>
                ) : undefined
              }
            >
              {recorrente.endereco
                ? `Última entrega em ${recorrente.endereco.street}, ${recorrente.endereco.number} — ${recorrente.endereco.neighborhood}.`
                : 'O cadastro existe, mas não tem endereço salvo para reutilizar.'}
            </Callout>
          )}

          <Card
            title="Endereço de entrega"
            icone="local"
            descricao={`Taxa aplicada ao bairro informado: ${formatMoney(taxaDoBairro)}`}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Rua" obrigatorio>
                <Input value={endereco.rua} onChange={(event) => setEndereco({ ...endereco, rua: event.target.value })} />
              </Field>
              <Field label="Número" obrigatorio>
                <Input
                  value={endereco.numero}
                  onChange={(event) => setEndereco({ ...endereco, numero: event.target.value })}
                />
              </Field>
              <Field label="Complemento">
                <Input
                  value={endereco.complemento}
                  onChange={(event) => setEndereco({ ...endereco, complemento: event.target.value })}
                  placeholder="apto, bloco…"
                />
              </Field>
              <Field label="Bairro" obrigatorio hint="A taxa de entrega segue o cadastro de bairros.">
                <Input
                  value={endereco.bairro}
                  onChange={(event) => setEndereco({ ...endereco, bairro: event.target.value })}
                  list="bairros"
                  placeholder="ex.: Centro"
                />
                <datalist id="bairros">
                  {(zones.data ?? []).map((zona) => (
                    <option key={zona.id} value={zona.neighborhood} />
                  ))}
                </datalist>
              </Field>
              <Field label="Ponto de referência">
                <Input
                  value={endereco.referencia}
                  onChange={(event) => setEndereco({ ...endereco, referencia: event.target.value })}
                />
              </Field>
              <Field label="Observações da entrega">
                <Textarea
                  className="min-h-[44px]"
                  value={endereco.observacoes}
                  onChange={(event) => setEndereco({ ...endereco, observacoes: event.target.value })}
                  placeholder="ex.: entregar na portaria"
                />
              </Field>
            </div>
          </Card>

          <Card title="Itens do pedido" icone="pizza" padded={false}>
            <div className="p-3.5">
              <OrderComposer
                menu={menuData}
                halfRule={settings.data?.half_and_half_price_rule ?? 'highest'}
                items={cart}
                onChange={setCart}
                disabled={busy}
              />
            </div>
          </Card>

          <div className="rounded-card border border-ink-200 bg-ink-50/70 p-4 text-sm">
            <div className="flex items-center justify-between py-0.5">
              <span className="text-ink-500">Subtotal (prévia)</span>
              <span className="num">{formatMoney(cartSubtotal)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-ink-500">Taxa de entrega</span>
              <span className="num">{formatMoney(taxaDoBairro)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-ink-200 pt-2">
              <span className="font-medium text-ink-700">Total estimado</span>
              <span className="num text-lg font-semibold text-ink-900">{formatMoney(cartSubtotal + taxaDoBairro)}</span>
            </div>
            {abaixoDoMinimo && (
              <Callout tom="atencao" titulo="Abaixo do pedido mínimo">
                Esta pizzaria exige {formatMoney(pedidoMinimo)} em itens para delivery. Faltam{' '}
                <strong>{formatMoney(pedidoMinimo - cartSubtotal)}</strong> — a taxa de entrega não conta para o mínimo.
              </Callout>
            )}
            <p className="mt-1.5 text-[11px] text-ink-500">
              O valor oficial é confirmado pelo servidor com os preços vigentes do cardápio e a taxa do bairro.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
