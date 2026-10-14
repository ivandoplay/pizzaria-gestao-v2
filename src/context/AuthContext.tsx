import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import * as api from '../lib/api'
import type { Profile, Role } from '../lib/types'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  /** Motivo pelo qual o acesso está bloqueado (perfil inativo, sessão não confirmada, etc.). */
  blockedReason: string | null
  can: (roles: Role[]) => boolean
  isAdmin: boolean
  isManager: boolean
  isWaiter: boolean
  signIn: (login: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/** Tempo máximo para confirmar a sessão salva no navegador antes de avisar o operador. */
const ESPERA_MAXIMA_SESSAO_MS = 12_000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const sessaoAnterior = useRef<string | null>(null)

  const loadProfile = useCallback(async (currentSession: Session | null) => {
    if (!currentSession?.user) {
      setProfile(null)
      setBlockedReason(null)
      sessaoAnterior.current = null
      return
    }
    const id = currentSession.user.id
    try {
      const found = await api.fetchMyProfile(id)
      if (!found) {
        setProfile(null)
        setBlockedReason(
          'Sua conta existe, mas ainda não foi vinculada a um funcionário ativo. Contate o administrador.',
        )
        return
      }
      if (!found.is_active) {
        setProfile(null)
        setBlockedReason('Seu acesso está desativado. Contate o administrador.')
        return
      }
      setProfile(found)
      setBlockedReason(null)
      sessaoAnterior.current = id
    } catch {
      setProfile(null)
      setBlockedReason('Não foi possível carregar seu perfil. Verifique a conexão e tente de novo.')
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let ativo = true
    let concluido = false

    const aplicarSessao = async (novaSessao: Session | null) => {
      if (!ativo) return
      setSession(novaSessao)
      try {
        await loadProfile(novaSessao)
      } finally {
        if (ativo) {
          concluido = true
          setLoading(false)
        }
      }
    }

    // Rede ruim não pode deixar a tela presa em "Carregando": passado o prazo,
    // avisamos o operador e liberamos a tela para ele tentar de novo.
    const relogio = window.setTimeout(() => {
      if (!ativo || concluido) return
      setLoading(false)
      setBlockedReason(
        'A sessão salva neste aparelho demorou demais para ser confirmada (conexão lenta ou instável). Recarregue a página para entrar de novo.',
      )
    }, ESPERA_MAXIMA_SESSAO_MS)

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!ativo || concluido) return
        void aplicarSessao(data.session)
      })
      .catch(() => {
        if (!ativo || concluido) return
        setLoading(false)
        setBlockedReason('Não foi possível confirmar sua sessão. Verifique a conexão e entre novamente.')
      })

    const { data: listener } = supabase.auth.onAuthStateChange((_evento, novaSessao) => {
      // ATENÇÃO — não aguarde consultas ao banco dentro deste callback.
      // O Auth só conclui a própria inicialização depois que este callback
      // retorna, e qualquer consulta precisa do Auth para resolver o token:
      // aguardar aqui trava a aplicação inteira em "Carregando seu acesso…".
      // Por isso o trabalho é reagendado para o próximo ciclo do navegador.
      window.setTimeout(() => {
        if (ativo) void aplicarSessao(novaSessao)
      }, 0)
    })

    return () => {
      ativo = false
      window.clearTimeout(relogio)
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(
    async (login: string, password: string) => {
      const data = await api.signIn(login, password)
      setSession(data.session ?? null)
      await loadProfile(data.session ?? null)
      if (data.session?.user) void api.markLogin(data.session.user.id)
    },
    [loadProfile],
  )

  const value = useMemo<AuthState>(() => {
    const isAdmin = profile?.role === 'admin'
    const isManager = profile?.role === 'manager' || isAdmin
    const isWaiter = profile?.role === 'waiter'
    return {
      loading,
      session,
      profile,
      blockedReason,
      isAdmin,
      isManager,
      isWaiter,
      can: (roles: Role[]) => (profile ? roles.includes(profile.role) : false),
      signIn,
      signOut: async () => {
        await api.signOut()
        setProfile(null)
        setSession(null)
        sessaoAnterior.current = null
      },
      refreshProfile: async () => loadProfile(session),
    }
  }, [blockedReason, loadProfile, loading, profile, session, signIn])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return context
}
