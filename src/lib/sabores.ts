/**
 * Seleção de sabores de uma pizza.
 *
 * `atual` guarda apenas os sabores ADICIONAIS — o sabor principal é o produto
 * que está sendo lançado. `maxSaboresTotais` é o limite do tamanho (ex.: 2 para
 * meio a meio), contando o principal.
 *
 * Regra: ao escolher um sabor quando o limite já está cheio, ele SUBSTITUI o
 * mais antigo — nunca acrescenta além do limite. Era aqui que o terceiro sabor
 * entrava num tamanho de dois (achado A4).
 */
export function alternarSabor(atual: string[], saborId: string, maxSaboresTotais: number): string[] {
  if (atual.includes(saborId)) return atual.filter((id) => id !== saborId)

  const extrasPermitidos = Math.max(Math.trunc(maxSaboresTotais) - 1, 1)
  if (atual.length + 1 <= extrasPermitidos) return [...atual, saborId]

  // `slice(atual.length - manter)` — e não `slice(-manter)`: com manter = 0 o
  // `slice(-0)` devolve a lista inteira (o defeito original).
  const manter = extrasPermitidos - 1
  return [...atual.slice(atual.length - manter), saborId]
}
