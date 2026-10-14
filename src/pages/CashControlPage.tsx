import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useCashMovements, useOpenCashSession } from '../lib/hooks'
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
  useToast,
} from '../components/ui'
import { formatDateTime, formatMoney, newClientUuid, parseMoneyToCents } from '../lib/format'
import { translateError } from '../lib/errors'
import { CASH_CATEGORY_LABELS } from '../lib/types'

export default function CashControlPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { profile, isAdmin } = useAuth()
  const session = useOpenCashSession()
  const movements = useCashMovements(session.data?.id)

  const [openingAmount, setOpeningAmount] = useState('0,00')
  const [openingNote, setOpeningNote] = useState('')
  const [movementForm, setMovementForm] = useState<null | { kind: 'in' | 'out'; category: 'change_fund' | 'withdrawal' | 'expense' | 'adjustment'; amount: string; description: string; reason: string }>(null)
  const [closingForm, setClosingForm] = useState<null | { counted: string; note: string; varianceReason: string }>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (session.data) {
      setOpeningAmount((session.data.opening_amount_cents / 100).toFixed(2).replace('.', ','))
    }
  }, [session.data])

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['cash-session'] })
    await queryClient.invalidateQueries({ queryKey: ['cash-movements'] })
  }

  async function handleOpen() {
    setBusy(true)
    try {
      await api.startCashSession(parseMoneyToCents(openingAmount), openingNote.trim() || null, newClientUuid())
      toast.success('Caixa aberto.')
      setOpeningNote('')
      await refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleMovement() {
    if (!movementForm || !session.data) return
    setBusy(true)
    try {
      await api.addCashMovement({
        sessionId: session.data.id,
        kind: movementForm.kind,
        category: movementForm.category,
        amountCents: parseMoneyToCents(movementForm.amount),
        description: movementForm.description.trim() || undefined,
        reason: movementForm.reason.trim() || undefined,
        clientUuid: newClientUuid(),
      })
      toast.success('Movimentação registrada.')
      setMovementForm(null)
      await refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleClose() {
    if (!closingForm || !session.data) return
    setBusy(true)
    try {
      const closed = await api.closeCashSession(
        session.data.id,
        parseMoneyToCents(closingForm.counted),
        closingForm.note.trim() || undefined,
        closingForm.varianceReason.trim() || undefined,
      )
      const difference = closed.difference_cents ?? 0
      toast.success(
        difference === 0
          ? 'Caixa fechado sem divergência.'
          : `Caixa fechado com divergência de ${formatMoney(Math.abs(difference))} (registrada na auditoria).`,
      )
      setClosingForm(null)
      await refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  if (session.isLoading) return <LoadingBlock label="Carregando o caixa…" />
  if (session.error) return <ErrorBlock message={translateError(session.error)} onRetry={() => void session.refetch()} />

  // ---------------------------------------------------------------- sem caixa
  if (!session.data) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Card title="Abrir caixa">
          <div className="space-y-3">
            <Field label="Fundo de troco em dinheiro (R$)" hint="Valor físico em gaveta no início do turno.">
              <Input value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Observação (opcional)">
              <Input value={openingNote} onChange={(event) => setOpeningNote(event.target.value)} placeholder="ex.: turno da noite" />
            </Field>
            <Button className="w-full" size="lg" loading={busy} onClick={handleOpen}>
              Abrir caixa
            </Button>
            <p className="text-xs text-slate-500">
              Só é permitido um caixa aberto por vez. Após abrir, os recebimentos (Pix, cartão e dinheiro) ficam
              vinculados a este turno.
            </p>
          </div>
        </Card>
      </div>
    )
  }

  const current = session.data
  const movementsList = movements.data ?? []
  const canClose = isAdmin || current.opened_by === profile?.id

  return (
    <div className="space-y-4">
      <Card
        title="Sessão de caixa em andamento"
        actions={<Badge tone="green">Aberto desde {formatDateTime(current.opened_at)}</Badge>}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Responsável" value={current.opened_by_name ?? '—'} />
          <Stat label="Fundo de troco" value={formatMoney(current.opening_amount_cents)} />
          <Stat label="Vendas em dinheiro" value={formatMoney(current.cash_sales_cents)} />
          <Stat label="Saldo esperado na gaveta" value={formatMoney(current.expected_cash_cents)} emphasis />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setMovementForm({ kind: 'in', category: 'change_fund', amount: '', description: '', reason: '' })}
          >
            + Entrada (reforço de troco)
          </Button>
          <Button
            variant="secondary"
            onClick={() => setMovementForm({ kind: 'out', category: 'withdrawal', amount: '', description: '', reason: '' })}
          >
            − Saída (sangria/despesa)
          </Button>
          <Button variant="danger" onClick={() => setClosingForm({ counted: '', note: '', varianceReason: '' })} disabled={!canClose}>
            Fechar caixa
          </Button>
        </div>
        {!canClose && (
          <p className="mt-2 text-xs text-amber-700">
            Somente o responsável por este caixa (ou um administrador) pode fechá-lo.
          </p>
        )}
      </Card>

      <Card title="Movimentações do turno">
        {movements.isLoading ? (
          <LoadingBlock />
        ) : movementsList.length === 0 ? (
          <EmptyState title="Sem movimentações" description="Recebimentos em dinheiro aparecem aqui automaticamente." />
        ) : (
          <DataTable
            rows={movementsList}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'when',
                header: 'Horário',
                render: (row) => formatDateTime(row.created_at),
              },
              {
                key: 'category',
                header: 'Tipo',
                render: (row) => (
                  <span className={row.kind === 'in' ? 'text-emerald-700' : 'text-red-700'}>
                    {row.kind === 'in' ? '▲' : '▼'} {CASH_CATEGORY_LABELS[row.category]}
                  </span>
                ),
              },
              {
                key: 'description',
                header: 'Descrição',
                render: (row) => (
                  <span className="text-xs text-slate-600">
                    {row.description ?? '—'}
                    {row.source === 'automatic' && <Badge tone="blue">automático</Badge>}
                  </span>
                ),
              },
              {
                key: 'amount',
                header: 'Valor',
                align: 'right',
                render: (row) => (
                  <span className={row.kind === 'in' ? 'text-emerald-700' : 'text-red-700'}>
                    {row.kind === 'in' ? '+' : '−'} {formatMoney(row.amount_cents)}
                  </span>
                ),
              },
            ]}
          />
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          O saldo esperado considera somente dinheiro físico (abertura + entradas − saídas). Pix e cartões não entram na
          gaveta.
        </p>
      </Card>

      {/* Nova movimentação */}
      <Modal
        open={Boolean(movementForm)}
        title={movementForm?.kind === 'in' ? 'Registrar entrada de dinheiro' : 'Registrar saída de dinheiro'}
        onClose={() => setMovementForm(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMovementForm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={handleMovement} loading={busy}>
              Registrar
            </Button>
          </>
        }
      >
        {movementForm && (
          <div className="space-y-3">
            <Field label="Tipo">
              <div className="flex gap-2">
                {(
                  [
                    { kind: 'in', category: 'change_fund', label: 'Reforço de troco' },
                    { kind: 'in', category: 'adjustment', label: 'Ajuste (entrada)' },
                    { kind: 'out', category: 'withdrawal', label: 'Sangria/retirada' },
                    { kind: 'out', category: 'expense', label: 'Despesa operacional' },
                    { kind: 'out', category: 'adjustment', label: 'Ajuste (saída)' },
                  ] as const
                ).map((option) => (
                  <button
                    key={`${option.kind}-${option.category}`}
                    onClick={() => setMovementForm({ ...movementForm, kind: option.kind, category: option.category })}
                    className={`rounded-md border px-3 py-1.5 text-xs ${
                      movementForm.kind === option.kind && movementForm.category === option.category
                        ? 'border-brand-600 bg-brand-50 text-brand-800'
                        : 'border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Valor (R$)">
              <Input
                value={movementForm.amount}
                onChange={(event) => setMovementForm({ ...movementForm, amount: event.target.value })}
                inputMode="decimal"
                placeholder="0,00"
              />
            </Field>
            <Field label="Descrição">
              <Input
                value={movementForm.description}
                onChange={(event) => setMovementForm({ ...movementForm, description: event.target.value })}
                placeholder="ex.: compra de gelo"
              />
            </Field>
            <Field label="Motivo / justificativa" hint="Registrado na auditoria.">
              <Input
                value={movementForm.reason}
                onChange={(event) => setMovementForm({ ...movementForm, reason: event.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Fechamento */}
      <Modal
        open={Boolean(closingForm)}
        title="Fechar caixa"
        onClose={() => setClosingForm(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setClosingForm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleClose} loading={busy}>
              Confirmar fechamento
            </Button>
          </>
        }
      >
        {closingForm && (
          <div className="space-y-3">
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Saldo esperado (dinheiro)</span>
                <span className="font-semibold">{formatMoney(current.expected_cash_cents)}</span>
              </div>
            </div>
            <Field label="Valor contado na gaveta (R$)">
              <Input
                value={closingForm.counted}
                onChange={(event) => setClosingForm({ ...closingForm, counted: event.target.value })}
                inputMode="decimal"
                placeholder="0,00"
              />
            </Field>
            <Field label="Observação do fechamento">
              <Input
                value={closingForm.note}
                onChange={(event) => setClosingForm({ ...closingForm, note: event.target.value })}
              />
            </Field>
            <Field
              label="Justificativa da divergência"
              hint="Obrigatória quando o valor contado for diferente do esperado (fora da tolerância)."
            >
              <Input
                value={closingForm.varianceReason}
                onChange={(event) => setClosingForm({ ...closingForm, varianceReason: event.target.value })}
                placeholder="ex.: troco trocado a mais para o cliente X"
              />
            </Field>
            <p className="text-xs text-slate-500">
              Depois de fechar, valores e movimentações deste turno não podem mais ser alterados — ajustes posteriores
              são administrativos e auditados.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={emphasis ? 'text-base font-semibold text-brand-700' : 'text-sm text-slate-800'}>{value}</p>
    </div>
  )
}
