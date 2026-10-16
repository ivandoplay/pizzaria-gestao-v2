import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Callout, Field, Input } from '../components/ui'
import { Icon, type NomeIcone } from '../components/icons'
import { EmblemaEmPlaca } from '../components/Logo'
import { translateError } from '../lib/errors'
import { isSupabaseConfigured } from '../lib/supabase'
import { limparSessaoLocal, sairDoAparelho } from '../lib/sessao'
import { ROLE_LABELS } from '../lib/types'

/**
 * O que o sistema faz — dito em quatro linhas curtas.
 *
 * Fica no painel de marca do computador. No celular o mesmo painel vira uma
 * faixa fina no topo: quem entra pelo celular é o garçom, que precisa do
 * formulário na mão, não de propaganda.
 */
const RECURSOS: { icone: NomeIcone; texto: string }[] = [
  { icone: 'mesas', texto: 'Mapa do salão atualizado ao vivo' },
  { icone: 'entrega', texto: 'Delivery acompanhado pedido a pedido' },
  { icone: 'dinheiro', texto: 'Caixa com sangria, despesa e conferência' },
  { icone: 'auditoria', texto: 'Toda operação registrada para auditoria' },
]

/** Fases do serviço — o que a casa controla no dia a dia. */
const FASES = ['Salão', 'Delivery', 'Caixa']

/**
 * Fundo do painel de marca: degradê quente, textura de grão finíssima (SVG em
 * data-URI, sem requisição de rede) e dois halos de luz. Tudo decorativo.
 */
function FundoDaMarca() {
  return (
    <>
      <div
        className="absolute inset-0 bg-gradient-to-b from-brand-800 via-brand-900 to-ink-950"
        aria-hidden
      />
      <div
        className="absolute inset-0 opacity-[0.035]"
        aria-hidden
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'%3E%3Ccircle cx='2' cy='2' r='1' fill='%23ffffff'/%3E%3C/svg%3E\")",
        }}
      />
      <div className="absolute -left-20 top-16 h-64 w-64 rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
      <div className="absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-brand-700/35 blur-3xl" aria-hidden />
    </>
  )
}

/** Emblema + nome da casa. Usado no painel do computador e na faixa do celular. */
function Marca({ centralizado = false }: { centralizado?: boolean }) {
  return (
    <div className={`flex items-center gap-3.5 ${centralizado ? 'flex-col gap-2.5 text-center' : ''}`}>
      <EmblemaEmPlaca className="h-[52px] w-[52px]" raio="rounded-[16px]" />
      <div className={centralizado ? '' : 'min-w-0'}>
        <p className="text-[17px] font-semibold leading-tight tracking-[-0.015em] text-white">
          Gestão da Pizzaria
        </p>
        <p className="mt-0.5 text-[12px] font-medium tracking-[0.01em] text-white/65">
          {FASES.join(' · ')}
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { profile, loading, signIn, blockedReason } = useAuth()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const rodape = (
    <p className="mt-5 text-center text-[11px] leading-relaxed text-ink-400">
      Em caso de acesso negado, procure o responsável pelo sistema na pizzaria.
      <br />
      {typeof window !== 'undefined' ? window.location.host : ''} · versão {__VERSAO_DO_APP__}
    </p>
  )

  // Já existe sessão neste aparelho: em vez de entrar direto (o que impedia
  // trocar de usuário sem descobrir onde sair), mostramos quem está conectado.
  if (!loading && profile) {
    return (
      <div className="min-h-screen bg-papel lg:flex">
        <aside className="relative hidden overflow-hidden lg:flex lg:w-[52%] lg:flex-col lg:justify-between lg:p-12">
          <FundoDaMarca />
          <div className="relative">
            <Marca />
          </div>
          <div className="relative max-w-md text-white">
            <h2 className="text-[30px] font-semibold leading-tight tracking-[-0.02em]">
              Sessão aberta neste aparelho.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              Você pode continuar de onde parou ou entrar com outro acesso — útil no balcão, onde o mesmo
              computador passa por várias mãos no meio do turno.
            </p>
          </div>
          <p className="relative text-xs text-white/55">Sessão protegida pelas permissões do seu perfil.</p>
        </aside>

        <header className="relative overflow-hidden rounded-b-[28px] px-5 pb-14 pt-8 lg:hidden">
          <FundoDaMarca />
          <div className="relative">
            <Marca centralizado />
          </div>
        </header>

        <main className="relative z-10 flex flex-1 items-start justify-center px-4 pb-10 lg:items-center lg:px-6">
          <div className="-mt-8 w-full max-w-[420px] lg:mt-0">
            <div className="rounded-card border border-ink-200 bg-white p-6 shadow-raised sm:p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Icon nome="usuario" className="h-5 w-5" />
              </span>
              <h1 className="mt-4 text-[21px] font-semibold leading-snug tracking-[-0.015em] text-ink-900">
                Você já está conectado
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
                Este aparelho está com a sessão de{' '}
                <strong className="font-semibold text-ink-800">{profile.full_name}</strong>
                {` (${ROLE_LABELS[profile.role]}, login ${profile.login})`}. Para entrar com outro acesso,
                saia desta conta.
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Button className="sm:flex-1" icone="painel" onClick={() => navigate('/', { replace: true })}>
                  Continuar como {profile.full_name.split(' ')[0]}
                </Button>
                <Button
                  variant="secondary"
                  className="sm:flex-1"
                  icone="sair"
                  onClick={() => void sairDoAparelho('/login')}
                >
                  Entrar com outra conta
                </Button>
              </div>
              <p className="mt-5 border-t border-ink-100 pt-3 text-[11px] text-ink-400">
                {typeof window !== 'undefined' ? window.location.host : ''} · versão {__VERSAO_DO_APP__}
              </p>
            </div>
            {rodape}
          </div>
        </main>
      </div>
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(login, password)
      // Entrou: vai direto para a tela inicial do perfil (o Guard decide qual).
      navigate('/', { replace: true })
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
    <div className="min-h-screen bg-papel lg:flex">
      {/* Painel de marca — computador */}
      <aside className="relative hidden overflow-hidden lg:flex lg:w-[52%] lg:flex-col lg:justify-between lg:p-12 xl:w-[55%] xl:p-16">
        <FundoDaMarca />

        <div className="relative">
          <Marca />
        </div>

        <div className="relative max-w-lg text-white">
          <h2 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] xl:text-[36px]">
            Do salão ao caixa,
            <br />
            tudo no mesmo lugar.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/75">
            Mesas, pedidos, delivery e fechamento de conta em tempo real — com histórico auditável de cada
            operação.
          </p>

          <ul className="mt-9 space-y-3.5">
            {RECURSOS.map((item) => (
              <li key={item.texto} className="flex items-center gap-3 text-[14px] text-white/90">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-white/10 ring-1 ring-white/10">
                  <Icon nome={item.icone} className="h-[18px] w-[18px]" />
                </span>
                {item.texto}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[12px] leading-relaxed text-white/45">
          Acesse apenas com as credenciais fornecidas pelo administrador da pizzaria.
        </p>
      </aside>

      {/* Faixa de marca — celular e tablet */}
      <header className="relative overflow-hidden rounded-b-[28px] px-5 pb-16 pt-9 lg:hidden">
        <FundoDaMarca />
        <div className="relative">
          <Marca centralizado />
        </div>
      </header>

      {/* Formulário */}
      <main className="relative z-10 flex flex-1 items-start justify-center px-4 pb-10 lg:items-center lg:px-6">
        <div className="-mt-10 w-full max-w-[420px] lg:mt-0">
          <div className="rounded-card border border-ink-200 bg-white p-6 shadow-raised sm:p-7">
            <div className="hidden lg:block">
              <h1 className="text-[23px] font-semibold tracking-[-0.015em] text-ink-900">
                Entrar no sistema
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                Use o login e a senha cadastrados pela administração.
              </p>
            </div>
            <p className="mb-5 text-[13px] font-medium text-ink-500 lg:hidden">
              Entre com o seu acesso de trabalho
            </p>

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

              <Button
                type="submit"
                size="lg"
                block
                loading={submitting}
                icone={submitting ? undefined : 'cadeado'}
              >
                {submitting ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>

            <div className="mt-5 flex gap-2.5 border-t border-ink-100 pt-4">
              <Icon nome="info" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              <p className="text-[12px] leading-relaxed text-ink-500">
                Não existe cadastro público. As contas são criadas e liberadas pelo administrador da
                pizzaria.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                limparSessaoLocal()
                window.location.reload()
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-control px-3 py-2 text-center text-[12px] text-ink-400 transition hover:bg-ink-100 hover:text-ink-600"
              title="Apaga a sessão salva neste navegador e recarrega a página"
            >
              <Icon nome="atualizar" className="h-3.5 w-3.5" />
              Problemas para entrar? Limpar dados deste aparelho
            </button>
          </div>

          {rodape}
        </div>
      </main>
    </div>
  )
}
