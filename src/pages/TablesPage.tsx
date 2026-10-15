import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useTables } from '../lib/hooks'
import * as api from '../lib/api'
import {
  Button,
  Callout,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  SearchInput,
  SegmentedControl,
  StatTile,
  useToast,
} from '../components/ui'
import { Icon } from '../components/icons'
import { duracaoDesde, formatMoney, formatTime, newClientUuid, plural } from '../lib/format'
import { translateError } from '../lib/errors'
import { TABLE_STATUS_LABELS, type TableOverview, type TableStatus } from '../lib/types'

/** Aparência de cada situação da mesa — a cor comunica o estado antes do texto. */
const VISUAL: Record<TableStatus, { faixa: string; ponto: string; rotulo: string }> = {
  available: { faixa: 'bg-emerald-500/70', ponto: 'bg-emerald-500', rotulo: 'text-emerald-700' },
  occupied: { faixa: 'bg-amber-500/80', ponto: 'bg-amber-500', rotulo: 'text-amber-700' },
  awaiting_close: { faixa: 'bg-sky-500/80', ponto: 'bg-sky-500', rotulo: 'text-sky-700' },
  attention: { faixa: 'bg-rose-500', ponto: 'bg-rose-500', rotulo: 'text-rose-700' },
  inactive: { faixa: 'bg-ink-300', ponto: 'bg-ink-400', rotulo: 'text-ink-500' },
}

type Filtro = 'todas' | 'available' | 'ocupadas'

export default function TablesPage() {
  const { profile, isAdmin } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tables = useTables()

  const [selecionada, setSelecionada] = useState<TableOverview | null>(null)
  const [abrirEm, setAbrirEm] = useState<TableOverview | null>(null)
  const [novaMesa, setNovaMesa] = useState(false)
  const [editarMesa, setEditarMesa] = useState<TableOverview | null>(null)
  const [busy, setBusy] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [busca, setBusca] = useState('')
  const [agora, setAgora] = useState(() => Date.now())

  // Mantém os "há X min" das mesas abertas sempre corretos.
  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const canOpenSession = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'waiter'

  const list = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (tables.data ?? []).filter((mesa) => {
      const combinaBusca =
        !termo ||
        String(mesa.number).includes(termo) ||
        (mesa.name ?? '').toLowerCase().includes(termo) ||
        (mesa.opened_by_name ?? '').toLowerCase().includes(termo)
      const combinaFiltro =
        filtro === 'todas'
          ? mesa.status !== 'inactive'
          : filtro === 'available'
            ? mesa.status === 'available'
            : mesa.status !== 'available' && mesa.status !== 'inactive'
      return combinaBusca && combinaFiltro
    })
  }, [tables.data, busca, filtro, agora])

  const resumo = useMemo(() => {
    const todas = tables.data ?? []
    const emUso = todas.filter((m) => m.status === 'occupied' || m.status === 'awaiting_close' || m.status === 'attention')
    return {
      livres: todas.filter((m) => m.status === 'available').length,
      emUso: emUso.length,
      atendimento: emUso.reduce((soma, m) => soma + m.total_cents, 0),
      pendentes: emUso.reduce((soma, m) => soma + m.balance_cents, 0),
      inativas: todas.filter((m) => m.status === 'inactive').length,
    }
  }, [tables.data])

  async function confirmarAbertura(dados: { pessoas: string; observacao: string }) {
    if (!abrirEm) return
    setBusy(true)
    try {
      const sessao = await api.openTableSession(
        abrirEm.id,
        dados.pessoas ? Number(dados.pessoas) : null,
        dados.observacao.trim() || null,
        newClientUuid(),
      )
      toast.success(`Atendimento aberto na ${abrirEm.name ?? `mesa ${abrirEm.number}`}.`)
      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      setAbrirEm(null)
      navigate(`/mesas/${(sessao as { id: string }).id}`)
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Mesas"
        descricao="Situação do salão em tempo real. Toque em uma mesa para atender ou ver a conta."
        acoes={
          <>
            <IconButton
              nome="atualizar"
              titulo="Atualizar agora"
              variant="secondary"
              onClick={() => void tables.refetch()}
              disabled={tables.isFetching}
            />
            {isAdmin && (
              <Button variant="secondary" icone="mais" onClick={() => setNovaMesa(true)}>
                Nova mesa
              </Button>
            )}
          </>
        }
      />

      {tables.isLoading && !tables.data ? (
        <div className="superficie p-5">
          <LoadingBlock label="Carregando mesas…" linhas={5} />
        </div>
      ) : tables.error ? (
        <ErrorBlock message={translateError(tables.error)} onRetry={() => void tables.refetch()} />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              rotulo="Mesas livres"
              valor={resumo.livres}
              icone="check"
              tom="verde"
              detalhe="Prontas para receber clientes"
            />
            <StatTile
              rotulo="Em atendimento"
              valor={resumo.emUso}
              icone="mesas"
              tom="ambar"
              detalhe="Com conta aberta agora"
            />
            <StatTile
              rotulo="Consumido no salão"
              valor={formatMoney(resumo.atendimento)}
              icone="dinheiro"
              tom="marca"
              detalhe="Soma das contas abertas"
            />
            <StatTile
              rotulo="A receber"
              valor={formatMoney(resumo.pendentes)}
              icone="relogio"
              detalhe="Saldo das contas abertas"
            />
          </div>

          <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedControl<Filtro>
              valor={filtro}
              onChange={setFiltro}
              opcoes={[
                { valor: 'todas', rotulo: 'Todas', icone: 'lista' },
                { valor: 'available', rotulo: 'Livres', icone: 'check' },
                { valor: 'ocupadas', rotulo: 'Ocupadas', icone: 'mesas' },
              ]}
            />
            <SearchInput
              value={busca}
              onValueChange={setBusca}
              placeholder="Buscar por mesa, número ou responsável…"
              className="sm:w-80"
            />
          </div>

          {list.length === 0 ? (
            <EmptyState
              icone="mesas"
              title={busca ? 'Nenhuma mesa encontrada' : 'Nenhuma mesa neste filtro'}
              description={
                busca
                  ? 'Confira o número digitado ou limpe a busca.'
                  : 'Troque o filtro acima para ver as mesas em outra situação.'
              }
              action={
                busca ? (
                  <Button variant="secondary" onClick={() => setBusca('')}>
                    Limpar busca
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((mesa) => {
                const visual = VISUAL[mesa.status]
                const livre = mesa.status === 'available'
                const minutos = mesa.opened_at ? Math.floor((agora - new Date(mesa.opened_at).getTime()) / 60000) : 0
                return (
                  <button
                    key={mesa.id}
                    onClick={() => (livre ? setAbrirEm(mesa) : setSelecionada(mesa))}
                    className={`grade-navegavel group relative flex flex-col overflow-hidden rounded-card border border-ink-200 bg-white text-left shadow-card transition
                      duration-200 ease-smooth hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-raised ${
                        mesa.status === 'inactive' ? 'opacity-70' : ''
                      }`}
                  >
                    <span className={`h-[3px] w-full ${visual.faixa}`} />
                    <div className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-2">
                      <div className="min-w-0">
                        <p className="truncate text-[16px] font-semibold tracking-[-0.01em] text-ink-900">
                          {mesa.name ?? `Mesa ${mesa.number}`}
                        </p>
                        <p className="text-[12px] text-ink-500">
                          {mesa.seats ? `${mesa.seats} lugares` : 'Sem lugares definidos'}
                        </p>
                      </div>
                      <span className={`flex items-center gap-1.5 whitespace-nowrap text-micro font-semibold uppercase tracking-[0.05em] ${visual.rotulo}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${visual.ponto}`} />
                        {TABLE_STATUS_LABELS[mesa.status]}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col gap-1.5 px-4 pb-4">
                      {livre ? (
                        <p className="flex items-center gap-1.5 text-pequeno font-medium text-emerald-700">
                          <Icon nome="mais" className="h-4 w-4" />
                          Iniciar atendimento
                        </p>
                      ) : mesa.status === 'inactive' ? (
                        <p className="text-pequeno text-ink-500">Mesa desativada — fora de uso.</p>
                      ) : (
                        <>
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-600">
                            <span className="inline-flex items-center gap-1">
                              <Icon nome="relogio" className="h-3.5 w-3.5 text-ink-400" />
                              {duracaoDesde(mesa.opened_at, agora)}
                            </span>
                            <span className="text-ink-300">·</span>
                            <span>
                              desde {formatTime(mesa.opened_at)}
                              {minutos >= 90 && <span className="ml-1 font-medium text-amber-700">(atenção)</span>}
                            </span>
                          </p>
                          <p className="text-[12px] text-ink-600">
                            {mesa.open_orders_count} pedido{mesa.open_orders_count === 1 ? '' : 's'} ·{' '}
                            {mesa.open_items_count} item{mesa.open_items_count === 1 ? '' : 's'}
                            {mesa.guest_count ? ` · ${mesa.guest_count} pessoa${mesa.guest_count === 1 ? '' : 's'}` : ''}
                          </p>
                          <p className="num mt-auto pt-2 text-lg font-semibold text-ink-900">
                            {formatMoney(mesa.total_cents)}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            {mesa.balance_cents > 0 ? (
                              <span className="font-medium text-brand-700">
                                falta {formatMoney(mesa.balance_cents)}
                              </span>
                            ) : (
                              <span className="font-medium text-emerald-700">conta paga</span>
                            )}
                            {mesa.pending_kitchen_count > 0 && (
                              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                                <Icon nome="alerta" className="h-3.5 w-3.5" />
                                {mesa.pending_kitchen_count} na produção
                              </span>
                            )}
                          </div>
                          {mesa.opened_by_name && (
                            <p className="truncate text-[11px] text-ink-500">Atendimento: {mesa.opened_by_name}</p>
                          )}
                        </>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {isAdmin && resumo.inativas > 0 && filtro !== 'todas' && (
            <p className="mt-4 text-xs text-ink-500">
              {plural(resumo.inativas, 'mesa desativada não aparece', 'mesas desativadas não aparecem')} nos filtros atuais.
            </p>
          )}
        </>
      )}

      <DetalhesMesa
        mesa={selecionada}
        onClose={() => setSelecionada(null)}
        onEditar={(mesa) => {
          setSelecionada(null)
          setEditarMesa(mesa)
        }}
        isAdmin={isAdmin}
      />

      <AbrirAtendimento
        mesa={abrirEm}
        busy={busy}
        podeAbrir={canOpenSession}
        onClose={() => setAbrirEm(null)}
        onConfirmar={confirmarAbertura}
      />

      <NovaMesa
        aberto={novaMesa}
        onClose={() => setNovaMesa(false)}
        onCriada={() => void queryClient.invalidateQueries({ queryKey: ['tables'] })}
      />

      <EditarMesa
        mesa={editarMesa}
        onClose={() => setEditarMesa(null)}
        onSalvo={() => void queryClient.invalidateQueries({ queryKey: ['tables'] })}
        onSucesso={(mensagem) => toast.success(mensagem)}
        onErro={(mensagem) => toast.error(mensagem)}
      />
    </div>
  )
}

// ===========================================================================
// DETALHES DA MESA
// ===========================================================================
function DetalhesMesa({
  mesa,
  onClose,
  onEditar,
  isAdmin,
}: {
  mesa: TableOverview | null
  onClose: () => void
  onEditar: (mesa: TableOverview) => void
  isAdmin: boolean
}) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  if (!mesa) return null

  const podeFechar = profile?.role === 'admin' || profile?.role === 'manager'
  const temConta = Boolean(mesa.open_session_id)

  return (
    <Modal
      open
      title={mesa.name ?? `Mesa ${mesa.number}`}
      descricao={`${TABLE_STATUS_LABELS[mesa.status]}${mesa.seats ? ` · ${mesa.seats} lugares` : ''}`}
      onClose={onClose}
      size="md"
      footer={
        <>
          {isAdmin && (
            <Button variant="ghost" icone="config" onClick={() => onEditar(mesa)}>
              Configurar mesa
            </Button>
          )}
          {temConta && (
            <Button icone="seta-direita" onClick={() => navigate(`/mesas/${mesa.open_session_id}`)}>
              {podeFechar ? 'Abrir conta e receber' : 'Abrir atendimento'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {temConta && (
          <div className="rounded-card border border-ink-200 bg-ink-50/60 p-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="rotulo">Aberta</p>
                <p className="mt-0.5 font-medium text-ink-800">
                  {formatTime(mesa.opened_at)} · {duracaoDesde(mesa.opened_at)}
                </p>
              </div>
              <div>
                <p className="rotulo">Responsável</p>
                <p className="mt-0.5 font-medium text-ink-800">{mesa.opened_by_name ?? '—'}</p>
              </div>
              <div>
                <p className="rotulo">Pedidos / itens</p>
                <p className="mt-0.5 font-medium text-ink-800">
                  {mesa.open_orders_count} / {mesa.open_items_count}
                </p>
              </div>
              <div>
                <p className="rotulo">Pessoas</p>
                <p className="mt-0.5 font-medium text-ink-800">{mesa.guest_count ?? '—'}</p>
              </div>
            </div>

            <div className="mt-4 space-y-1.5 border-t border-ink-200 pt-3 text-sm">
              <Linha rotulo="Subtotal" valor={formatMoney(mesa.subtotal_cents)} />
              {mesa.discount_cents > 0 && (
                <Linha rotulo="Descontos" valor={`- ${formatMoney(mesa.discount_cents)}`} />
              )}
              <Linha rotulo="Total da conta" valor={formatMoney(mesa.total_cents)} destaque />
              {mesa.paid_cents > 0 && <Linha rotulo="Já recebido" valor={formatMoney(mesa.paid_cents)} />}
              <Linha
                rotulo={mesa.balance_cents > 0 ? 'Falta receber' : 'Conta quitada'}
                valor={formatMoney(mesa.balance_cents)}
                cor={mesa.balance_cents > 0 ? 'text-brand-700' : 'text-emerald-700'}
              />
            </div>
          </div>
        )}

        {mesa.pending_kitchen_count > 0 && (
          <Callout tom="atencao" titulo={`${plural(mesa.pending_kitchen_count, 'pedido', 'pedidos')} em produção`}>
            Há itens ainda não entregues nesta mesa. Combine a entrega antes de fechar a conta.
          </Callout>
        )}

        {!temConta && mesa.status === 'available' && (
          <p className="text-sm text-ink-600">
            Mesa livre. Use “Iniciar atendimento” na grade para abrir a conta e lançar o primeiro pedido.
          </p>
        )}

        {mesa.status === 'inactive' && (
          <Callout tom="info" titulo="Mesa desativada">
            Ela não recebe atendimentos enquanto estiver desativada. Reative em “Configurar mesa”.
          </Callout>
        )}
      </div>
    </Modal>
  )
}

function Linha({
  rotulo,
  valor,
  destaque,
  cor = 'text-ink-800',
}: {
  rotulo: string
  valor: string
  destaque?: boolean
  cor?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={destaque ? 'font-medium text-ink-700' : 'text-ink-500'}>{rotulo}</span>
      <span className={`num ${destaque ? 'text-base font-semibold' : 'font-medium'} ${cor}`}>{valor}</span>
    </div>
  )
}

// ===========================================================================
// ABRIR ATENDIMENTO
// ===========================================================================
function AbrirAtendimento({
  mesa,
  busy,
  podeAbrir,
  onClose,
  onConfirmar,
}: {
  mesa: TableOverview | null
  busy: boolean
  podeAbrir: boolean
  onClose: () => void
  onConfirmar: (dados: { pessoas: string; observacao: string }) => void
}) {
  const [pessoas, setPessoas] = useState('2')
  const [observacao, setObservacao] = useState('')

  useEffect(() => {
    if (mesa) {
      setPessoas(String(mesa.seats && mesa.seats > 0 ? Math.min(mesa.seats, 2) : 2))
      setObservacao('')
    }
  }, [mesa])

  if (!mesa) return null

  return (
    <Modal
      open
      title={`Iniciar atendimento — ${mesa.name ?? `Mesa ${mesa.number}`}`}
      descricao="Abra a conta para começar a lançar pedidos."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button icone="check" onClick={() => onConfirmar({ pessoas, observacao })} loading={busy} disabled={!podeAbrir}>
            Abrir mesa
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Quantas pessoas" hint="Opcional — ajuda a organizar o salão.">
          <Input
            type="number"
            min={1}
            max={99}
            inputMode="numeric"
            value={pessoas}
            onChange={(event) => setPessoas(event.target.value)}
          />
        </Field>
        <Field label="Observação" hint="Ex.: aniversário, cliente com restrição alimentar.">
          <Input
            value={observacao}
            onChange={(event) => setObservacao(event.target.value)}
            placeholder="ex.: aniversário"
          />
        </Field>
        <Callout tom="info">
          Se outro usuário abrir esta mesa no mesmo instante, o sistema garante que só uma conta seja criada.
        </Callout>
      </div>
    </Modal>
  )
}

// ===========================================================================
// NOVA MESA (admin)
// ===========================================================================
function NovaMesa({
  aberto,
  onClose,
  onCriada,
}: {
  aberto: boolean
  onClose: () => void
  onCriada: () => void
}) {
  const toast = useToast()
  const [numero, setNumero] = useState('')
  const [nome, setNome] = useState('')
  const [lugares, setLugares] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (aberto) {
      setNumero('')
      setNome('')
      setLugares('')
    }
  }, [aberto])

  async function criar() {
    const numeroNumero = Number(numero)
    if (!numeroNumero || numeroNumero <= 0) {
      toast.error('Informe um número de mesa válido (maior que zero).')
      return
    }
    setBusy(true)
    try {
      await api.createTable(
        numeroNumero,
        nome.trim() || null,
        lugares ? Number(lugares) : null,
      )
      toast.success(`Mesa ${numeroNumero} criada.`)
      onCriada()
      onClose()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  if (!aberto) return null

  return (
    <Modal
      open
      title="Nova mesa"
      descricao="Cadastre a mesa do salão. Ela fica disponível imediatamente."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button icone="mais" onClick={criar} loading={busy}>
            Criar mesa
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Número da mesa" obrigatorio>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={numero}
            onChange={(event) => setNumero(event.target.value)}
            placeholder="ex.: 13"
            autoFocus
          />
        </Field>
        <Field label="Nome de exibição" hint="Opcional. Ex.: “Varanda 1”.">
          <Input value={nome} onChange={(event) => setNome(event.target.value)} placeholder={`Mesa ${numero || '13'}`} />
        </Field>
        <Field label="Lugares" hint="Opcional.">
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={lugares}
            onChange={(event) => setLugares(event.target.value)}
            placeholder="ex.: 4"
          />
        </Field>
      </div>
    </Modal>
  )
}

// ===========================================================================
// CONFIGURAR MESA (admin) — renomear, lugares e ativar/desativar
// ===========================================================================
function EditarMesa({
  mesa,
  onClose,
  onSalvo,
  onSucesso,
  onErro,
}: {
  mesa: TableOverview | null
  onClose: () => void
  onSalvo: () => void
  onSucesso: (mensagem: string) => void
  onErro: (mensagem: string) => void
}) {
  const [nome, setNome] = useState('')
  const [lugares, setLugares] = useState('')
  const [ativa, setAtiva] = useState(true)
  const [desativarAberto, setDesativarAberto] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mesa) {
      setNome(mesa.name ?? '')
      setLugares(mesa.seats ? String(mesa.seats) : '')
      setAtiva(mesa.is_active)
    }
  }, [mesa])

  if (!mesa) return null

  const temContaAberta = Boolean(mesa.open_session_id)

  async function salvar() {
    setBusy(true)
    try {
      await api.updateTable(mesa!.id, {
        name: nome.trim() || `Mesa ${mesa!.number}`,
        seats: lugares ? Number(lugares) : null,
      })
      onSucesso('Mesa atualizada.')
      onSalvo()
      onClose()
    } catch (error) {
      onErro(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function alternarAtiva() {
    setDesativarAberto(false)
    setBusy(true)
    try {
      await api.updateTable(mesa!.id, { is_active: !mesa!.is_active })
      onSucesso(mesa!.is_active ? 'Mesa desativada.' : 'Mesa reativada.')
      onSalvo()
      onClose()
    } catch (error) {
      onErro(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open
        title={`Configurar ${mesa.name ?? `mesa ${mesa.number}`}`}
        descricao="Dados do salão. Nada disso altera contas já abertas."
        onClose={onClose}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button icone="check" onClick={salvar} loading={busy}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Número" hint="O número da mesa não muda (evita confusão no salão).">
            <Input value={`Mesa ${mesa.number}`} disabled />
          </Field>
          <Field label="Nome de exibição">
            <Input value={nome} onChange={(event) => setNome(event.target.value)} />
          </Field>
          <Field label="Lugares">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={lugares}
              onChange={(event) => setLugares(event.target.value)}
            />
          </Field>

          <div className="rounded-card border border-ink-200 bg-ink-50/60 p-3.5">
            <Checkbox
              label={ativa ? 'Mesa ativa no salão' : 'Mesa desativada'}
              hint={
                temContaAberta
                  ? 'Esta mesa tem conta aberta: finalize o atendimento antes de desativá-la.'
                  : 'Mesas desativadas não aparecem para o garçom no dia a dia.'
              }
              checked={ativa}
              disabled={temContaAberta}
              onChange={(valor) => {
                if (!valor) {
                  setDesativarAberto(true)
                  return
                }
                setAtiva(true)
              }}
            />
            {temContaAberta && (
              <p className="mt-2 text-xs font-medium text-amber-700">
                Conta aberta nesta mesa — a desativação fica bloqueada pelo sistema.
              </p>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={desativarAberto}
        title="Desativar esta mesa?"
        message={`A ${mesa.name ?? `mesa ${mesa.number}`} sai da grade do salão até ser reativada aqui. O histórico de atendimentos continua guardado.`}
        confirmLabel="Desativar mesa"
        tone="danger"
        loading={busy}
        onConfirm={alternarAtiva}
        onCancel={() => setDesativarAberto(false)}
      />
    </>
  )
}
