/**
 * Regras de dinheiro do recebimento que a tela precisa antecipar.
 *
 * O banco é a fonte oficial (`orders.total_cents`, `orders.paid_cents`,
 * `register_payment`). Estas funções existem para a interface mostrar o MESMO
 * número que o banco vai validar — sem repetir subtração em dois lugares.
 */

/**
 * Saldo pendente de um pedido: total menos o que já foi recebido.
 *
 * A conta é feita UMA vez. Quem chama deve passar os dois valores crus do
 * pedido (`total_cents` e `paid_cents`), nunca um saldo já subtraído — foi
 * exatamente essa mistura que fazia o painel cobrar menos do que devia.
 */
export function saldoPendenteCents(totalCents: number, paidCents: number): number {
  if (!Number.isFinite(totalCents) || !Number.isFinite(paidCents)) return 0
  return Math.max(Math.trunc(totalCents) - Math.trunc(paidCents), 0)
}
