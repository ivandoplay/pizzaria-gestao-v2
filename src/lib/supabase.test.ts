import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Regressão: importar o módulo do Supabase NÃO pode construir o cliente.
 *
 * O cliente de tempo real exige um WebSocket nativo; em ambientes que não têm
 * (Node, usado nos testes) a construção falha. Como utilitários de formatação
 * importam configuração de ambiente, um erro na importação derrubava testes
 * inteiros — foi exatamente o que aconteceu quando um `.env.local` passou a
 * existir no projeto.
 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('cliente Supabase sob demanda', () => {
  it('importar o módulo não cria cliente nem lança erro', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://exemplo.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'chave-publica-de-teste')
    vi.resetModules()

    const modulo = await import('./supabase')

    expect(modulo.isSupabaseConfigured).toBe(true)
    expect(typeof modulo.getSupabase).toBe('function')
    // O módulo foi carregado com sucesso; o cliente ainda não existe.
    expect(modulo).toHaveProperty('supabase')
  })

  it('sem configuração, pedir o cliente explica o que falta em vez de quebrar', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    vi.resetModules()

    const { getSupabase, isSupabaseConfigured } = await import('./supabase')

    expect(isSupabaseConfigured).toBe(false)
    expect(() => getSupabase()).toThrowError(/CONFIGURACAO_PENDENTE/)
  })

  it('o fuso padrão é America/Fortaleza e não depende do cliente', async () => {
    vi.stubEnv('VITE_TIMEZONE', '')
    vi.resetModules()

    const { TIMEZONE } = await import('./env')

    expect(TIMEZONE).toBe('America/Fortaleza')
  })
})
