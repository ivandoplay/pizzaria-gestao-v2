/**
 * Foco e teclado dos modais abertos.
 *
 * Vive fora do componente porque são decisões puras — e porque foi justamente
 * uma decisão de ciclo de vida tomada dentro do `Modal` que quebrou a digitação
 * do sistema inteiro: o efeito de foco dependia de `onClose`, as telas passam
 * `onClose={() => setX(null)}` (função nova a cada render), então **cada tecla
 * digitada reiniciava o efeito** — a limpeza devolvia o foco para o campo
 * anterior e o timer de 40 ms re-focava o primeiro campo do modal.
 *
 * Aqui ficam só as regras; o `Modal` (components/ui.tsx) cuida do DOM.
 */

/** Pilha dos modais abertos, na ordem em que foram abertos. */
const pilha: string[] = []

/** Registra um modal como aberto (entra no topo). */
export function entrarNaPilha(chave: string) {
  pilha.push(chave)
}

/** Remove um modal da pilha (ao fechar), esteja ele onde estiver. */
export function sairDaPilha(chave: string) {
  const posicao = pilha.lastIndexOf(chave)
  if (posicao >= 0) pilha.splice(posicao, 1)
}

/**
 * Só o modal do TOPO responde a teclado. Sem isso, com dois modais abertos
 * (montar a pizza dentro do pedido de delivery, por exemplo) a tecla Escape
 * fechava os dois de uma vez: os dois ouvintes ficam no `window` e
 * `stopPropagation` não impede outro ouvinte do mesmo alvo.
 */
export function estaNaPilhaDoTopo(chave: string) {
  return pilha.length > 0 && pilha[pilha.length - 1] === chave
}

/** Quantidade de modais abertos (usado nos testes). */
export function tamanhoDaPilha() {
  return pilha.length
}

/** Zera a pilha (usado nos testes). */
export function limparPilha() {
  pilha.length = 0
}

/**
 * O foco inicial (no primeiro campo do modal) só é aplicado se:
 *   - este modal ainda é o do topo (um modal aninhado aberto logo em seguida
 *     manda no foco, não o de baixo); e
 *   - nada dentro do próprio painel já está com o foco — é o caso de um campo
 *     com `autoFocus`, ou do operador que clicou num campo antes dos 40 ms.
 * Ou seja: o modal posiciona o foco UMA vez ao abrir e nunca mais o disputa.
 */
export function deveFocarPrimeiroCampo(estado: { noTopo: boolean; focoDentroDoPainel: boolean }) {
  return estado.noTopo && !estado.focoDentroDoPainel
}

/**
 * Decide se o foco volta para quem abriu o modal quando ele fecha.
 *
 * Só devolve o foco se o elemento de origem ainda estiver na página E o foco
 * tiver ficado solto por causa do fechamento (no `body`, porque o campo focado
 * foi removido junto com o modal, ou ainda dentro do painel que está saindo).
 * Se o foco já está em outro lugar — outro modal abriu por cima, por exemplo —
 * não se mexe: roubar o foco de outra janela é exatamente o defeito que este
 * módulo existe para evitar.
 */
export function deveDevolverFoco(estado: {
  temAnterior: boolean
  anteriorConectado: boolean
  focoDentroDoPainel: boolean
  focoSolto: boolean
}) {
  if (!estado.temAnterior || !estado.anteriorConectado) return false
  return estado.focoDentroDoPainel || estado.focoSolto
}
