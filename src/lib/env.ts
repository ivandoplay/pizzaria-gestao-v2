/**
 * Configuração de ambiente do navegador.
 *
 * Módulo proposital: NÃO cria conexão nenhuma. Assim qualquer código (inclusive
 * testes e utilitários de formatação) pode ler estas variáveis sem arrastar o
 * cliente Supabase — que só é construído quando alguém realmente chama a API
 * (ver `supabase.ts`).
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** O app já recebeu URL e chave pública do Supabase? */
export const isSupabaseConfigured = Boolean(url && anonKey)

/** URL do projeto Supabase (vazia quando não configurado). */
export const SUPABASE_URL = url ?? ''

/** Chave PÚBLICA (anon/publishable) — protegida pela RLS. Nunca a service_role. */
export const SUPABASE_ANON_KEY = anonKey ?? ''

/** Fuso horário de exibição. O banco guarda em UTC; a regra é este fuso. */
export const TIMEZONE = (import.meta.env.VITE_TIMEZONE as string) || 'America/Fortaleza'
