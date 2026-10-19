import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useProfiles } from '../lib/hooks'
import * as api from '../lib/api'
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatTile,
  useToast,
} from '../components/ui'
import { Icon } from '../components/icons'
import { formatDateTime, formatPhone } from '../lib/format'
import { translateError } from '../lib/errors'
import { ROLE_LABELS, type Profile, type Role } from '../lib/types'

/**
 * Funcionários: criar, ativar/desativar, trocar função e redefinir senha.
 *
 * A CRIAÇÃO e a REDEFINIÇÃO DE SENHA passam pela Edge Function
 * `admin-create-employee` (server-side, com service_role). Nenhuma credencial
 * privilegiada existe no navegador.
 */
export default function EmployeesPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { profile: me } = useAuth()
  const profiles = useProfiles(true)

  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [form, setForm] = useState<null | {
    full_name: string
    login: string
    role: Role
    password: string
    phone: string
    activate: boolean
  }>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'toggle_active' | 'reset_password'; profile: Profile }>(null)
  const [trocaFuncao, setTrocaFuncao] = useState<null | { profile: Profile; role: Role }>(null)
  const [tempPassword, setTempPassword] = useState<{ login: string; password: string } | null>(null)
  const [busca, setBusca] = useState('')

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['profiles'] })

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (profiles.data ?? []).filter((row) =>
      termo ? row.full_name.toLowerCase().includes(termo) || row.login.toLowerCase().includes(termo) : true,
    )
  }, [profiles.data, busca])

  const resumo = useMemo(() => {
    const todos = profiles.data ?? []
    return {
      total: todos.length,
      ativos: todos.filter((row) => row.is_active).length,
      admins: todos.filter((row) => row.role === 'admin' && row.is_active).length,
      pendentesSenha: todos.filter((row) => row.must_change_password).length,
    }
  }, [profiles.data])

  async function handleCreate() {
    if (!form) return
    if (!form.full_name.trim() || form.full_name.trim().length < 2) {
      toast.error('Informe o nome completo do funcionário.')
      return
    }
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(form.login.trim().toLowerCase())) {
      toast.error('O login deve ter de 3 a 40 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.')
      return
    }
    if (form.password.length < 8) {
      toast.error('A senha inicial deve ter ao menos 8 caracteres.')
      return
    }

    setBusy(true)
    try {
      await api.createEmployee({
        full_name: form.full_name.trim(),
        login: form.login.trim().toLowerCase(),
        role: form.role,
        password: form.password,
        phone: form.phone.trim() || undefined,
        activate: form.activate,
      })
      toast.success(
        form.activate
          ? 'Funcionário criado e ativado. Oriente-o a trocar a senha no primeiro acesso.'
          : 'Funcionário criado. Ative o acesso quando quiser liberar o login.',
      )
      setForm(null)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(target: Profile) {
    setBusy(true)
    try {
      await api.updateProfile(target.id, { is_active: !target.is_active })
      toast.success(
        target.is_active
          ? `Acesso de ${target.full_name} desativado. O histórico de vendas dele continua intacto.`
          : `Acesso de ${target.full_name} liberado.`,
      )
      setConfirm(null)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function salvarFuncao() {
    if (!trocaFuncao) return
    setBusy(true)
    try {
      await api.updateProfile(trocaFuncao.profile.id, { role: trocaFuncao.role })
      toast.success(`Função de ${trocaFuncao.profile.full_name} alterada para ${ROLE_LABELS[trocaFuncao.role]}.`)
      setTrocaFuncao(null)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword(target: Profile) {
    setBusy(true)
    try {
      const result = await api.resetEmployeePassword(target.login)
      setConfirm(null)
      setTempPassword({ login: target.login, password: result.temp_password ?? '(ver resposta do servidor)' })
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function copiarSenha() {
    if (!tempPassword) return
    try {
      await navigator.clipboard.writeText(tempPassword.password)
      toast.success('Senha copiada — cole no canal combinado com o funcionário.')
    } catch {
      toast.error('O navegador não permitiu copiar automaticamente. Selecione a senha e copie manualmente.')
    }
  }

  if (profiles.isLoading && !profiles.data) return <LoadingBlock label="Carregando funcionários…" linhas={5} />
  if (profiles.error) return <ErrorBlock message={translateError(profiles.error)} onRetry={() => void profiles.refetch()} />

  return (
    <div>
      <PageHeader
        titulo="Funcionários"
        descricao="Equipe com acesso ao sistema: caixa, garçom e administrador. Contas com histórico nunca são apagadas."
        acoes={
          <>
            <IconButton
              nome="atualizar"
              titulo="Atualizar lista"
              variant="secondary"
              onClick={() => void profiles.refetch()}
              disabled={profiles.isFetching}
            />
            <Button
              icone="mais"
              onClick={() => {
                setMostrarSenha(false)
                setForm({ full_name: '', login: '', role: 'waiter', password: '', phone: '', activate: true })
              }}
            >
              Novo funcionário
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile rotulo="Equipe" valor={resumo.total} icone="equipe" detalhe="contas cadastradas" />
        <StatTile rotulo="Com acesso ativo" valor={resumo.ativos} icone="check" tom="verde" detalhe="podem entrar agora" />
        <StatTile rotulo="Administradores" valor={resumo.admins} icone="auditoria" tom="marca" detalhe="acesso total ao sistema" />
        <StatTile
          rotulo="Troca de senha pendente"
          valor={resumo.pendentesSenha}
          icone="cadeado"
          tom={resumo.pendentesSenha > 0 ? 'ambar' : 'neutro'}
          detalhe="senhas temporárias ainda em uso"
        />
      </div>

      <Card
        icone="equipe"
        title={`Equipe${busca ? ` — filtrada (${lista.length})` : ''}`}
        descricao="Nunca apague um funcionário: desative o acesso para preservar o histórico e a auditoria."
        padded={false}
        actions={<div className="w-full sm:w-72"><SearchInput value={busca} onValueChange={setBusca} placeholder="Buscar por nome ou login…" /></div>}
      >
        <ul className="divide-y divide-ink-100">
          {lista.length === 0 && (
            <li className="p-5 text-center text-sm text-ink-500">Nenhum funcionário encontrado com esta busca.</li>
          )}
          {lista.map((row) => {
            const ehVoce = row.id === me?.id
            const iniciais = row.full_name
              .split(' ')
              .filter(Boolean)
              .slice(0, 2)
              .map((parte) => parte[0]?.toUpperCase())
              .join('')
            return (
              <li key={row.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      row.is_active ? 'bg-brand-100 text-brand-700' : 'bg-ink-200 text-ink-500'
                    }`}
                    aria-hidden
                  >
                    {iniciais || <Icon nome="usuario" className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
                      {row.full_name}
                      {ehVoce && <Badge tone="blue">você</Badge>}
                      {!row.is_active && <Badge tone="slate">acesso desativado</Badge>}
                      {row.must_change_password && <Badge tone="amber">troca de senha pendente</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      login: <span className="font-medium text-ink-600">{row.login}</span>
                      {row.phone ? ` · ${formatPhone(row.phone)}` : ''}
                    </p>
                    <p className="text-xs text-ink-500">
                      Último acesso: {row.last_login_at ? formatDateTime(row.last_login_at) : 'nunca acessou'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.role === 'admin' ? 'brand' : row.role === 'manager' ? 'blue' : 'slate'}>
                    {ROLE_LABELS[row.role]}
                  </Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    icone="troca"
                    disabled={ehVoce}
                    title={ehVoce ? 'Você não pode alterar a própria função' : undefined}
                    onClick={() => setTrocaFuncao({ profile: row, role: row.role })}
                  >
                    Função
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icone="cadeado"
                    onClick={() => setConfirm({ kind: 'reset_password', profile: row })}
                  >
                    Senha
                  </Button>
                  <Button
                    size="sm"
                    variant={row.is_active ? 'ghost' : 'success'}
                    className={row.is_active ? 'text-red-600 hover:bg-red-50' : ''}
                    icone={row.is_active ? 'cadeado' : 'check'}
                    disabled={ehVoce}
                    title={ehVoce ? 'Você não pode desativar o próprio acesso' : undefined}
                    onClick={() => setConfirm({ kind: 'toggle_active', profile: row })}
                  >
                    {row.is_active ? 'Desativar' : 'Ativar'}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="border-t border-ink-100 bg-ink-50/60 p-4">
          <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-500">
            <li>Funcionários nunca são apagados: o histórico de vendas e a auditoria apontam para eles.</li>
            <li>Você não pode alterar a própria função nem desativar o próprio acesso (proteção do banco).</li>
            <li>O último administrador ativo não pode ser rebaixado nem desativado.</li>
            <li>
              A criação do usuário usa a Edge Function com <span className="font-medium">service_role</span> no
              servidor — o navegador nunca vê essa chave.
            </li>
          </ul>
        </div>
      </Card>

      {/* Novo funcionário */}
      <Modal
        open={Boolean(form)}
        title="Novo funcionário"
        descricao="O login substitui o e-mail: o sistema completa o domínio interno automaticamente."
        onClose={() => setForm(null)}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button icone="check" onClick={handleCreate} loading={busy}>
              Criar funcionário
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome completo" obrigatorio>
              <Input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} autoFocus />
            </Field>
            <Field label="Login" obrigatorio hint="3 a 40 caracteres: letras minúsculas, números, ponto, hífen ou _.">
              <Input
                value={form.login}
                onChange={(event) => setForm({ ...form, login: event.target.value.toLowerCase() })}
                placeholder="nome.sobrenome"
              />
            </Field>
            <Field label="Função" obrigatorio hint={DESCRICAO_FUNCAO[form.role]}>
              <Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
                <option value="waiter">Garçom</option>
                <option value="manager">Caixa</option>
                <option value="admin">Administrador</option>
              </Select>
            </Field>
            <Field label="Telefone">
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="(86) 99999-0000"
                inputMode="tel"
              />
            </Field>
            <Field label="Senha inicial" obrigatorio hint="Mínimo de 8 caracteres. Entregue por canal seguro.">
              <div className="flex items-center gap-2">
                <Input
                  type={mostrarSenha ? 'text' : 'password'}
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <IconButton
                  nome={mostrarSenha ? 'olho-fechado' : 'olho'}
                  titulo={mostrarSenha ? 'Ocultar a senha' : 'Mostrar a senha'}
                  variant="secondary"
                  onClick={() => setMostrarSenha((atual) => !atual)}
                />
              </div>
            </Field>
            <Field label="Situação do acesso" hint="Desativado, o funcionário não consegue entrar até você liberar.">
              <Select
                value={form.activate ? 'sim' : 'nao'}
                onChange={(event) => setForm({ ...form, activate: event.target.value === 'sim' })}
              >
                <option value="sim">Ativar imediatamente</option>
                <option value="nao">Criar desativado</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Callout tom="info">
                O funcionário entra com o <strong>login</strong> (sem e-mail) e é obrigado a trocar a senha no primeiro
                acesso.
              </Callout>
            </div>
          </div>
        )}
      </Modal>

      {/* Alteração de função */}
      <Modal
        open={Boolean(trocaFuncao)}
        title={`Alterar função — ${trocaFuncao?.profile.full_name ?? ''}`}
        descricao="A função define o que a pessoa pode fazer dentro do sistema."
        onClose={() => setTrocaFuncao(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTrocaFuncao(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              icone="check"
              onClick={salvarFuncao}
              loading={busy}
              disabled={!trocaFuncao || trocaFuncao.role === trocaFuncao.profile.role}
            >
              Salvar função
            </Button>
          </>
        }
      >
        {trocaFuncao && (
          <div className="space-y-4">
            <Field label="Nova função" obrigatorio>
              <Select
                value={trocaFuncao.role}
                onChange={(event) => setTrocaFuncao({ ...trocaFuncao, role: event.target.value as Role })}
              >
                <option value="waiter">Garçom</option>
                <option value="manager">Caixa</option>
                <option value="admin">Administrador</option>
              </Select>
            </Field>
            <Callout tom="info">{DESCRICAO_FUNCAO[trocaFuncao.role]}</Callout>
            <p className="text-xs text-ink-500">
              Hoje esta pessoa é <strong>{ROLE_LABELS[trocaFuncao.profile.role]}</strong>. A mudança vale no próximo
              carregamento das telas dela e fica registrada no banco.
            </p>
          </div>
        )}
      </Modal>

      {/* Senha temporária */}
      <Modal
        open={Boolean(tempPassword)}
        title="Senha temporária gerada"
        descricao="Anote e entregue agora: a senha não fica visível depois de fechar esta janela."
        onClose={() => setTempPassword(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTempPassword(null)}>
              Fechar
            </Button>
            <Button icone="lista" onClick={copiarSenha}>
              Copiar senha
            </Button>
          </>
        }
      >
        {tempPassword && (
          <div className="space-y-4 text-sm text-ink-700">
            <p>
              Nova senha de <strong>{tempPassword.login}</strong>:
            </p>
            <p className="num rounded-control border border-ink-300 bg-ink-50 px-3 py-2.5 text-center font-mono text-lg tracking-wide">
              {tempPassword.password}
            </p>
            <Callout tom="atencao" titulo="Entrega segura">
              Não há envio automático por e-mail ou WhatsApp nesta versão. Combine um canal seguro com o funcionário e
              oriente a troca no primeiro acesso.
            </Callout>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm?.kind === 'reset_password'
            ? 'Redefinir senha'
            : confirm?.profile?.is_active
              ? 'Desativar acesso'
              : 'Ativar acesso'
        }
        confirmLabel={confirm?.kind === 'reset_password' ? 'Gerar senha temporária' : 'Confirmar'}
        tone={confirm?.kind === 'reset_password' ? 'primary' : confirm?.profile?.is_active ? 'danger' : 'success'}
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return
          if (confirm.kind === 'reset_password') void resetPassword(confirm.profile)
          else void toggleActive(confirm.profile)
        }}
        message={
          !confirm ? null : confirm.kind === 'reset_password' ? (
            <p>
              Uma senha temporária aleatória será gerada para <strong>{confirm.profile.full_name}</strong> e o acesso
              dele exigirá troca de senha no próximo login. A operação é registrada na auditoria.
            </p>
          ) : confirm.profile.is_active ? (
            <p>
              <strong>{confirm.profile.full_name}</strong> não conseguirá mais entrar no sistema. O histórico de vendas
              e auditoria permanece intacto — nada é apagado.
            </p>
          ) : (
            <p>
              Liberar o acesso de <strong>{confirm.profile.full_name}</strong> imediatamente?
            </p>
          )
        }
      />
    </div>
  )
}

const DESCRICAO_FUNCAO: Record<Role, string> = {
  waiter: 'Garçom — abre mesas, lança pedidos e confirma a entrega. Não recebe pagamentos nem fecha contas.',
  manager: 'Caixa — conduz a produção, registra recebimentos, abre e fecha o caixa e acompanha o delivery.',
  admin: 'Administrador — acesso total, incluindo cardápio, equipe, relatórios, configurações e auditoria.',
}
