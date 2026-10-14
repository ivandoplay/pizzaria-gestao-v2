import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Callout, Field, Input } from '../components/ui'
import { Icon } from '../components/icons'
import { translateError } from '../lib/errors'
import { isSupabaseConfigured } from '../lib/supabase'

export default function LoginPage() {
  const { profile, loading, signIn, blockedReason } = useAuth()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && profile) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(login, password)
    } catch (err) {
      const raw = translateError(err)
      setError(
        /invalid login credentials|invalid_credentials/i.test(raw)
          ? 'Login ou senha inválidos. Confira se digitou corretamente.'
          : raw,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink-900 lg:flex-row">
      {/* Painel de marca (desktop) */}
      <aside className="relative hidden w-[46%] overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="absolute inset-0 bg-gradient-to-br from-brand-700 via-brand-800 to-ink-950"
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-[0.18]"
          aria-hidden
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 56 56'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='1.1'%3E%3Ccircle cx='28' cy='28' r='13'/%3E%3Ccircle cx='8' cy='8' r='3'/%3E%3Ccircle cx='48' cy='8' r='3'/%3E%3Ccircle cx='8' cy='48' r='3'/%3E%3Ccircle cx='48' cy='48' r='3'/%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />

        <div className="relative flex items-center gap-3 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <Icon nome="pizza" className="h-6 w-6" />
          </span>
          <div>
            <p className="text-base font-semibold tracking-tight">Gestão da Pizzaria</p>
            <p className="text-xs text-white/70">Salão · Delivery · Caixa</p>
          </div>
        </div>

        <div className="relative max-w-md text-white">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Do salão ao caixa, tudo no mesmo lugar.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/80">
            Mesas, pedidos, delivery e fechamento de conta em tempo real — com histórico auditável de cada
            operação.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-white/90">
            {[
              { icone: 'mesas' as const, texto: 'Mapa do salão atualizado ao vivo' },
              { icone: 'entrega' as const, texto: 'Delivery acompanhado pedido a pedido' },
              { icone: 'dinheiro' as const, texto: 'Caixa com sangria, despesa e conferência' },
              { icone: 'auditoria' as const, texto: 'Toda operação registrada para auditoria' },
            ].map((item) => (
              <li key={item.texto} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                  <Icon nome={item.icone} className="h-4 w-4" />
                </span>
                {item.texto}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">
          Acesse apenas com as credenciais fornecidas pelo administrador da pizzaria.
        </p>
      </aside>

      {/* Formulário */}
      <main className="flex flex-1 items-center justify-center bg-ink-100 px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center lg:hidden">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-raised">
              <Icon nome="pizza" className="h-7 w-7" />
            </span>
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">Gestão da Pizzaria</h1>
            <p className="text-xs text-ink-500">Entre com o seu acesso de trabalho</p>
          </div>

          <div className="rounded-card border border-ink-200 bg-white p-6 shadow-raised sm:p-7">
            <div className="mb-5 hidden lg:block">
              <h1 className="text-xl font-semibold tracking-tight text-ink-900">Entrar no sistema</h1>
              <p className="mt-1 text-sm text-ink-500">Use o login e a senha cadastrados pela administração.</p>
            </div>

            {!isSupabaseConfigured && (
              <div className="mb-4">
                <Callout tom="erro" titulo="Sistema não configurado">
                  As variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não foram definidas neste ambiente.
                </Callout>
              </div>
            )}

            {blockedReason && (
              <div className="mb-4">
                <Callout tom="atencao" titulo="Acesso bloqueado">
                  {blockedReason}
                </Callout>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Login" obrigatorio>
                <div className="relative">
                  <Icon
                    nome="usuario"
                    className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-400"
                  />
                  <Input
                    value={login}
                    onChange={(event) => setLogin(event.target.value)}
                    autoComplete="username"
                    placeholder="ex.: maria.silva"
                    required
                    autoFocus
                    className="pl-10"
                  />
                </div>
              </Field>

              <Field label="Senha" obrigatorio>
                <div className="relative">
                  <Icon
                    nome="cadeado"
                    className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-400"
                  />
                  <Input
                    type={mostrarSenha ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                    className="pl-10 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenha((valor) => !valor)}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 transition hover:bg-ink-100 hover:text-ink-600"
                    aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    title={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    <Icon nome={mostrarSenha ? 'olho-fechado' : 'olho'} className="h-[18px] w-[18px]" />
                  </button>
                </div>
              </Field>

              {error && <Callout tom="erro">{error}</Callout>}

              <Button type="submit" size="lg" block loading={submitting} icone={submitting ? undefined : 'cadeado'}>
                {submitting ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>

            <p className="mt-5 border-t border-ink-100 pt-4 text-center text-xs leading-relaxed text-ink-500">
              Não existe cadastro público. As contas são criadas e liberadas pelo administrador da pizzaria.
            </p>
          </div>

          <p className="mt-5 text-center text-[11px] text-ink-400">
            Em caso de acesso negado, procure o responsável pelo sistema na pizzaria.
          </p>
        </div>
      </main>
    </div>
  )
}
