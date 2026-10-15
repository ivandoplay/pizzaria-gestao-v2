import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { Button, Callout, Field, Input } from '../components/ui'
import { Icon } from '../components/icons'
import { definirSenhaDefinitiva } from '../lib/api'
import { translateError } from '../lib/errors'
import { avaliarSenha, MINIMO_DE_SENHA, validarTrocaDeSenha } from '../lib/senha'
import { ROLE_LABELS } from '../lib/types'

/**
 * Porta de entrada obrigatória de quem recebeu senha temporária.
 *
 * Esta tela substitui o sistema inteiro enquanto `profiles.must_change_password`
 * estiver marcado: sem menu, sem rota, sem atalho — a única coisa que dá para
 * fazer é definir a senha definitiva (ou sair). O fluxo tem três passos, nesta
 * ordem, e o último só roda se o anterior deu certo:
 *
 *   1. a pessoa digita a senha atual — é a prova de que ela é quem diz ser,
 *      e é o que impede alguém que só achou o celular aberto de assumir a conta;
 *   2. o Auth do Supabase grava a senha nova (a senha nunca passa pelo banco);
 *   3. o banco baixa a flag `must_change_password`, registrando o evento na
 *      auditoria (`public.complete_password_change`).
 */
export default function TrocarSenhaPage() {
  const { profile, signOut, refreshProfile, session } = useAuth()
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [repetir, setRepetir] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const forca = avaliarSenha(nova)
  const email = session?.user?.email ?? ''

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    setErro(null)

    const problema = validarTrocaDeSenha({ atual, nova, repetir })
    if (problema) {
      setErro(problema)
      return
    }
    if (!email) {
      setErro('Não foi possível identificar o seu acesso. Saia e entre novamente.')
      return
    }

    setEnviando(true)
    try {
      await definirSenhaDefinitiva(email, atual, nova)
      // Recarrega o perfil: a flag já está baixada e o sistema abre.
      await refreshProfile()
    } catch (error) {
      // As frases ficam em lib/errors.ts: aqui só traduzimos o código que veio.
      setErro(translateError(error))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="papel-da-tela flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-card border border-ink-200 bg-white p-6 shadow-raised sm:p-7">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Icon nome="cadeado" className="h-6 w-6" />
          </span>

          <h1 className="mt-4 text-lg font-semibold tracking-[-0.01em] text-ink-900">Defina sua senha definitiva</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
            {profile ? (
              <>
                <strong className="text-ink-800">{profile.full_name}</strong>
                {` (${ROLE_LABELS[profile.role]})`} entrou com uma senha temporária, conhecida por quem criou o acesso.
                Escolha agora uma senha só sua para liberar o sistema.
              </>
            ) : (
              'Este acesso está com senha temporária. Escolha agora uma senha só sua para liberar o sistema.'
            )}
          </p>

          <form className="mt-5 space-y-4" onSubmit={enviar}>
            <Field label="Senha que você usou agora" obrigatorio>
              <Input
                type={verSenha ? 'text' : 'password'}
                value={atual}
                autoFocus
                autoComplete="current-password"
                onChange={(evento) => setAtual(evento.target.value)}
              />
            </Field>

            <Field
              label="Nova senha"
              obrigatorio
              hint={
                nova
                  ? `Força: ${forca.rotulo}${forca.dica ? ` — ${forca.dica}` : ''}`
                  : `Ao menos ${MINIMO_DE_SENHA} caracteres.`
              }
            >
              <Input
                type={verSenha ? 'text' : 'password'}
                value={nova}
                autoComplete="new-password"
                onChange={(evento) => setNova(evento.target.value)}
              />
            </Field>

            <Field label="Repita a nova senha" obrigatorio>
              <Input
                type={verSenha ? 'text' : 'password'}
                value={repetir}
                autoComplete="new-password"
                onChange={(evento) => setRepetir(evento.target.value)}
              />
            </Field>

            <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-pequeno text-ink-700 sm:min-h-0">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                checked={verSenha}
                onChange={(evento) => setVerSenha(evento.target.checked)}
              />
              Mostrar as senhas enquanto digito
            </label>

            {erro && (
              <Callout tom="erro" titulo="Não deu para salvar">
                {erro}
              </Callout>
            )}

            <Button type="submit" block size="lg" icone="cadeado" loading={enviando}>
              Salvar minha senha e entrar
            </Button>
          </form>

          <div className="mt-4 rounded-control bg-ink-50 px-3.5 py-3 text-[12px] leading-relaxed text-ink-600">
            <p className="font-medium text-ink-700">Por que estou vendo isto?</p>
            <p className="mt-0.5">
              Contas criadas ou com senha redefinida pelo administrador entram com senha temporária. A troca é
              obrigatória para o acesso ficar só com você — e fica registrada na auditoria do sistema.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-ink-200 px-3 text-pequeno font-medium text-ink-600 transition hover:bg-ink-50"
          >
            <Icon nome="sair" className="h-4 w-4" />
            Sair e entrar com outra conta
          </button>
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-400">
          {typeof window !== 'undefined' ? window.location.host : ''} · versão {__VERSAO_DO_APP__}
        </p>
      </div>
    </div>
  )
}
