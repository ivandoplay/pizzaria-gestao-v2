import { useEffect, useMemo, useState } from 'react'
import { Button, Callout, Field, Input, Modal, SegmentedControl, useToast } from './ui'
import { formatMoney, parseMoneyToCents } from '../lib/format'
import { translateError } from '../lib/errors'
import * as api from '../lib/api'

/**
 * Desconto no pedido (RPC `set_order_discount`).
 *
 * O banco é quem manda: exige motivo com 3+ caracteres, não deixa passar do
 * subtotal e aplica o limite do perfil — caixa até `max_discount_pct_without_auth`,
 * administrador até `max_discount_pct_hard`. A janela só antecipa essas regras.
 */
export function DiscountDialog({
  pedido,
  limitePct,
  onClose,
  onSaved,
}: {
  pedido: { id: string; order_number: number; subtotal_cents: number; discount_cents: number } | null
  /** Limite do perfil que está operando (percentual sobre o subtotal). */
  limitePct: number
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [modo, setModo] = useState<'pct' | 'valor'>('pct')
  const [pct, setPct] = useState('')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pedido) return
    setModo('pct')
    setPct('')
    setValor('')
    setMotivo('')
  }, [pedido?.id])

  const subtotal = pedido?.subtotal_cents ?? 0
  const pctNum = Number(pct.replace(',', '.'))
  const valorCents = parseMoneyToCents(valor)
  const descontoPrevisto = useMemo(() => {
    if (modo === 'pct') return Number.isFinite(pctNum) && pctNum > 0 ? Math.round((subtotal * pctNum) / 100) : 0
    return valorCents
  }, [modo, pctNum, subtotal, valorCents])

  async function salvar(remover = false) {
    if (!pedido) return
    if (motivo.trim().length < 3) {
      toast.error('Informe o motivo do desconto (mínimo de 3 caracteres).')
      return
    }

    let args: { pct?: number; cents?: number } = {}
    if (remover) {
      args = { cents: 0 }
    } else if (modo === 'pct') {
      if (!Number.isFinite(pctNum) || pctNum <= 0) {
        toast.error('Informe o percentual de desconto maior que zero.')
        return
      }
      if (pctNum > limitePct) {
        toast.error(`O limite de desconto do seu perfil é ${limitePct}%.`)
        return
      }
      args = { pct: pctNum }
    } else {
      if (valorCents <= 0) {
        toast.error('Informe o valor do desconto maior que zero.')
        return
      }
      if (valorCents > subtotal) {
        toast.error('O desconto não pode ser maior que o subtotal do pedido.')
        return
      }
      const pctEquivalente = Number(((valorCents / subtotal) * 100).toFixed(2))
      if (pctEquivalente > limitePct) {
        toast.error(
          `Esse valor equivale a ${pctEquivalente.toFixed(2)}%, acima do limite de ${limitePct}% do seu perfil.`,
        )
        return
      }
      args = { cents: valorCents }
    }

    setBusy(true)
    try {
      await api.setOrderDiscount(pedido.id, motivo.trim(), args.pct, args.cents)
      toast.success(remover ? 'Desconto removido.' : `Desconto de ${formatMoney(descontoPrevisto)} aplicado.`)
      onSaved()
      onClose()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(pedido)}
      title={`Desconto — pedido #${pedido?.order_number ?? ''}`}
      descricao="O desconto fica registrado na auditoria com motivo, autor e horário."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          {pedido && pedido.discount_cents > 0 && (
            <Button variant="ghost" onClick={() => salvar(true)} loading={busy}>
              Remover desconto
            </Button>
          )}
          <Button onClick={() => salvar(false)} loading={busy}>
            Aplicar desconto
          </Button>
        </>
      }
    >
      {pedido && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-card border border-ink-200 bg-ink-50/60 px-3.5 py-2.5 text-sm">
            <span className="text-ink-500">Subtotal do pedido</span>
            <span className="num font-semibold text-ink-900">{formatMoney(subtotal)}</span>
          </div>

          {pedido.discount_cents > 0 && (
            <Callout tom="info" titulo="Desconto atual">
              {formatMoney(pedido.discount_cents)} neste pedido. Aplicar um novo valor substitui o anterior.
            </Callout>
          )}

          <SegmentedControl
            valor={modo}
            onChange={setModo}
            opcoes={[
              { valor: 'pct', rotulo: 'Percentual' },
              { valor: 'valor', rotulo: 'Valor em R$' },
            ]}
          />

          {modo === 'pct' ? (
            <Field label="Percentual (%)" hint={`Limite do seu perfil: ${limitePct}%`} obrigatorio>
              <Input
                value={pct}
                onChange={(event) => setPct(event.target.value)}
                inputMode="decimal"
                placeholder="ex.: 10"
                autoFocus
              />
            </Field>
          ) : (
            <Field label="Valor do desconto (R$)" hint={`Limite do seu perfil: ${limitePct}% do subtotal`} obrigatorio>
              <Input
                value={valor}
                onChange={(event) => setValor(event.target.value)}
                inputMode="decimal"
                placeholder="ex.: 5,00"
                autoFocus
              />
            </Field>
          )}

          <Field label="Motivo" obrigatorio hint="Mínimo de 3 caracteres. Fica na auditoria.">
            <Input
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              placeholder="ex.: cliente recorrente, cortesia autorizada"
            />
          </Field>

          <div className="flex items-center justify-between rounded-card border border-brand-200 bg-brand-50/60 px-3.5 py-2.5 text-sm">
            <span className="text-ink-600">Desconto previsto</span>
            <span className="num font-semibold text-brand-800">{formatMoney(descontoPrevisto)}</span>
          </div>
        </div>
      )}
    </Modal>
  )
}
