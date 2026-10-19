import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import * as api from '../lib/api'
import { sairDoAparelho } from '../lib/sessao'
import { criarGuardaDePerfil } from '../lib/cargaDePerfil'
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
  /** Ordem das cargas de perfil — ver src/lib/cargaDePerfil.ts (achado F1). */
  const guarda = useRef(criarGuardaDePerfil())
  /**
   * Última sessão autenticada conhecida, atualizada de forma SÍNCRONA.
   *
   * Serve para duas coisas: (1) um evento atrasado "sem sessão" da
   * inicialização do Auth não pode derrubar quem acabou de entrar; (2) duas
   * cargas do MESMO usuário (login + evento do Auth) reaproveitam a mesma
   * consulta em vez de competirem.
   */
  const sessaoRef = useRef<Session | null>(null)
  const cargaEmVoo = useRef<{ id: string; promessa: Promise<void> } | null>(null)

  const carregarPerfil = useCallback((id: string, ticket: number): Promise<void> => {
    return (async () => {
      try {
        const found = await api.fetchMyProfile(id)
        // Resposta de uma sessão que já não é a atual: descartar em silêncio.
        // Sem isto, a conta anterior podia sobrescrever a tela da conta nova.
        if (!guarda.current.deveAplicar(ticket, id)) return
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
        if (!guarda.current.deveAplicar(ticket, id)) return
        setProfile(null)
        setBlockedReason('Não foi possível carregar seu perfil. Verifique a conexão e tente de novo.')
      }
    })()
  }, [])

  const loadProfile = useCallback(
    (currentSession: Session | null): Promise<void> => {
      const id = currentSession?.user?.id ?? null

      // Sem sessão: só limpa se realmente não há sessão autenticada conhecida.
      // (O evento inicial do Auth pode chegar depois do login, com `null`.)
      if (!id) {
        if (sessaoRef.current) return Promise.resolve()
        guarda.current.iniciar(null)
        sessaoAnterior.current = null
        setProfile(null)
        setBlockedReason(null)
        return Promise.resolve()
      }

      // Mesma conta já carregando: devolve a consulta em andamento. Sem isso,
      // o login e o evento do Auth disputariam a mesma carga e a tela podia
      // navegar antes de o perfil chegar.
      if (cargaEmVoo.current?.id === id) return cargaEmVoo.current.promessa

      const ticket = guarda.current.iniciar(id)
      const promessa = carregarPerfil(id, ticket)
      cargaEmVoo.current = { id, promessa }
      return promessa.finally(() => {
        if (cargaEmVoo.current?.promessa === promessa) cargaEmVoo.current = null
      })
    },
    [carregarPerfil],
  )

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let ativo = true
    let concluido = false

    const aplicarSessao = async (novaSessao: Session | null) => {
      if (!ativo) return
      // Conta diferente: o perfil anterior não pode ficar na tela enquanto a
      // nova consulta não responde (nem se ela falhar).
      const idNovo = novaSessao?.user?.id ?? null
      if (idNovo !== sessaoAnterior.current) {
        setProfile(null)
        setBlockedReason(null)
      }
      if (novaSessao) sessaoRef.current = novaSessao
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
      // Registra a sessão antes de qualquer coisa: um evento atrasado do Auth
      // não pode ser interpretado como "não há sessão" durante o login.
      if (data.session) sessaoRef.current = data.session
      setSession(data.session ?? null)
      await loadProfile(data.session ?? null)
      if (data.session?.user) void api.markLogin()
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
        setProfile(null)
        setSession(null)
        sessaoAnterior.current = null
        sessaoRef.current = null
        cargaEmVoo.current = null
        guarda.current.iniciar(null)
        // Sai pela rotina com prazo: se o servidor não responder, o aparelho é
        // limpo e o operador volta para a tela de entrada de qualquer forma.
        await sairDoAparelho('/login')
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
