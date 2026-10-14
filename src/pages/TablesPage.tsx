import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useTables } from '../lib/hooks'
import * as api from '../lib/api'
import { Button, ConfirmDialog, ErrorBlock, Field, Input, LoadingBlock, Modal, useToast } from '../components/ui'
import { formatMoney, formatTime, newClientUuid, timeAgo } from '../lib/format'
import { translateError } from '../lib/errors'
import { TABLE_STATUS_LABELS, type TableOverview } from '../lib/types'

const STATUS_STYLES: Record<TableOverview['status'], string> = {
  available: 'border-emerald-200 bg-emerald-50 hover:border-emerald-400',
  occupied: 'border-amber-200 bg-amber-50 hover:border-amber-400',
  awaiting_close: 'border-blue-200 bg-blue-50 hover:border-blue-400',
  attention: 'border-red-200 bg-red-50 hover:border-red-400',
  inactive: 'border-slate-200 bg-slate-100 opacity-60',
}

const STATUS_BADGES: Record<TableOverview['status'], string> = {
  available: 'text-emerald-800 bg-emerald-100',
  occupied: 'text-amber-900 bg-amber-100',
  awaiting_close: 'text-blue-800 bg-blue-100',
  attention: 'text-red-800 bg-red-100',
  inactive: 'text-slate-600 bg-slate-200',
}

export default function TablesPage() {
  const { profile, isAdmin } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tables = useTables()

  const [selected, setSelected] = useState<TableOverview | null>(null)
  const [openForm, setOpenForm] = useState<TableOverview | null>(null)
  const [guestCount, setGuestCount] = useState('2')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [createTableOpen, setCreateTableOpen] = useState(false)
  const [newTableNumber, setNewTableNumber] = useState('')

  const canOpenSession = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'waiter'
  const canCloseAccount = profile?.role === 'admin' || profile?.role === 'manager'

  async function handleOpenSession() {
    if (!openForm) return
    setBusy(true)
    try {
      const session = await api.openTableSession(
        openForm.id,
        guestCount ? Number(guestCount) : null,
        notes.trim() || null,
        newClientUuid(),
      )
      toast.success(`Atendimento aberto na ${openForm.name ?? `mesa ${openForm.number}`}.`)
      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      setOpenForm(null)
      setGuestCount('2')
      setNotes('')
      navigate(`/mesas/${(session as { id: string }).id}`)
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateTable() {
    setBusy(true)
    try {
      const number = Number(newTableNumber)
      if (!number || number <= 0) throw new Error('Informe um número de mesa válido.')
      await api.createTable(number)
      toast.success(`Mesa ${number} criada.`)
      setCreateTableOpen(false)
      setNewTableNumber('')
      await queryClient.invalidateQueries({ queryKey: ['tables'] })
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  if (tables.isLoading && !tables.data) return <LoadingBlock label="Carregando mesas…" />
  if (tables.error) return <ErrorBlock message={translateError(tables.error)} onRetry={() => void tables.refetch()} />

  const list = tables.data ?? []
  const summary = {
    available: list.filter((table) => table.status === 'available').length,
    occupied: list.filter((table) => table.status !== 'available' && table.status !== 'inactive').length,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-800">
            {summary.available} disponíveis
          </span>
          <span className="rounded-md bg-amber-50 px-2.5 py-1 text-amber-900">{summary.occupied} em atendimento</span>
          <span className="text-xs text-slate-500">Atualização automática em tempo real</span>
        </div>
        {isAdmin && (
          <Button variant="secondary" size="sm" onClick={() => setCreateTableOpen(true)}>
            + Nova mesa
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {list.map((table) => (
          <button
            key={table.id}
            onClick={() => setSelected(table)}
            className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition ${STATUS_STYLES[table.status]}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-base font-semibold text-slate-800">
                {table.name ?? `Mesa ${table.number}`}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGES[table.status]}`}>
                {TABLE_STATUS_LABELS[table.status]}
              </span>
            </div>

            {table.status === 'available' || table.status === 'inactive' ? (
              <span className="text-xs text-slate-500">
                {table.is_active ? 'Livre para atendimento' : 'Desativada'} · {table.seats ?? '—'} lugares
              </span>
            ) : (
              <>
                <span className="text-xs text-slate-600">
                  Aberta {formatTime(table.opened_at)} · {timeAgo(table.opened_at)}
                </span>
                <span className="text-xs text-slate-600">
                  {table.open_orders_count} pedido(s) · {table.open_items_count} item(ns)
                </span>
                <span className="text-sm font-semibold text-slate-800">
                  {formatMoney(table.total_cents)}
                  {table.balance_cents > 0 && (
                    <span className="ml-1 text-[11px] font-normal text-slate-600">
                      (falta {formatMoney(table.balance_cents)})
                    </span>
                  )}
                </span>
                {table.opened_by_name && (
                  <span className="text-[11px] text-slate-500">Atendimento: {table.opened_by_name}</span>
                )}
                {table.pending_kitchen_count > 0 && (
                  <span className="text-[11px] font-medium text-amber-700">
                    {table.pending_kitchen_count} pedido(s) na produção
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </div>

      {/* Detalhes da mesa */}
      <Modal
        open={Boolean(selected)}
        title={selected ? `${selected.name ?? `Mesa ${selected.number}`} — detalhes` : ''}
        onClose={() => setSelected(null)}
        size="md"
        footer={
          selected ? (
            <>
              {selected.status === 'available' && canOpenSession && (
                <Button
                  onClick={() => {
                    setOpenForm(selected)
                    setSelected(null)
                  }}
                >
                  Iniciar atendimento
                </Button>
              )}
              {selected.open_session_id && (
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/mesas/${selected.open_session_id}`)}
                >
                  {canCloseAccount ? 'Abrir conta / fechar' : 'Abrir atendimento'}
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Info label="Situação" value={TABLE_STATUS_LABELS[selected.status]} />
              <Info label="Lugares" value={String(selected.seats ?? '—')} />
              {selected.opened_at && <Info label="Aberta em" value={formatTime(selected.opened_at)} />}
              {selected.opened_by_name && <Info label="Responsável" value={selected.opened_by_name} />}
            </div>

            {selected.open_session_id ? (
              <div className="rounded-md border border-slate-200 p-3">
                <div className="flex justify-between">
                  <span className="text-slate-600">Itens lançados</span>
                  <span className="font-medium">{selected.open_items_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="font-medium">{formatMoney(selected.subtotal_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Descontos</span>
                  <span className="font-medium">- {formatMoney(selected.discount_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Total da conta</span>
                  <span className="font-semibold">{formatMoney(selected.total_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Recebido</span>
                  <span className="font-medium">{formatMoney(selected.paid_cents)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                  <span className="text-slate-700">Saldo</span>
                  <span className="font-semibold text-brand-700">{formatMoney(selected.balance_cents)}</span>
                </div>
              </div>
            ) : (
              <p className="text-slate-500">Mesa sem atendimento aberto.</p>
            )}
          </div>
        )}
      </Modal>

      {/* Abrir atendimento */}
      <Modal
        open={Boolean(openForm)}
        title={openForm ? `Iniciar atendimento — ${openForm.name ?? `Mesa ${openForm.number}`}` : ''}
        onClose={() => setOpenForm(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenForm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={handleOpenSession} loading={busy}>
              Abrir mesa
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Número de pessoas (opcional)">
            <Input
              type="number"
              min={1}
              value={guestCount}
              onChange={(event) => setGuestCount(event.target.value)}
            />
          </Field>
          <Field label="Observação (opcional)">
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ex.: aniversário" />
          </Field>
          <p className="text-xs text-slate-500">
            Se outro usuário abrir esta mesa no mesmo instante, o sistema bloqueia a duplicidade automaticamente.
          </p>
        </div>
      </Modal>

      {/* Criar mesa (admin) */}
      <ConfirmDialog
        open={createTableOpen}
        title="Nova mesa"
        confirmLabel="Criar mesa"
        loading={busy}
        onCancel={() => setCreateTableOpen(false)}
        onConfirm={handleCreateTable}
        message={
          <div className="space-y-2">
            <Field label="Número da mesa">
              <Input
                type="number"
                min={1}
                value={newTableNumber}
                onChange={(event) => setNewTableNumber(event.target.value)}
                placeholder="ex.: 13"
              />
            </Field>
            <p className="text-xs text-slate-500">
              Novas mesas ficam disponíveis imediatamente. Mesas com conta aberta não podem ser desativadas.
            </p>
          </div>
        }
      />
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm text-slate-800">{value}</p>
    </div>
  )
}
