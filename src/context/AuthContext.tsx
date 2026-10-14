import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import * as api from '../lib/api'
import type { Profile, Role } from '../lib/types'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  /** Motivo pelo qual o acesso está bloqueado (perfil inativo, etc.). */
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [blockedReason, setBlockedReason] = useState<string | null>(null)

  const loadProfile = useCallback(async (currentSession: Session | null) => {
    if (!currentSession?.user) {
      setProfile(null)
      setBlockedReason(null)
      return
    }
    try {
      const found = await api.fetchMyProfile(currentSession.user.id)
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
    } catch {
      setProfile(null)
      setBlockedReason('Não foi possível carregar seu perfil. Verifique a conexão.')
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let active = true

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session)
      if (active) setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!active) return
      setSession(newSession)
      await loadProfile(newSession)
    })

    return () => {
      active = false
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
