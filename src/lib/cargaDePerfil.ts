/**
 * Guarda de ordem das cargas de perfil (revisão de 19/10/2026, achado F1).
 *
 * `AuthContext` carrega o perfil de forma assíncrona e pode disparar mais de
 * uma carga ao mesmo tempo: a sessão salva no aparelho, o evento de mudança de
 * autenticação, o login e o `refreshProfile`. Nada garantia que a resposta que
 * chega por último fosse a da sessão atual.
 *
 * Cenário que existia: a sessão A começa a carregar; o operador troca para a
 * conta B; B responde primeiro; A responde depois e **sobrescreve** o perfil —
 * a tela passava a mostrar nome e permissões do usuário anterior. O banco
 * continuava sendo a autoridade (nenhuma operação indevida passava), mas o
 * operador via o menu e os dados errados.
 *
 * A regra é simples e não depende de tempo: cada carga recebe um número; só a
 * carga mais recente, para o mesmo usuário, pode escrever no estado.
 */

export interface GuardaDePerfil {
  /** Marca o começo de uma carga e devolve o número dela. */
  iniciar(usuarioId: string | null): number
  /** Essa carga ainda é a dona do estado? */
  deveAplicar(ticket: number, usuarioId: string | null): boolean
  /** Quantas cargas começaram (útil em teste e diagnóstico). */
  readonly total: number
}

export function criarGuardaDePerfil(): GuardaDePerfil {
  let ultimoTicket = 0
  let alvo: string | null = null

  return {
    iniciar(usuarioId) {
      ultimoTicket += 1
      alvo = usuarioId
      return ultimoTicket
    },
    deveAplicar(ticket, usuarioId) {
      return ticket === ultimoTicket && usuarioId === alvo
    },
    get total() {
      return ultimoTicket
    },
  }
}
