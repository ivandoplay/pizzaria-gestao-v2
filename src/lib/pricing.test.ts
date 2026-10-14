import { describe, expect, it } from 'vitest'
import { cartSubtotalPreview, computeItemPreview, priceOfFlavor, totalModifiers } from './pricing'
import type { ModifierOption, ProductVariant } from './types'

// ---------------------------------------------------------------------------
// Fixtures equivalentes ao banco de testes (supabase/tests/00_setup.sql):
//   Pizza A: P=3000, G=5000 · Pizza B: P=2500, G=4000
//   Bordas: Catupiry 500, Cheddar 600 · Obrigatório: Queijo 300, Bacon 400
// ---------------------------------------------------------------------------
const SIZE_P = 'size-p'
const SIZE_G = 'size-g'

const PIZZA_A = 'pizza-a'
const PIZZA_B = 'pizza-b'

const variants: ProductVariant[] = [
  { id: 'va-p', product_id: PIZZA_A, size_id: SIZE_P, price_cents: 3000, is_available: true },
  { id: 'va-g', product_id: PIZZA_A, size_id: SIZE_G, price_cents: 5000, is_available: true },
  { id: 'vb-g', product_id: PIZZA_B, size_id: SIZE_G, price_cents: 4000, is_available: true },
  { id: 'vb-madeira-g', product_id: 'pizza-madeira', size_id: SIZE_G, price_cents: 6100, is_available: false },
]

const options: ModifierOption[] = [
  { id: 'opt-catupiry', group_id: 'g-borda', name: 'Borda de Catupiry', price_cents: 500, is_available: true, sort_order: 1 },
  { id: 'opt-cheddar', group_id: 'g-borda', name: 'Borda de Cheddar', price_cents: 600, is_available: true, sort_order: 2 },
  { id: 'opt-queijo', group_id: 'g-obrig', name: 'Extra queijo', price_cents: 300, is_available: true, sort_order: 1 },
  { id: 'opt-bacon', group_id: 'g-obrig', name: 'Extra bacon', price_cents: 400, is_available: true, sort_order: 2 },
]

describe('prévia de preço (mesmas regras da RPC create_order)', () => {
  it('item simples usa o preço do tamanho e soma adicionais', () => {
    const result = computeItemPreview({
      kind: 'simple',
      variantId: 'va-g',
      flavorProductIds: [],
      optionIds: ['opt-queijo'],
      halfRule: 'highest',
      variants,
      options,
    })
    expect(result).toEqual({ unit_cents: 5300, base_cents: 5000, modifiers_cents: 300, pricing_rule: 'single' })
  })

  it('pizza de um sabor não aplica regra de meio a meio', () => {
    const result = computeItemPreview({
      kind: 'pizza',
      variantId: 'va-p',
      flavorProductIds: [],
      optionIds: [],
      halfRule: 'highest',
      variants,
      options,
    })
    expect(result.base_cents).toBe(3000)
    expect(result.pricing_rule).toBe('single')
  })

  it('meio a meio com regra "maior valor" cobra o sabor mais caro', () => {
    const result = computeItemPreview({
      kind: 'pizza',
      variantId: 'vb-g',
      flavorProductIds: [PIZZA_A],
      optionIds: [],
      halfRule: 'highest',
      variants,
      options,
    })
    expect(result.base_cents).toBe(5000) // Pizza A G (5000) x Pizza B G (4000)
    expect(result.pricing_rule).toBe('highest')
    expect(result.unit_cents).toBe(5000)
  })

  it('meio a meio com regra "média" arredonda a média dos sabores', () => {
    const result = computeItemPreview({
      kind: 'pizza',
      variantId: 'vb-g',
      flavorProductIds: [PIZZA_A],
      optionIds: [],
      halfRule: 'average',
      variants,
      options,
    })
    expect(result.base_cents).toBe(4500) // (5000 + 4000) / 2
    expect(result.pricing_rule).toBe('average')
  })

  it('arredonda a média para cima quando há centavo ímpar', () => {
    const oddVariants: ProductVariant[] = [
      ...variants,
      { id: 'vc-g', product_id: 'pizza-c', size_id: SIZE_G, price_cents: 4101, is_available: true },
    ]
    const result = computeItemPreview({
      kind: 'pizza',
      variantId: 'vb-g',
      flavorProductIds: ['pizza-c'],
      optionIds: [],
      halfRule: 'average',
      variants: oddVariants,
      options,
    })
    expect(result.base_cents).toBe(4051) // (4000 + 4101)/2 = 4050.5 → 4051
  })

  it('soma borda + adicional obrigatório no total do item', () => {
    // Valor de referência do banco: pizza G (5000) + borda (500) + queijo (300) = 5800
    const result = computeItemPreview({
      kind: 'pizza',
      variantId: 'va-g',
      flavorProductIds: [],
      optionIds: ['opt-catupiry', 'opt-queijo'],
      halfRule: 'highest',
      variants,
      options,
    })
    expect(result.unit_cents).toBe(5800)
    expect(result.modifiers_cents).toBe(800)
  })

  it('sabor sem preço no tamanho escolhido contribui com zero (o servidor recusa)', () => {
    // Pizza B não tem tamanho P cadastrado nas fixtures → prévia não inventa preço.
    expect(priceOfFlavor(PIZZA_B, SIZE_P, variants)).toBe(0)
  })

  it('ignora variante indisponível ao buscar o preço do sabor', () => {
    expect(priceOfFlavor('pizza-madeira', SIZE_G, variants)).toBe(0)
  })

  it('sem variante escolhida, a prévia é zero (nada é adicionado ao carrinho)', () => {
    const result = computeItemPreview({
      kind: 'pizza',
      variantId: null,
      flavorProductIds: [],
      optionIds: [],
      halfRule: 'highest',
      variants,
      options,
    })
    expect(result.unit_cents).toBe(0)
  })

  it('adicionais desconhecidos são ignorados na soma', () => {
    expect(totalModifiers(['opt-queijo', 'nao-existe'], options)).toBe(300)
  })

  it('subtotal do carrinho considera a quantidade de cada item', () => {
    const items = [
      { quantity: 1, preview: { unit_price_cents: 5800 } },
      { quantity: 2, preview: { unit_price_cents: 700 } },
    ]
    expect(cartSubtotalPreview(items)).toBe(7200) // valor de referência da suíte SQL (04)
  })
})
