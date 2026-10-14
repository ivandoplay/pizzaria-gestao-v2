import { supabase } from './supabase'

/** Chaves que o app grava no navegador (sessão do Supabase Auth). */
const CHAVES_DO_APP = ['pizzaria.auth', 'pizzaria.auth-user', 'pizzaria.auth-code-verifier']

/**
 * Apaga do aparelho a sessão salva — sem falar com o servidor.
 *
 * Serve para o caso em que o estado local ficou inconsistente (sessão de um
 * banco que não existe mais, aba antiga aberta, dados corrompidos): sem isto, o
 * operador não tem como "destravar" a entrada sem mexer nas ferramentas do
 * navegador.
 */
export function limparSessaoLocal(): void {
  try {
    for (const chave of CHAVES_DO_APP) localStorage.removeItem(chave)
    for (const chave of Object.keys(localStorage)) {
      // O Supabase grava a sessão em `sb-<ref>-auth-token`; limpamos qualquer resíduo.
      if (chave.startsWith('sb-') && chave.includes('auth')) localStorage.removeItem(chave)
    }
    sessionStorage.clear()
  } catch {
    // Modo restrito do navegador: nada a limpar.
  }
}

/**
 * Sai da conta com prazo máximo de espera.
 *
 * O `signOut` fala com o servidor; se a conexão estiver ruim (ou a sessão já
 * estiver inválida), ele pode demorar. Passado o prazo, limpamos o aparelho e
 * seguimos para a tela de entrada de qualquer forma — o operador nunca fica preso.
 */
export async function sairDoAparelho(destino = '/login'): Promise<void> {
  await Promise.race([
    supabase.auth.signOut().catch(() => undefined),
    new Promise((resolver) => window.setTimeout(resolver, 2500)),
  ])
  limparSessaoLocal()
  // Recarrega de verdade: garante que nenhum estado antigo continue na memória.
  window.location.href = destino
}
