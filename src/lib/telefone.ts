/**
 * Normalização de telefone para busca de cliente recorrente (seção 8.1).
 *
 * O telefone é digitado de vários jeitos: com máscara, sem máscara, com o
 * código do país (55) ou sem ele. A coluna correta para procurar é
 * `customers.phone_digits` — gerada pelo banco só com dígitos e **indexada**
 * (`customers_phone_digits_key`). Procurar em `customers.phone` com
 * `ilike('%…%')` não usava índice nenhum e ainda errava quando o telefone
 * estava salvo com máscara, porque o trecho procurado não fica contíguo.
 */

/** Só os dígitos do que foi digitado. */
export function somenteDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '')
}

/**
 * Forma canônica para comparar: sem máscara e sem o código do país.
 * `+55 (86) 98811-0001`, `5586988110001` e `(86) 98811-0001` viram
 * `86988110001`.
 */
export function telefoneComparavel(valor: string | null | undefined): string {
  const digitos = somenteDigitos(valor)
  // 55 + DDD (2) + número (8 ou 9) = 12 ou 13 dígitos.
  if (digitos.length >= 12 && digitos.length <= 13 && digitos.startsWith('55')) {
    return digitos.slice(2)
  }
  return digitos
}

/** Compara dois telefones escritos de formas diferentes. */
export function telefonesIguais(a: string | null | undefined, b: string | null | undefined): boolean {
  const primeiro = telefoneComparavel(a)
  const segundo = telefoneComparavel(b)
  return primeiro.length > 0 && primeiro === segundo
}

/**
 * O que consultar no banco a partir do que o operador digitou.
 *
 * `exato` é o valor de `phone_digits` (busca pelo índice único). `parcial`
 * existe só como segunda tentativa, para quem digita o número sem o DDD:
 * aí a busca é pelo final do telefone, que não usa índice — por isso ela é
 * o caminho raro, não o normal.
 */
export function buscaPorTelefone(valor: string): { exato: string; parcial: string } | null {
  const exato = telefoneComparavel(valor)
  if (exato.length < 10) return null
  return { exato, parcial: exato.slice(-9) }
}
