import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase do NAVEGADOR.
 *
 * Somente a chave PÚBLICA (anon) fica aqui — ela é protegida pela RLS.
 * A chave service_role NUNCA deve aparecer no frontend: operações
 * privilegiadas passam por Edge Functions (ver supabase/functions/).
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'pizzaria.auth',
      },
      realtime: {
        params: { eventsPerSecond: 5 },
      },
      global: {
        headers: { 'x-application-name': 'pizzaria-gestao' },
      },
    })
  : (null as unknown as SupabaseClient)

export const TIMEZONE = (import.meta.env.VITE_TIMEZONE as string) || 'America/Fortaleza'
