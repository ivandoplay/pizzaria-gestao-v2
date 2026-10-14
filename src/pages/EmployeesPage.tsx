import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useProfiles } from '../lib/hooks'
import * as api from '../lib/api'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Select,
  useToast,
} from '../components/ui'
import { formatDateTime } from '../lib/format'
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
  const [tempPassword, setTempPassword] = useState<{ login: string; password: string } | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['profiles'] })

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
      toast.success(target.is_active ? 'Acesso desativado.' : 'Acesso ativado.')
      setConfirm(null)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(target: Profile, role: Role) {
    try {
      await api.updateProfile(target.id, { role })
      toast.success(`Função alterada para ${ROLE_LABELS[role]}.`)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
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

  if (profiles.isLoading) return <LoadingBlock label="Carregando funcionários…" />
  if (profiles.error) return <ErrorBlock message={translateError(profiles.error)} onRetry={() => void profiles.refetch()} />

  const list = profiles.data ?? []

  return (
    <div className="space-y-4">
      <Card
        title={`Funcionários (${list.length})`}
        actions={
          <Button
            size="sm"
            onClick={() => setForm({ full_name: '', login: '', role: 'waiter', password: '', phone: '', activate: true })}
          >
            + Novo funcionário
          </Button>
        }
      >
        <DataTable
          rows={list}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'name',
              header: 'Nome',
              render: (row) => (
                <div>
                  <p className="font-medium text-slate-800">
                    {row.full_name} {row.id === me?.id && <span className="text-[11px] text-slate-500">(você)</span>}
                  </p>
                  <p className="text-[11px] text-slate-500">login: {row.login}</p>
                </div>
              ),
            },
            {
              key: 'role',
              header: 'Função',
              render: (row) => (
                <Select
                  value={row.role}
                  disabled={row.id === me?.id}
                  onChange={(event) => changeRole(row, event.target.value as Role)}
                  className="w-40"
                >
                  <option value="admin">Administrador</option>
                  <option value="manager">Caixa</option>
                  <option value="waiter">Garçom</option>
                </Select>
              ),
            },
            {
              key: 'status',
              header: 'Acesso',
              render: (row) => (
                <div className="flex flex-wrap gap-1">
                  <Badge tone={row.is_active ? 'green' : 'slate'}>{row.is_active ? 'Ativo' : 'Desativado'}</Badge>
                  {row.must_change_password && <Badge tone="amber">troca de senha pendente</Badge>}
                </div>
              ),
            },
            { key: 'phone', header: 'Telefone', render: (row) => row.phone ?? '—' },
            {
              key: 'last_login',
              header: 'Último acesso',
              render: (row) => (row.last_login_at ? formatDateTime(row.last_login_at) : 'nunca acessou'),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'reset_password', profile: row })}>
                    Redefinir senha
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={row.id === me?.id}
                    onClick={() => setConfirm({ kind: 'toggle_active', profile: row })}
                  >
                    {row.is_active ? 'Desativar' : 'Ativar'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11px] text-slate-500">
          <li>Funcionários nunca são apagados: o histórico de vendas e a auditoria apontam para eles.</li>
          <li>Você não pode alterar a própria função nem desativar o próprio acesso (proteção do banco).</li>
          <li>O último administrador ativo não pode ser rebaixado nem desativado.</li>
          <li>A criação de usuário usa a Edge Function com service_role no servidor — o navegador nunca vê essa chave.</li>
        </ul>
      </Card>

      <Modal
        open={Boolean(form)}
        title="Novo funcionário"
        onClose={() => setForm(null)}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} loading={busy}>
              Criar funcionário
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome completo *">
              <Input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} />
            </Field>
            <Field label="Login *" hint="Usado no acesso (sem e-mail): ex.: ana.souza">
              <Input
                value={form.login}
                onChange={(event) => setForm({ ...form, login: event.target.value.toLowerCase() })}
                placeholder="nome.sobrenome"
              />
            </Field>
            <Field label="Função *">
              <Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
                <option value="waiter">Garçom — mesas e pedidos</option>
                <option value="manager">Caixa — operação, recebimentos e fechamento</option>
                <option value="admin">Administrador — acesso total</option>
              </Select>
            </Field>
            <Field label="Telefone">
              <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </Field>
            <Field label="Senha inicial *" hint="Mínimo de 8 caracteres. Informe ao funcionário por canal seguro.">
              <Input
                type="text"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </Field>
            <Field label="Acesso" hint="Desativado por padrão: o funcionário só entra depois que você ativar.">
              <Select
                value={form.activate ? 'sim' : 'nao'}
                onChange={(event) => setForm({ ...form, activate: event.target.value === 'sim' })}
              >
                <option value="sim">Ativar imediatamente</option>
                <option value="nao">Criar desativado</option>
              </Select>
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(tempPassword)} title="Senha temporária" onClose={() => setTempPassword(null)} size="sm">
        {tempPassword && (
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              Nova senha de <strong>{tempPassword.login}</strong>:
            </p>
            <p className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-base">
              {tempPassword.password}
            </p>
            <p className="text-xs text-slate-500">
              Entregue esta senha ao funcionário por um canal seguro. Não há envio automático (e-mail/WhatsApp) nesta
              versão.
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === 'reset_password' ? 'Redefinir senha' : confirm?.profile?.is_active ? 'Desativar acesso' : 'Ativar acesso'}
        confirmLabel={confirm?.kind === 'reset_password' ? 'Redefinir' : 'Confirmar'}
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
              Uma senha temporária aleatória será gerada para <strong>{confirm.profile.full_name}</strong> e o acesso dele
              exigirá troca de senha. A operação é registrada na auditoria.
            </p>
          ) : confirm?.profile.is_active ? (
            <p>
              <strong>{confirm.profile.full_name}</strong> não conseguirá mais entrar no sistema. O histórico permanece
              intacto.
            </p>
          ) : (
            <p>
              Liberar o acesso de <strong>{confirm.profile.full_name}</strong>?
            </p>
          )
        }
      />
    </div>
  )
}
