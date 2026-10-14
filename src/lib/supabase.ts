import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './env'

/**
 * Cliente Supabase do NAVEGADOR.
 *
 * Somente a chave PÚBLICA (anon) fica aqui — ela é protegida pela RLS.
 * A chave service_role NUNCA deve aparecer no frontend: operações
 * privilegiadas passam por Edge Functions (ver supabase/functions/).
 *
 * O cliente é criado na PRIMEIRA chamada, não na importação. Duas razões:
 *   1. importar um utilitário de formatação não deve abrir conexão;
 *   2. ambientes sem WebSocket nativo (por exemplo, os testes em Node) falham ao
 *      construir o cliente de tempo real — e é justamente o que não queremos que
 *      aconteça por um simples `import`.
 */

let cliente: SupabaseClient | null = null

/** Devolve o cliente Supabase, criando-o na primeira chamada. */
export function getSupabase(): SupabaseClient {
  if (cliente) return cliente
  if (!isSupabaseConfigured) {
    throw new Error(
      'CONFIGURACAO_PENDENTE: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja .env.example).',
    )
  }
  cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
  return cliente
}

/**
 * Mesma API de antes (`supabase.from(...)`, `supabase.rpc(...)`,
 * `supabase.auth...`), mas resolvendo o cliente somente quando usado.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_alvo, propriedade) {
    const instancia = getSupabase()
    const valor = Reflect.get(instancia as object, propriedade, instancia)
    return typeof valor === 'function' ? valor.bind(instancia) : valor
  },
})

export { isSupabaseConfigured, TIMEZONE } from './env'
