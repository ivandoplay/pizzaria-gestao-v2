import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Field, Input, Modal, useToast } from './ui'
import { formatMoney, newClientUuid, parseMoneyToCents } from '../lib/format'
import { translateError } from '../lib/errors'
import * as api from '../lib/api'
import { invalidateOrderData, useOpenCashSession, usePaymentMethods, usePayments } from '../lib/hooks'

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
export function PaymentModal({
  orderId,
  orderNumber,
  balanceCents,
  onClose,
}: {
  orderId: string
  orderNumber: number
  balanceCents: number
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const methods = usePaymentMethods(true)
  const cashSession = useOpenCashSession()
  const payments = usePayments([orderId])

  const [methodId, setMethodId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [tendered, setTendered] = useState('')
  const [note, setNote] = useState('')
  const [isPrepaid, setIsPrepaid] = useState(false)
  const [busy, setBusy] = useState(false)

  const activeMethods = useMemo(() => methods.data ?? [], [methods.data])
  const selectedMethod = activeMethods.find((method) => method.id === methodId) ?? activeMethods[0] ?? null

  const amountCents = parseMoneyToCents(amount || (balanceCents / 100).toFixed(2).replace('.', ','))
  const tenderedCents = tendered ? parseMoneyToCents(tendered) : null
  const changeCents =
    selectedMethod?.requires_change && tenderedCents !== null ? Math.max(tenderedCents - amountCents, 0) : 0

  const confirmed = (payments.data ?? []).filter((payment) => payment.status === 'confirmed')
  const paidCents = confirmed.reduce((sum, payment) => sum + payment.amount_cents, 0)
  const changeTotal = confirmed.reduce((sum, payment) => sum + payment.change_cents, 0)
  const remaining = balanceCents - paidCents

  async function handleSubmit() {
    if (!selectedMethod) return
    if (amountCents <= 0) {
      toast.error('Informe um valor maior que zero.')
      return
    }
    if (amountCents > remaining) {
      toast.error('O valor informado é maior que o saldo pendente.')
      return
    }
    if (selectedMethod.requires_change && (tenderedCents === null || tenderedCents < amountCents)) {
      toast.error('Informe o valor recebido em dinheiro (maior ou igual ao valor do pagamento).')
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
        clientUuid: newClientUuid(),
      })
      toast.success(
        changeCents > 0
          ? `Recebimento registrado. Troco: ${formatMoney(changeCents)}.`
          : 'Recebimento registrado.',
      )
      setAmount('')
      setTendered('')
      setNote('')
      invalidateOrderData(queryClient)
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleReverse(paymentId: string) {
    const reason = window.prompt('Motivo do estorno (obrigatório):')
    if (!reason || reason.trim().length < 3) return
    setBusy(true)
    try {
      await api.reversePayment(paymentId, reason.trim())
      toast.success('Recebimento estornado (registro preservado e auditado).')
      invalidateOrderData(queryClient)
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={`Recebimentos — pedido #${orderNumber}`}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Fechar
          </Button>
          <Button onClick={handleSubmit} loading={busy} disabled={remaining <= 0}>
            Registrar {formatMoney(amountCents)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!cashSession.data && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Nenhum caixa aberto. Abra o caixa em <strong>Controle de caixa</strong> antes de registrar recebimentos —
            o banco recusa pagamentos sem sessão de caixa.
          </div>
        )}

        <div className="rounded-md border border-slate-200 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Saldo do pedido</span>
            <span className="font-semibold text-slate-900">{formatMoney(balanceCents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Já recebido</span>
            <span className="text-slate-800">{formatMoney(paidCents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Falta receber</span>
            <span className="font-semibold text-brand-700">{formatMoney(remaining)}</span>
          </div>
          {changeTotal > 0 && (
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Troco entregue</span>
              <span>{formatMoney(changeTotal)}</span>
            </div>
          )}
        </div>

        <Field label="Forma de pagamento">
          <div className="flex flex-wrap gap-2">
            {activeMethods.map((method) => (
              <button
                key={method.id}
                onClick={() => setMethodId(method.id)}
                className={`rounded-md border px-3 py-2 text-xs ${
                  (selectedMethod?.id ?? '') === method.id
                    ? 'border-brand-600 bg-brand-50 text-brand-800'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                {method.label}
                {method.kind === 'cash' && <span className="ml-1 text-[10px] text-slate-500">(gaveta)</span>}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Valor a receber (R$)" hint="Aceita valores parciais.">
            <Input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={(remaining / 100).toFixed(2).replace('.', ',')}
              inputMode="decimal"
            />
          </Field>

          {selectedMethod?.requires_change ? (
            <Field label="Valor recebido em dinheiro (R$)" hint={changeCents > 0 ? `Troco: ${formatMoney(changeCents)}` : undefined}>
              <Input
                value={tendered}
                onChange={(event) => setTendered(event.target.value)}
                placeholder="ex.: 100,00"
                inputMode="decimal"
              />
            </Field>
          ) : (
            <Field label="Observação (opcional)">
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="ex.: aprovado na maquininha" />
            </Field>
          )}
        </div>

        {selectedMethod && ['pix', 'debit_card', 'credit_card'].includes(selectedMethod.kind) && (
          <div className="rounded-md bg-slate-50 p-3 text-[11px] text-slate-600">
            O recebimento é registrado manualmente: confirme no aplicativo da maquininha/banco antes de registrar.
            Nesta versão o sistema <strong>não</strong> confirma pagamentos automaticamente.
          </div>
        )}

        {selectedMethod?.allows_prepaid && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isPrepaid}
              onChange={(event) => setIsPrepaid(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            Pagamento antecipado (antes da entrega)
          </label>
        )}

        {confirmed.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recebimentos deste pedido
            </h4>
            <ul className="space-y-1 text-xs text-slate-700">
              {confirmed.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1">
                  <span>
                    {formatMoney(payment.amount_cents)} · {payment.method_id}
                    {payment.change_cents > 0 && ` · troco ${formatMoney(payment.change_cents)}`}
                    {payment.is_prepaid && ' · antecipado'}
                  </span>
                  <button className="text-red-600 hover:underline" onClick={() => handleReverse(payment.id)} disabled={busy}>
                    estornar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
