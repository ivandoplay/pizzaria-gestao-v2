import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useCashMovements, useOpenCashSession, useSettings } from '../lib/hooks'
import * as api from '../lib/api'
import {
  Badge,
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  StatTile,
  useToast,
} from '../components/ui'
import { Icon } from '../components/icons'
import { formatDateTime, formatMoney, parseMoneyToCents, plural } from '../lib/format'
import { useChaveIdempotente } from '../lib/idempotencia'
import { translateError } from '../lib/errors'
import { empresaDoRecibo } from '../lib/recibo'
import { CASH_CATEGORY_LABELS } from '../lib/types'

type CategoriaMovimento = 'change_fund' | 'withdrawal' | 'expense' | 'adjustment'

const TIPOS_MOVIMENTO: { kind: 'in' | 'out'; category: CategoriaMovimento; label: string; icone: 'mais' | 'menos' }[] = [
  { kind: 'in', category: 'change_fund', label: 'Reforço de troco', icone: 'mais' },
  { kind: 'in', category: 'adjustment', label: 'Ajuste de entrada', icone: 'mais' },
  { kind: 'out', category: 'withdrawal', label: 'Sangria / retirada', icone: 'menos' },
  { kind: 'out', category: 'expense', label: 'Despesa operacional', icone: 'menos' },
  { kind: 'out', category: 'adjustment', label: 'Ajuste de saída', icone: 'menos' },
]

export default function CashControlPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { profile, isAdmin } = useAuth()
  const session = useOpenCashSession()
  const settings = useSettings()
  const movements = useCashMovements(session.data?.id)

  const [openingAmount, setOpeningAmount] = useState('0,00')
  const [openingNote, setOpeningNote] = useState('')
  const [movementForm, setMovementForm] = useState<
    null | { kind: 'in' | 'out'; category: CategoriaMovimento; amount: string; description: string; reason: string }
  >(null)
  const [closingForm, setClosingForm] = useState<null | { counted: string; note: string; varianceReason: string }>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Chaves de idempotência presas à OPERAÇÃO, não ao clique: se a resposta se
   * perder, repetir o mesmo conteúdo reencontra o lançamento já gravado em vez
   * de criar outro. A chave só é renovada depois do sucesso.
   */
  const assinaturaAbertura = `${openingAmount}|${openingNote.trim()}`
  const { chave: chaveAbertura, renovar: renovarAbertura } = useChaveIdempotente(assinaturaAbertura)
  const assinaturaMovimento = movementForm
    ? [
        session.data?.id ?? '',
        movementForm.kind,
        movementForm.category,
        movementForm.amount,
        movementForm.description.trim(),
        movementForm.reason.trim(),
      ].join('|')
    : ''
  const { chave: chaveMovimento, renovar: renovarMovimento } = useChaveIdempotente(assinaturaMovimento)

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
      await api.startCashSession(parseMoneyToCents(openingAmount), openingNote.trim() || null, chaveAbertura)
      toast.success(`Caixa aberto com ${formatMoney(parseMoneyToCents(openingAmount))} de fundo de troco.`)
      renovarAbertura()
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
    const valor = parseMoneyToCents(movementForm.amount)
    if (valor <= 0) {
      toast.error('Informe um valor maior que zero para a movimentação.')
      return
    }
    setBusy(true)
    try {
      await api.addCashMovement({
        sessionId: session.data.id,
        kind: movementForm.kind,
        category: movementForm.category,
        amountCents: valor,
        description: movementForm.description.trim() || undefined,
        reason: movementForm.reason.trim() || undefined,
        clientUuid: chaveMovimento,
      })
      toast.success(
        `${movementForm.kind === 'in' ? 'Entrada' : 'Saída'} de ${formatMoney(valor)} registrada no turno.`,
      )
      renovarMovimento()
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
      const contado = parseMoneyToCents(closingForm.counted)
      const closed = await api.closeCashSession(
        session.data.id,
        contado,
        closingForm.note.trim() || undefined,
        closingForm.varianceReason.trim() || undefined,
      )
      const diferenca = closed.difference_cents ?? 0
      const esperado = closed.expected_cash_cents ?? session.data.expected_cash_cents
      toast.success(
        diferenca === 0
          ? `Caixa fechado sem divergência (${formatMoney(contado)} conferido).`
          : `Caixa fechado com divergência de ${formatMoney(Math.abs(diferenca))} (${
              diferenca > 0 ? 'sobra' : 'falta'
            }) registrada na auditoria.`,
      )
      // Comprovante do fechamento: útil para assinar e arquivar no balcão.
      api.printReceipt({
        title: 'Fechamento de caixa',
        empresa: empresaDoRecibo(settings.data),
        subtitle: `${session.data.opened_by_name ?? ''} · turno iniciado em ${formatDateTime(session.data.opened_at)}`,
        lines: [
          { label: 'Fundo de troco', value: formatMoney(closed.opening_amount_cents ?? session.data.opening_amount_cents) },
          { label: 'Vendas em dinheiro', value: formatMoney(session.data.cash_sales_cents) },
          { label: 'Saldo esperado', value: formatMoney(esperado), emphasis: true },
          { label: 'Saldo contado', value: formatMoney(contado), emphasis: true },
          {
            label: diferenca === 0 ? 'Divergência' : diferenca > 0 ? 'Sobra' : 'Falta',
            value: formatMoney(Math.abs(diferenca)),
            emphasis: true,
          },
          { label: 'Responsável pelo fechamento', value: profile?.full_name ?? '' },
        ],
        items: [],
        footer: closingForm.varianceReason.trim() ? `Justificativa: ${closingForm.varianceReason.trim()}` : undefined,
      })
      setClosingForm(null)
      await refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  const movementsList = movements.data ?? []
  const totais = useMemo(() => {
    const entradas = movementsList.filter((movement) => movement.kind === 'in').reduce((soma, movement) => soma + movement.amount_cents, 0)
    const saidas = movementsList.filter((movement) => movement.kind === 'out').reduce((soma, movement) => soma + movement.amount_cents, 0)
    const automaticas = movementsList.filter((movement) => movement.source === 'automatic').length
    return { entradas, saidas, automaticas }
  }, [movementsList])

  if (session.isLoading && !session.data) return <LoadingBlock label="Carregando o caixa…" linhas={4} />
  if (session.error) return <ErrorBlock message={translateError(session.error)} onRetry={() => void session.refetch()} />

  // ---------------------------------------------------------------- sem caixa
  if (!session.data) {
    return (
      <div>
        <PageHeader
          titulo="Controle de caixa"
          descricao="Abertura de turno, sangrias, despesas e conferência da gaveta."
        />
        <div className="mx-auto max-w-lg">
          <Card title="Abrir o caixa" icone="cofre" descricao="Só é permitido um turno aberto por vez.">
            <div className="space-y-4">
              <Field
                label="Fundo de troco em dinheiro (R$)"
                hint="Valor físico que já está na gaveta no início do turno."
              >
                <Input
                  value={openingAmount}
                  onChange={(event) => setOpeningAmount(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                />
              </Field>
              <Field label="Observação" hint="Opcional — ex.: turno da noite.">
                <Input
                  value={openingNote}
                  onChange={(event) => setOpeningNote(event.target.value)}
                  placeholder="ex.: turno da noite"
                />
              </Field>
              <Button block size="lg" icone="cofre" loading={busy} onClick={handleOpen}>
                Abrir caixa
              </Button>
              <Callout tom="info">
                Depois de abrir, todos os recebimentos (dinheiro, Pix e cartão) ficam vinculados a este turno. Sem
                caixa aberto, o banco recusa registrar pagamentos.
              </Callout>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  const current = session.data
  const canClose = Boolean(isAdmin || current.opened_by === profile?.id)
  const contadoCents = closingForm ? parseMoneyToCents(closingForm.counted) : 0
  const divergencia = contadoCents - current.expected_cash_cents
  const conferido = closingForm !== null && closingForm.counted.trim() !== ''

  return (
    <div>
      <PageHeader
        titulo="Controle de caixa"
        descricao={`Turno aberto por ${current.opened_by_name ?? '—'} em ${formatDateTime(current.opened_at)}.`}
        selo={<Badge tone="green" ponto>Caixa aberto</Badge>}
        acoes={
          <Button variant="secondary" icone="atualizar" onClick={() => void refresh()} disabled={movements.isFetching}>
            Atualizar
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile rotulo="Fundo de troco" valor={formatMoney(current.opening_amount_cents)} icone="cofre" detalhe="Valor inicial em gaveta" />
        <StatTile rotulo="Vendas em dinheiro" valor={formatMoney(current.cash_sales_cents)} icone="dinheiro" tom="verde" detalhe="Recebimentos em espécie do turno" />
        <StatTile rotulo="Entradas manuais" valor={formatMoney(totais.entradas)} icone="mais" detalhe={`${plural(totais.automaticas, 'lançamento automático', 'lançamentos automáticos')} no total`} />
        <StatTile rotulo="Saídas" valor={formatMoney(totais.saidas)} icone="menos" tom="vermelho" detalhe="Sangrias e despesas" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card
          title="Movimentações do turno"
          descricao="Recebimentos em dinheiro entram automaticamente; o restante é lançado manualmente."
          icone="troca"
          padded={false}
          actions={<Badge tone="slate">{movementsList.length}</Badge>}
        >
          <div className="p-3.5">
            {movements.isLoading ? (
              <LoadingBlock label="Carregando movimentações…" linhas={4} />
            ) : movementsList.length === 0 ? (
              <EmptyState
                icone="troca"
                title="Sem movimentações neste turno"
                description="Recebimentos em dinheiro aparecem aqui automaticamente. Sangrias e despesas você lança ao lado."
              />
            ) : (
              <DataTable
                rows={movementsList}
                rowKey={(row) => row.id}
                maxHeight="52vh"
                columns={[
                  { key: 'when', header: 'Horário', render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>, width: 'w-40' },
                  {
                    key: 'category',
                    header: 'Tipo',
                    render: (row) => (
                      <span className={`flex items-center gap-1.5 font-medium ${row.kind === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>
                        <Icon nome={row.kind === 'in' ? 'seta-cima' : 'seta-baixo'} className="h-3.5 w-3.5" />
                        {CASH_CATEGORY_LABELS[row.category]}
                      </span>
                    ),
                  },
                  {
                    key: 'description',
                    header: 'Descrição',
                    render: (row) => (
                      <span className="text-xs text-ink-600">
                        {row.description ?? '—'}
                        {row.source === 'automatic' && (
                          <span className="ml-1.5">
                            <Badge tone="blue">automático</Badge>
                          </span>
                        )}
                        {row.reason && <span className="block text-[11px] text-ink-500">motivo: {row.reason}</span>}
                      </span>
                    ),
                  },
                  {
                    key: 'amount',
                    header: 'Valor',
                    align: 'right',
                    render: (row) => (
                      <span className={`font-medium ${row.kind === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>
                        {row.kind === 'in' ? '+' : '−'} {formatMoney(row.amount_cents)}
                      </span>
                    ),
                  },
                ]}
                rodape={
                  <>
                    <span>Somente dinheiro físico entra no saldo esperado — Pix e cartão não passam pela gaveta.</span>
                    <span className="num font-medium text-ink-700">
                      Entradas {formatMoney(totais.entradas)} · Saídas {formatMoney(totais.saidas)}
                    </span>
                  </>
                }
              />
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Saldo esperado na gaveta" icone="dinheiro">
            <p className="num text-3xl font-semibold tracking-tight text-brand-700">
              {formatMoney(current.expected_cash_cents)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              Fundo de troco + entradas − saídas + recebimentos em dinheiro. Este é o valor que deve estar fisicamente
              na gaveta agora.
            </p>
          </Card>

          <Card title="Movimentar a gaveta" icone="troca">
            <div className="space-y-2">
              <Button
                block
                variant="secondary"
                icone="mais"
                onClick={() => setMovementForm({ kind: 'in', category: 'change_fund', amount: '', description: '', reason: '' })}
              >
                Entrada de dinheiro
              </Button>
              <Button
                block
                variant="secondary"
                icone="menos"
                onClick={() => setMovementForm({ kind: 'out', category: 'withdrawal', amount: '', description: '', reason: '' })}
              >
                Saída de dinheiro
              </Button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
              Sangrias e despesas exigem motivo — tudo fica na auditoria com autor e horário.
            </p>
          </Card>

          <Card title="Fechar o turno" icone="cadeado" descricao={canClose ? undefined : 'Somente o responsável ou um administrador pode fechar este caixa.'}>
            <Button
              block
              variant="danger"
              icone="cadeado"
              disabled={!canClose}
              onClick={() => setClosingForm({ counted: (current.expected_cash_cents / 100).toFixed(2).replace('.', ','), note: '', varianceReason: '' })}
            >
              Fechar caixa e conferir
            </Button>
          </Card>
        </div>
      </div>

      {/* Nova movimentação */}
      <Modal
        open={Boolean(movementForm)}
        title={movementForm?.kind === 'in' ? 'Registrar entrada de dinheiro' : 'Registrar saída de dinheiro'}
        descricao="A movimentação entra no saldo esperado da gaveta e na auditoria."
        onClose={() => setMovementForm(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMovementForm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              icone="check"
              onClick={handleMovement}
              loading={busy}
              disabled={!movementForm || parseMoneyToCents(movementForm.amount) <= 0}
            >
              Registrar
            </Button>
          </>
        }
      >
        {movementForm && (
          <div className="space-y-4">
            <Field label="Tipo de movimentação" obrigatorio>
              <div className="grid gap-2 sm:grid-cols-2">
                {TIPOS_MOVIMENTO.map((tipo) => {
                  const ativo = movementForm.kind === tipo.kind && movementForm.category === tipo.category
                  return (
                    <button
                      key={`${tipo.kind}-${tipo.category}`}
                      type="button"
                      aria-pressed={ativo}
                      onClick={() => setMovementForm({ ...movementForm, kind: tipo.kind, category: tipo.category })}
                      className={`flex items-center gap-2 rounded-control border px-3 py-2.5 text-left text-[13px] font-medium transition ${
                        ativo
                          ? 'border-brand-600 bg-brand-50 text-brand-800 shadow-sm'
                          : 'border-ink-300 bg-white text-ink-700 hover:border-ink-400'
                      }`}
                    >
                      <Icon nome={tipo.icone} className="h-4 w-4" />
                      {tipo.label}
                    </button>
                  )
                })}
              </div>
            </Field>

            <Field label="Valor (R$)" obrigatorio>
              <Input
                value={movementForm.amount}
                onChange={(event) => setMovementForm({ ...movementForm, amount: event.target.value })}
                inputMode="decimal"
                placeholder="0,00"
                autoFocus
              />
            </Field>

            <Field label="Descrição" hint="Opcional — o que motivou a movimentação.">
              <Input
                value={movementForm.description}
                onChange={(event) => setMovementForm({ ...movementForm, description: event.target.value })}
                placeholder="ex.: compra de gelo"
              />
            </Field>

            <Field
              label="Motivo / justificativa"
              hint="Recomendado para sangrias e despesas: fica gravado na auditoria."
            >
              <Input
                value={movementForm.reason}
                onChange={(event) => setMovementForm({ ...movementForm, reason: event.target.value })}
                placeholder="ex.: retirada para depósito bancário"
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Fechamento */}
      <Modal
        open={Boolean(closingForm)}
        title="Fechar caixa e conferir gaveta"
        descricao="Depois de fechar, o turno não pode mais ser alterado."
        onClose={() => setClosingForm(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setClosingForm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              icone="cadeado"
              onClick={handleClose}
              loading={busy}
              disabled={!conferido || (divergencia !== 0 && closingForm!.varianceReason.trim().length < 3)}
              title={
                !conferido
                  ? 'Informe o valor contado na gaveta'
                  : divergencia !== 0 && closingForm!.varianceReason.trim().length < 3
                    ? 'Explique a divergência para fechar'
                    : undefined
              }
            >
              Confirmar fechamento
            </Button>
          </>
        }
      >
        {closingForm && (
          <div className="space-y-4">
            <div className="rounded-card border border-ink-200 bg-ink-50/60 p-4 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink-500">Saldo esperado (dinheiro)</span>
                <span className="num text-lg font-semibold text-ink-900">
                  {formatMoney(current.expected_cash_cents)}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-ink-200 pt-2">
                <span className="text-ink-500">Valor contado</span>
                <span className="num text-lg font-semibold text-ink-900">{formatMoney(contadoCents)}</span>
              </div>
              <div
                className={`mt-2 flex items-baseline justify-between gap-3 border-t border-ink-200 pt-2 ${
                  divergencia === 0 ? 'text-emerald-700' : 'text-brand-700'
                }`}
              >
                <span className="font-medium">
                  {divergencia === 0 ? 'Sem divergência' : divergencia > 0 ? 'Sobra na gaveta' : 'Falta na gaveta'}
                </span>
                <span className="num font-semibold">{formatMoney(Math.abs(divergencia))}</span>
              </div>
            </div>

            <Field label="Valor contado na gaveta (R$)" obrigatorio hint="Conte o dinheiro físico e digite o total.">
              <Input
                value={closingForm.counted}
                onChange={(event) => setClosingForm({ ...closingForm, counted: event.target.value })}
                inputMode="decimal"
                placeholder="0,00"
                autoFocus
              />
            </Field>

            <Field label="Observação do fechamento" hint="Opcional — ex.: entregue ao responsável do turno seguinte.">
              <Input
                value={closingForm.note}
                onChange={(event) => setClosingForm({ ...closingForm, note: event.target.value })}
              />
            </Field>

            {divergencia !== 0 && (
              <Field
                label="Justificativa da divergência"
                obrigatorio
                hint="Fica gravada na auditoria junto com o valor de sobra ou falta."
              >
                <Input
                  value={closingForm.varianceReason}
                  onChange={(event) => setClosingForm({ ...closingForm, varianceReason: event.target.value })}
                  placeholder="ex.: troco entregue a mais para o cliente da mesa 4"
                />
              </Field>
            )}

            <Callout tom="info">
              Ao confirmar, o sistema imprime um comprovante do fechamento (permite pop-up do navegador) para você
              assinar e arquivar.
            </Callout>
          </div>
        )}
      </Modal>
    </div>
  )
}
