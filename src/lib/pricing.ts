/**
 * Prévia de preço no navegador.
 *
 * IMPORTANTE: esta é apenas uma PRÉVIA para o operador conferir o valor na
 * tela. O preço oficial é SEMPRE calculado no servidor pela RPC `create_order`
 * (migração 0007), que relê o cardápio no momento do pedido e grava os valores
 * como snapshot histórico. Este módulo existe para que a prévia use exatamente
 * as mesmas regras — e é coberto por testes automatizados.
 *
 * Regras espelhadas do banco:
 *   * item simples   → preço do tamanho escolhido (variant);
 *   * pizza 1 sabor  → preço do sabor no tamanho escolhido;
 *   * pizza 2 sabores→ `business_settings.half_and_half_price_rule`:
 *                      'highest' = maior preço; 'average' = média arredondada;
 *   * adicionais     → somados por unidade.
 */

import type { ModifierOption, ProductVariant } from './types'

export type HalfRule = 'highest' | 'average'
export type PricingRule = 'single' | 'highest' | 'average'

export interface PreviewInput {
  /** Tipo do produto: pizza aceita sabores. */
  kind: 'simple' | 'pizza'
  /** Variante (produto + tamanho) escolhida — define o tamanho. */
  variantId: string | null
  /** Outros sabores escolhidos (sem incluir o principal). */
  flavorProductIds: string[]
  /** Adicionais escolhidos. */
  optionIds: string[]
  halfRule: HalfRule
  variants: ProductVariant[]
  options: ModifierOption[]
}

export interface PreviewResult {
  unit_cents: number
  base_cents: number
  modifiers_cents: number
  pricing_rule: PricingRule
}

export function computeItemPreview(input: PreviewInput): PreviewResult {
  const base = input.variants.find((variant) => variant.id === input.variantId)
  if (!base) {
    return { unit_cents: 0, base_cents: 0, modifiers_cents: 0, pricing_rule: 'single' }
  }

  const modifiers_cents = totalModifiers(input.optionIds, input.options)

  // Item simples, ou pizza sem sabor adicional informado.
  if (input.kind !== 'pizza' || input.flavorProductIds.length === 0) {
    return {
      unit_cents: base.price_cents + modifiers_cents,
      base_cents: base.price_cents,
      modifiers_cents,
      pricing_rule: 'single',
    }
  }

  const prices = [
    base.price_cents,
    ...input.flavorProductIds.map((flavorId) => priceOfFlavor(flavorId, base.size_id, input.variants)),
  ]

  let base_cents: number
  let pricing_rule: PricingRule
  if (prices.length === 1) {
    base_cents = prices[0]
    pricing_rule = 'single'
  } else if (input.halfRule === 'highest') {
    base_cents = Math.max(...prices)
    pricing_rule = 'highest'
  } else {
    base_cents = Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length)
    pricing_rule = 'average'
  }

  return { unit_cents: base_cents + modifiers_cents, base_cents, modifiers_cents, pricing_rule }
}

/** Preço do sabor no MESMO tamanho da variante principal (0 se não vendido nesse tamanho). */
export function priceOfFlavor(productId: string, sizeId: string, variants: ProductVariant[]): number {
  const variant = variants.find(
    (candidate) => candidate.product_id === productId && candidate.size_id === sizeId && candidate.is_available,
  )
  return variant?.price_cents ?? 0
}

export function totalModifiers(optionIds: string[], options: ModifierOption[]): number {
  return optionIds.reduce((sum, optionId) => {
    const option = options.find((candidate) => candidate.id === optionId)
    return sum + (option?.price_cents ?? 0)
  }, 0)
}

/** Total do carrinho (prévia) em centavos. */
export function cartSubtotalPreview(items: { quantity: number; preview: { unit_price_cents: number } }[]): number {
  return items.reduce((total, item) => total + item.preview.unit_price_cents * item.quantity, 0)
}
