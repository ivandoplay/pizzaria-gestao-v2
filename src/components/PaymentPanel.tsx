import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Callout, ConfirmDialog, Field, Input, Modal, useToast } from './ui'
import { Icon, type NomeIcone } from './icons'
import { useAuth } from '../context/AuthContext'
import { formatMoney, formatTime, parseMoneyToCents } from '../lib/format'
import { useChaveIdempotente } from '../lib/idempotencia'
import { saldoPendenteCents } from '../lib/pagamento'
import { erroSemCodigo, translateError } from '../lib/errors'
import * as api from '../lib/api'
import {
  invalidateOrderData,
  useCashSessionIsOpen,
  useOpenCashSession,
  usePaymentMethods,
  usePayments,
  useSettings,
} from '../lib/hooks'
import type { Payment } from '../lib/types'

/**
 * Registro de recebimentos de um pedido.
 *
 * REGRAS DE NEGÓCIO (validadas no banco, não aqui):
 *  - pagamentos parciais e combinados são permitidos;
 *  - dinheiro exige o valor recebido para calcular o troco (troco NÃO é receita);
 *  - Pix/cartão são registrados MANUALMENTE pelo operador (não há integração
 *    automática nesta versão — a confirmação é consciente);
 *  - o valor nunca pode passar do saldo pendente;
 *  - o recebimento exige um caixa aberto.
 */

const ICONE_POR_TIPO: Record<string, NomeIcone> = {
  cash: 'dinheiro',
  pix: 'qr',
  debit_card: 'cartao',
  credit_card: 'cartao',
  other: 'soma',
}

const TAXA_POR_TIPO: Record<string, string> = {
  pix: 'cobrança',
  debit_card: 'débito',
  credit_card: 'crédito',
  cash: 'espécie',
  other: '',
}

export function PaymentModal({
  orderId,
  orderNumber,
  totalCents,
  paidCents,
  descricaoPedido,
  onClose,
  onImprimirRecibo,
}: {
  orderId: string
  orderNumber: number
  /** Total do pedido (`orders.total_cents`), sem nenhuma subtração feita antes. */
  totalCents: number
  /** Já recebido no pedido (`orders.paid_cents`), sem nenhuma subtração feita antes. */
  paidCents: number
  /** Texto curto que identifica o pedido na tela (ex.: "Mesa 3 · salão"). */
  descricaoPedido?: string
  onClose: () => void
  /** Chamado depois de um recebimento confirmado, para imprimir o comprovante. */
  onImprimirRecibo?: () => void
}) {
  const { isAdmin, isManager } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const methods = usePaymentMethods(true)
  const settings = useSettings()
  const cashSession = useOpenCashSession()
  const payments = usePayments([orderId])

  const [methodId, setMethodId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [tendered, setTendered] = useState('')
  const [note, setNote] = useState('')
  const [isPrepaid, setIsPrepaid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [estorno, setEstorno] = useState<Payment | null>(null)
  const [motivoEstorno, setMotivoEstorno] = useState('')

  const confirmed = (payments.data ?? []).filter((payment) => payment.status === 'confirmed')
  const estornados = (payments.data ?? []).filter((payment) => payment.status === 'reversed')

  const activeMethods = useMemo(() => methods.data ?? [], [methods.data])
  /**
   * Configuração `split_payment_enabled` (migração 0015): desligada, o pedido
   * aceita uma única forma de pagamento. O banco é quem recusa; aqui a tela já
   * mostra só a forma que o pedido começou a usar.
   */
  const metodoUnicoPermitido =
    settings.data?.split_payment_enabled === false ? confirmed[0]?.method_id ?? null : null
  const metodosDisponiveis = metodoUnicoPermitido
    ? activeMethods.filter((method) => method.id === metodoUnicoPermitido)
    : activeMethods
  const selectedMethod =
    metodosDisponiveis.find((method) => method.id === methodId) ?? metodosDisponiveis[0] ?? null
  const changeTotal = confirmed.reduce((soma, payment) => soma + payment.change_cents, 0)
  // Saldo calculado UMA vez, a partir dos valores crus do pedido. Antes, a
  // tela recebia o saldo e subtraía o pago de novo (cobrava a menos).
  const remaining = saldoPendenteCents(totalCents, paidCents)

  const nomeMetodo = (id: string) => activeMethods.find((method) => method.id === id)?.label ?? 'Forma de pagamento'


  // Pré-preenche o valor com o saldo pendente: é o caso mais comum (conta cheia).
  useEffect(() => {
    if (amount === '') setAmount((remaining / 100).toFixed(2).replace('.', ','))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining])

  const amountCents = parseMoneyToCents(amount)
  const tenderedCents = tendered ? parseMoneyToCents(tendered) : null
  const changeCents =
    selectedMethod?.requires_change && tenderedCents !== null ? Math.max(tenderedCents - amountCents, 0) : 0

  /**
   * Chave da operação de recebimento: acompanha o CONTEÚDO do pagamento, não o
   * clique. Perdida a resposta, tentar de novo com o mesmo conteúdo reencontra o
   * recebimento já gravado (idempotência por `client_uuid` no banco) em vez de
   * receber duas vezes. Ao confirmar, a chave é renovada para o próximo valor.
   */
  const assinaturaDoRecebimento = `${selectedMethod?.id ?? ''}|${amountCents}|${tenderedCents ?? ''}|${isPrepaid}|${note.trim()}`
  const { chave: chaveDoRecebimento, renovar: renovarChaveDoRecebimento } = useChaveIdempotente(assinaturaDoRecebimento)

  const semMetodo = !methods.isLoading && metodosDisponiveis.length === 0
  /**
   * A gaveta (sessão de caixa) é lida só por caixa e administrador — RLS.
   * Para quem NÃO lê (garçom), "sem dado" não significa "caixa fechado": ele
   * recebe na mesa e quem decide é o banco, que recusa o recebimento com uma
   * mensagem clara quando não há turno aberto. Sem isso, o garçom ficaria com
   * o botão desabilitado mesmo com o caixa aberto.
   */
  const leAGaveta = isAdmin || isManager
  /** Quem não lê a gaveta pergunta só "tem turno aberto?" — sem ver valores. */
  const caixaParaQuemNaoLe = useCashSessionIsOpen(!leAGaveta)
  const caixaFechado = leAGaveta
    ? !cashSession.isLoading && !cashSession.data
    : caixaParaQuemNaoLe.data === false
  const caixaIndefinido = !leAGaveta && caixaParaQuemNaoLe.isLoading
  const caixaAberto = leAGaveta ? Boolean(cashSession.data) : caixaParaQuemNaoLe.data === true
  const podeRegistrar = remaining > 0 && !semMetodo && !caixaFechado && !caixaIndefinido && amountCents > 0

  async function handleSubmit() {
    if (!selectedMethod) return
    if (amountCents <= 0) {
      toast.error('Informe um valor maior que zero.')
      return
    }
    if (amountCents > remaining) {
      toast.error(
        `O valor informado é maior que o saldo pendente (${formatMoney(remaining)}). Corrija o valor ou registre um pagamento parcial antes.`,
      )
      return
    }
    if (selectedMethod.requires_change && (tenderedCents === null || tenderedCents < amountCents)) {
      toast.error('Informe quanto o cliente entregou em dinheiro — precisa ser igual ou maior que o valor do pagamento.')
      return
    }

    setBusy(true)
    try {
      await api.registerPayment({
        orderId,
        methodId: selectedMethod.id,
        amountCents,
        tenderedCents: selectedMethod.requires_change ? tenderedCents : null,
        isPrepaid,
        note: note.trim() || null,
        clientUuid: chaveDoRecebimento,
      })
      toast.success(
        changeCents > 0
          ? `Recebimento de ${formatMoney(amountCents)} registrado. Troco a devolver: ${formatMoney(changeCents)}.`
          : `Recebimento de ${formatMoney(amountCents)} registrado em ${selectedMethod.label}.`,
      )
      setAmount('')
      setTendered('')
      setNote('')
      setIsPrepaid(false)
      renovarChaveDoRecebimento()
      invalidateOrderData(queryClient)
    } catch (error) {
      if (erroSemCodigo(error)) {
        toast.error(
          'Não foi possível confirmar o recebimento. Se ele já tiver sido registrado, repetir este mesmo valor não duplica — confira o “Já recebido” antes de tentar de novo.',
        )
      } else {
        toast.error(translateError(error))
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * Teclado do caixa: com a janela de recebimento aberta, Enter registra o
   * valor que já está no campo. Quem opera no computador não precisa largar o
   * teclado para usar o mouse em cada conta.
   */
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key !== 'Enter' || evento.defaultPrevented) return
      if (busy || !podeRegistrar || estorno) return
      const alvo = evento.target as HTMLElement | null
      // Botões e áreas de texto seguem o comportamento normal.
      if (alvo && (alvo.tagName === 'BUTTON' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return
      evento.preventDefault()
      void handleSubmit()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  })

  async function confirmarEstorno() {
    if (!estorno) return
    setBusy(true)
    try {
      await api.reversePayment(estorno.id, motivoEstorno.trim())
      toast.success('Recebimento estornado. O registro original continua no histórico e fica auditado.')
      invalidateOrderData(queryClient)
      setEstorno(null)
      setMotivoEstorno('')
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open
        title={`Receber — pedido #${orderNumber}`}
        descricao={descricaoPedido}
        onClose={onClose}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Fechar
            </Button>
            {onImprimirRecibo && paidCents > 0 && (
              <Button variant="secondary" icone="imprimir" onClick={onImprimirRecibo} disabled={busy}>
                Imprimir recibo
              </Button>
            )}
            <Button
              icone="dinheiro"
              onClick={handleSubmit}
              loading={busy}
              disabled={!podeRegistrar}
              title={!podeRegistrar ? 'Verifique o caixa, a forma de pagamento e o valor' : undefined}
            >
              Registrar {formatMoney(amountCents)}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {caixaFechado && (
            <Callout tom="atencao" titulo="Nenhum caixa aberto">
              Abra o caixa em <strong>Controle de caixa</strong> antes de registrar recebimentos — o banco recusa
              pagamentos sem uma sessão de caixa aberta.
            </Callout>
          )}

          {/* Quem não lê a gaveta (garçom) não é bloqueado por ela: o valor entra
              no turno que estiver aberto e é o banco que recusa, com mensagem
              clara, quando ninguém abriu o caixa. */}
          {!leAGaveta && caixaIndefinido && (
            <Callout tom="info" titulo="Conferindo o caixa…">
              Verificando se o turno de caixa está aberto — o recebimento entra no turno em curso.
            </Callout>
          )}

          {!leAGaveta && caixaAberto && (
            <Callout tom="info" titulo="Caixa aberto">
              O recebimento entra no turno de caixa em curso. O valor aparece no fechamento do turno.
            </Callout>
          )}

          {!leAGaveta && caixaFechado && (
            <Callout tom="atencao" titulo="Caixa fechado">
              Ninguém abriu o turno de caixa ainda. Peça para o caixa abrir o turno e registre o recebimento —
              o banco recusa pagamentos sem uma sessão aberta.
            </Callout>
          )}

          {metodoUnicoPermitido && activeMethods.length > 0 && metodosDisponiveis.length === 0 && (
            <Callout tom="erro" titulo="Forma de pagamento do pedido está desativada">
              O primeiro recebimento deste pedido foi em uma forma que não está mais ativa. Reative a forma em{' '}
              <strong>Configurações</strong> ou estorne o recebimento para usar outra.
            </Callout>
          )}

          {metodoUnicoPermitido && metodosDisponiveis.length > 0 && (
            <Callout tom="info" titulo="Uma única forma de pagamento">
              O pagamento dividido está desativado nas configurações. Este pedido já começou a ser recebido em{' '}
              <strong>{nomeMetodo(metodoUnicoPermitido)}</strong> — as próximas parcelas usam a mesma forma.
            </Callout>
          )}

          {semMetodo && !metodoUnicoPermitido && (
            <Callout tom="erro" titulo="Nenhuma forma de pagamento ativa">
              Ative ao menos uma forma de pagamento em <strong>Configurações</strong> para poder receber.
            </Callout>
          )}

          {/* Resumo do pedido */}
          <div className="grid grid-cols-3 gap-3 rounded-card border border-ink-200 bg-ink-50/60 p-3.5 text-center">
            <div>
              <p className="rotulo">Total do pedido</p>
              <p className="num mt-1 text-sm font-semibold text-ink-900">{formatMoney(totalCents)}</p>
            </div>
            <div>
              <p className="rotulo">Já recebido</p>
              <p className="num mt-1 text-sm font-semibold text-emerald-700">{formatMoney(paidCents)}</p>
            </div>
            <div>
              <p className="rotulo">Falta receber</p>
              <p className={`num mt-1 text-base font-semibold ${remaining > 0 ? 'text-brand-700' : 'text-emerald-700'}`}>
                {formatMoney(remaining)}
              </p>
            </div>
          </div>

          {remaining > 0 && (
            <>
              <Field label="Forma de pagamento" obrigatorio>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {metodosDisponiveis.map((method) => {
                    const ativo = selectedMethod?.id === method.id
                    return (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => setMethodId(method.id)}
                        aria-pressed={ativo}
                        className={`flex items-center gap-2 rounded-control border px-3 py-2.5 text-left text-[13px] font-medium transition ${
                          ativo
                            ? 'border-brand-600 bg-brand-50 text-brand-800 shadow-sm'
                            : 'border-ink-300 bg-white text-ink-700 hover:border-ink-400 hover:bg-ink-50'
                        }`}
                      >
                        <Icon nome={ICONE_POR_TIPO[method.kind] ?? 'dinheiro'} className="h-4 w-4 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate">{method.label}</span>
                          {TAXA_POR_TIPO[method.kind] && (
                            <span className="block text-[10px] font-normal text-ink-500">
                              {TAXA_POR_TIPO[method.kind]}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Valor a receber (R$)" hint={`Máximo: ${formatMoney(remaining)}`}>
                  <Input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    autoFocus
                  />
                </Field>

                {selectedMethod?.requires_change ? (
                  <Field
                    label="Quanto o cliente entregou (R$)"
                    hint={tenderedCents !== null && changeCents > 0 ? undefined : 'Informe para calcular o troco'}
                  >
                    <Input
                      value={tendered}
                      onChange={(event) => setTendered(event.target.value)}
                      placeholder="ex.: 100,00"
                      inputMode="decimal"
                    />
                  </Field>
                ) : (
                  <Field label="Observação" hint="Opcional — fica gravada no recebimento.">
                    <Input
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="ex.: aprovado na maquininha"
                    />
                  </Field>
                )}
              </div>

              {selectedMethod?.requires_change && (
                <div>
                  <div className="flex flex-wrap gap-2">
                    <ChipDinheiro valor={amountCents} onEscolher={setTendered} />
                    {[5000, 10000, 20000].map((valor) => (
                      <button
                        key={valor}
                        type="button"
                        onClick={() => setTendered((valor / 100).toFixed(2).replace('.', ','))}
                        className="rounded-full border border-ink-300 bg-white px-3 py-1 text-xs font-medium text-ink-600 transition hover:border-ink-400 hover:bg-ink-50"
                      >
                        {formatMoney(valor)}
                      </button>
                    ))}
                    <Button size="sm" variant="ghost" onClick={() => setTendered('')}>
                      Limpar
                    </Button>
                  </div>

                  {tenderedCents !== null && (
                    <div
                      className={`mt-2.5 flex items-center justify-between rounded-card border px-3.5 py-2.5 ${
                        tenderedCents < amountCents
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-[13px] font-medium">
                        <Icon nome={tenderedCents < amountCents ? 'alerta' : 'dinheiro'} className="h-4 w-4" />
                        {tenderedCents < amountCents ? 'Valor insuficiente para este pagamento' : 'Troco a devolver'}
                      </span>
                      <span className="num text-lg font-semibold">
                        {tenderedCents < amountCents
                          ? `faltam ${formatMoney(amountCents - tenderedCents)}`
                          : formatMoney(changeCents)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {selectedMethod && ['pix', 'debit_card', 'credit_card'].includes(selectedMethod.kind) && (
                <Callout tom="info" titulo="Confirmação manual">
                  Confira o recebimento no aplicativo do banco ou na maquininha <strong>antes</strong> de registrar.
                  Nesta versão o sistema não confirma pagamentos automaticamente.
                </Callout>
              )}

              {selectedMethod?.allows_prepaid && (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-card border border-ink-200 p-3 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={isPrepaid}
                    onChange={(event) => setIsPrepaid(event.target.checked)}
                    className="mt-0.5 h-[18px] w-[18px] rounded border-ink-300 text-brand-600"
                  />
                  <span>
                    Pagamento antecipado
                    <span className="mt-0.5 block text-xs text-ink-500">
                      Marque quando o cliente paga antes de receber o pedido (comum no delivery).
                    </span>
                  </span>
                </label>
              )}
            </>
          )}

          {remaining <= 0 && (
            <Callout tom="sucesso" titulo="Pedido totalmente recebido">
              Não há saldo pendente neste pedido. Você já pode fechar a conta e liberar a mesa.
            </Callout>
          )}

          {(confirmed.length > 0 || estornados.length > 0) && (
            <div>
              <h4 className="rotulo mb-2">Recebimentos deste pedido</h4>
              <ul className="space-y-1.5">
                {[...confirmed, ...estornados].map((payment) => (
                  <li
                    key={payment.id}
                    className={`flex items-center justify-between gap-3 rounded-card border px-3 py-2 text-[13px] ${
                      payment.status === 'reversed'
                        ? 'border-red-200 bg-red-50/60 text-ink-500'
                        : 'border-ink-200 bg-white text-ink-800'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className={`num font-semibold ${payment.status === 'reversed' ? 'line-through' : ''}`}>
                        {formatMoney(payment.amount_cents)}
                      </span>{' '}
                      <span className={payment.status === 'reversed' ? 'line-through' : ''}>
                        · {nomeMetodo(payment.method_id)}
                      </span>
                      <span className="block text-[11px] text-ink-500">
                        {formatTime(payment.created_at)}
                        {payment.change_cents > 0 && ` · troco ${formatMoney(payment.change_cents)}`}
                        {payment.is_prepaid && ' · antecipado'}
                        {payment.status === 'reversed' && ' · estornado'}
                      </span>
                      {payment.reverse_reason && (
                        <span className="block text-[11px] text-red-600">motivo: {payment.reverse_reason}</span>
                      )}
                    </span>
                    {payment.status === 'confirmed' && isManager && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => {
                          setEstorno(payment)
                          setMotivoEstorno('')
                        }}
                        disabled={busy}
                      >
                        Estornar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {changeTotal > 0 && (
                <p className="mt-2 text-[11px] text-ink-500">
                  Troco entregue neste pedido: {formatMoney(changeTotal)} — troco não é receita e não entra no
                  faturamento.
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(estorno)}
        title="Estornar recebimento"
        tone="danger"
        confirmLabel="Estornar"
        loading={busy}
        onCancel={() => setEstorno(null)}
        onConfirm={confirmarEstorno}
        message={
          <div className="space-y-3">
            <p>
              O recebimento de <strong>{formatMoney(estorno?.amount_cents ?? 0)}</strong> em{' '}
              <strong>{estorno ? nomeMetodo(estorno.method_id) : ''}</strong> será marcado como estornado. O registro
              original <strong>não é apagado</strong> — ele fica no histórico, com o motivo, para auditoria.
            </p>
            <Field label="Motivo do estorno" obrigatorio hint="Mínimo de 3 caracteres.">
              <Input
                value={motivoEstorno}
                onChange={(event) => setMotivoEstorno(event.target.value)}
                placeholder="ex.: valor digitado errado, cliente pagou em outra forma"
                autoFocus
              />
            </Field>
          </div>
        }
      />
    </>
  )
}

function ChipDinheiro({ valor, onEscolher }: { valor: number; onEscolher: (valor: string) => void }) {
  if (valor <= 0) return null
  const sugestoes = [valor, Math.ceil(valor / 5000) * 5000, Math.ceil(valor / 10000) * 10000]
  const unicas = [...new Set(sugestoes)].filter((v) => v >= valor).slice(0, 2)
  return (
    <>
      {unicas.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onEscolher((v / 100).toFixed(2).replace('.', ','))}
          className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 transition hover:bg-brand-100"
        >
          {formatMoney(v)}
        </button>
      ))}
    </>
  )
}
