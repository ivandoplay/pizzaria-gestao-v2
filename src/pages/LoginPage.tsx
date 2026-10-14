import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Field, Input } from '../components/ui'
import { translateError } from '../lib/errors'

export default function LoginPage() {
  const { profile, loading, signIn, blockedReason } = useAuth()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
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
          ? 'Login ou senha inválidos.'
          : raw,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 text-center">
          <div className="mb-1 text-4xl" aria-hidden>
            🍕
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Gestão da Pizzaria</h1>
          <p className="text-xs text-slate-500">Entre com o seu acesso de trabalho</p>
        </div>

        {blockedReason && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            {blockedReason}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Login">
            <Input
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              autoComplete="username"
              placeholder="ex.: maria.silva"
              required
              autoFocus
            />
          </Field>

          <Field label="Senha">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}

          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Entrar
          </Button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-500">
          Não há cadastro público. As contas são criadas e liberadas pelo administrador da pizzaria.
        </p>
      </div>
    </div>
  )
}
