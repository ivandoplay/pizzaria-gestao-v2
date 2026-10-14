import { useMemo, useState } from 'react'
import { Button, Card, EmptyState, Field, Input, Modal, Textarea, useToast } from './ui'
import type { CartItem, Category, ModifierGroup, ModifierOption, Product, ProductSize, ProductVariant } from '../lib/types'
import { formatMoney, newClientUuid } from '../lib/format'
import { cartSubtotalPreview, computeItemPreview } from '../lib/pricing'

export interface MenuData {
  categories: Category[]
  products: Product[]
  sizes: ProductSize[]
  variants: ProductVariant[]
  groups: ModifierGroup[]
  options: ModifierOption[]
  links: { product_id: string; group_id: string }[]
}

interface Props {
  menu: MenuData
  /** Regra de meio a meio vigente (vem das configurações reais do banco). */
  halfRule: 'highest' | 'average'
  items: CartItem[]
  onChange: (items: CartItem[]) => void
  disabled?: boolean
}

/**
 * Compositor de itens do pedido: produto → tamanho → sabores → adicionais →
 * quantidade → observações.
 *
 * IMPORTANTE: os valores exibidos aqui são uma PRÉVIA para o atendimento. O valor
 * oficial é sempre recalculado pelo servidor (RPC create_order) a partir do
 * catálogo — nenhum preço enviado pelo navegador é aceito.
 */
export function OrderComposer({ menu, halfRule, items, onChange, disabled }: Props) {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)

  const activeCategories = menu.categories.filter((category) => category.is_active)
  const productsOfCategory = useMemo(() => {
    const term = search.trim().toLowerCase()
    return menu.products
      .filter((product) => product.is_active && product.is_available)
      .filter((product) => (categoryId ? product.category_id === categoryId : true))
      .filter((product) =>
        term.length === 0
          ? true
          : product.name.toLowerCase().includes(term) || (product.description ?? '').toLowerCase().includes(term),
      )
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  }, [categoryId, menu.products, search])

  const pricesOfProduct = (productId: string) => {
    const variants = menu.variants.filter((variant) => variant.product_id === productId && variant.is_available)
    const prices = variants.map((variant) => variant.price_cents)
    return prices.length > 0 ? Math.min(...prices) : 0
  }

  const subtotal = cartSubtotalPreview(items)

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
      {/* Catálogo */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Buscar produto pelo nome…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="sm:max-w-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCategoryId(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                categoryId === null ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-300'
              }`}
            >
              Todas
            </button>
            {activeCategories.map((category) => (
              <button
                key={category.id}
                onClick={() => setCategoryId(category.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  categoryId === category.id
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-300'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>

        {productsOfCategory.length === 0 ? (
          <EmptyState
            title="Nenhum produto disponível"
            description="Ajuste a busca/categoria ou verifique a disponibilidade do cardápio."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {productsOfCategory.map((product) => (
              <button
                key={product.id}
                disabled={disabled}
                onClick={() => setSelected(product)}
                className="flex h-full flex-col justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-brand-400 hover:shadow disabled:opacity-50"
              >
                <span className="text-sm font-medium text-slate-800">{product.name}</span>
                <span className="flex items-center justify-between text-xs text-slate-500">
                  {product.kind === 'pizza' ? '🍕 Pizza' : 'Item'}
                  <span className="font-semibold text-brand-700">a partir de {formatMoney(pricesOfProduct(product.id))}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Carrinho */}
      <Card
        title={`Itens do pedido (${items.length})`}
        className="h-fit lg:sticky lg:top-20"
        actions={
          items.length > 0 && !disabled ? (
            <Button variant="ghost" size="sm" onClick={() => onChange([])}>
              Limpar
            </Button>
          ) : undefined
        }
      >
        {items.length === 0 ? (
          <EmptyState title="Nenhum item" description="Selecione um produto no cardápio ao lado." />
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.key} className="rounded-md border border-slate-200 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {item.quantity}× {item.preview.product_name}
                    </p>
                    <p className="text-[11px] text-slate-500">{item.preview.size_name}</p>
                    {item.preview.flavors.length > 1 && (
                      <p className="text-[11px] text-slate-500">Sabores: {item.preview.flavors.join(' + ')}</p>
                    )}
                    {item.preview.modifiers.length > 0 && (
                      <p className="text-[11px] text-slate-500">
                        {item.preview.modifiers.map((modifier) => modifier.name).join(', ')}
                      </p>
                    )}
                    {item.notes && <p className="text-[11px] italic text-slate-500">Obs.: {item.notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-800">
                      {formatMoney(item.preview.unit_price_cents * item.quantity)}
                    </p>
                    {!disabled && (
                      <button
                        onClick={() => onChange(items.filter((other) => other.key !== item.key))}
                        className="mt-1 text-[11px] text-red-600 hover:underline"
                      >
                        remover
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
              <span className="text-slate-600">Subtotal (prévia)</span>
              <span className="font-semibold text-slate-900">{formatMoney(subtotal)}</span>
            </div>
            <p className="text-[11px] text-slate-500">
              O valor final é calculado pelo servidor ao enviar o pedido.
            </p>
          </div>
        )}
      </Card>

      {selected && (
        <ProductModal
          product={selected}
          menu={menu}
          halfRule={halfRule}
          onClose={() => setSelected(null)}
          onAdd={(item) => {
            onChange([...items, item])
            setSelected(null)
          }}
        />
      )}
    </div>
  )
}

// ===========================================================================
// MODAL DE MONTAGEM DO ITEM
// ===========================================================================
function ProductModal({
  product,
  menu,
  halfRule,
  onClose,
  onAdd,
}: {
  product: Product
  menu: MenuData
  halfRule: 'highest' | 'average'
  onClose: () => void
  onAdd: (item: CartItem) => void
}) {
  const toast = useToast()
  const sizes = menu.sizes.filter((size) => size.is_active)
  const variants = menu.variants.filter((variant) => variant.product_id === product.id && variant.is_available)

  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null)
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')
  const [flavorIds, setFlavorIds] = useState<string[]>([])
  const [optionIds, setOptionIds] = useState<string[]>([])

  const variant = variants.find((item) => item.id === variantId) ?? null
  const size = variant ? sizes.find((item) => item.id === variant.size_id) ?? null : null

  const availableGroups = useMemo(() => {
    const linked = menu.links.filter((link) => link.product_id === product.id).map((link) => link.group_id)
    return menu.groups
      .filter((group) => group.is_active && linked.includes(group.id))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((group) => ({
        group,
        options: menu.options
          .filter((option) => option.group_id === group.id && option.is_available)
          .sort((a, b) => a.sort_order - b.sort_order),
      }))
  }, [menu.groups, menu.links, menu.options, product.id])

  const otherPizzaFlavors = useMemo(() => {
    if (product.kind !== 'pizza' || !size) return []
    return menu.products
      .filter((other) => other.kind === 'pizza' && other.id !== product.id && other.is_active && other.is_available)
      .filter((other) =>
        menu.variants.some(
          (candidate) => candidate.product_id === other.id && candidate.size_id === size.id && candidate.is_available,
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [menu.products, menu.variants, product.id, product.kind, size])

  const maxFlavors = product.kind === 'pizza' && size ? size.max_flavors : 1

  /** Prévia do preço — a regra oficial é a do servidor (ver lib/pricing.ts). */
  const preview = useMemo(
    () =>
      computeItemPreview({
        kind: product.kind,
        variantId,
        flavorProductIds: flavorIds,
        optionIds,
        halfRule,
        variants: menu.variants,
        options: menu.options,
      }),
    [flavorIds, halfRule, menu.options, menu.variants, optionIds, product.kind, variantId],
  )
  const previewUnit = preview.unit_cents

  function toggleFlavor(flavorId: string) {
    setFlavorIds((current) => {
      if (current.includes(flavorId)) return current.filter((id) => id !== flavorId)
      if (current.length + 1 >= maxFlavors) {
        // mantém apenas o último escolhido (meio a meio = 1 sabor adicional)
        return [...current.slice(-(maxFlavors - 2)), flavorId]
      }
      return [...current, flavorId]
    })
  }

  function toggleOption(group: ModifierGroup, optionId: string) {
    setOptionIds((current) => {
      const groupOptionIds = menu.options.filter((option) => option.group_id === group.id).map((option) => option.id)
      const selectedInGroup = current.filter((id) => groupOptionIds.includes(id))

      if (current.includes(optionId)) return current.filter((id) => id !== optionId)
      if (selectedInGroup.length >= group.max_select) {
        if (group.max_select === 1) {
          return [...current.filter((id) => !groupOptionIds.includes(id)), optionId]
        }
        return current
      }
      return [...current, optionId]
    })
  }

  function handleAdd() {
    if (!variant || !size) {
      toast.error('Selecione o tamanho do produto.')
      return
    }

    for (const { group, options } of availableGroups) {
      const chosen = options.filter((option) => optionIds.includes(option.id)).length
      if (chosen < group.min_select) {
        toast.error(`Escolha ao menos ${group.min_select} opção(ões) em "${group.name}".`)
        return
      }
      if (chosen > group.max_select) {
        toast.error(`O grupo "${group.name}" aceita no máximo ${group.max_select} opção(ões).`)
        return
      }
    }

    const flavorNames = [
      product.name,
      ...flavorIds.map((id) => menu.products.find((candidate) => candidate.id === id)?.name ?? ''),
    ].filter(Boolean)

    const chosenModifiers = optionIds
      .map((id) => menu.options.find((option) => option.id === id))
      .filter((option): option is ModifierOption => Boolean(option))
      .map((option) => ({ name: option.name, price_cents: option.price_cents }))

    onAdd({
      key: newClientUuid(),
      product_id: product.id,
      variant_id: variant.id,
      quantity,
      notes: notes.trim(),
      flavor_product_ids: flavorIds,
      modifier_option_ids: optionIds,
      preview: {
        product_name: product.name,
        size_name: `${size.name}${product.kind === 'pizza' ? ` · ${size.slices ?? ''} fatias`.trim() : ''}`,
        flavors: flavorNames,
        modifiers: chosenModifiers,
        unit_price_cents: previewUnit,
      },
    })
  }

  return (
    <Modal
      open
      title={product.name}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleAdd}>Adicionar · {formatMoney(previewUnit * quantity)}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {product.description && <p className="text-sm text-slate-600">{product.description}</p>}

        <Field label="Tamanho">
          <div className="flex flex-wrap gap-2">
            {variants.map((candidate) => {
              const candidateSize = sizes.find((item) => item.id === candidate.size_id)
              if (!candidateSize) return null
              return (
                <button
                  key={candidate.id}
                  onClick={() => setVariantId(candidate.id)}
                  className={`rounded-md border px-3 py-2 text-left text-xs ${
                    variantId === candidate.id
                      ? 'border-brand-600 bg-brand-50 text-brand-800'
                      : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  <span className="block font-medium">{candidateSize.name}</span>
                  <span>{formatMoney(candidate.price_cents)}</span>
                </button>
              )
            })}
          </div>
        </Field>

        {product.kind === 'pizza' && maxFlavors > 1 && (
          <Field
            label={`Segundo sabor (opcional — regra atual: ${halfRule === 'highest' ? 'sabor mais caro' : 'média dos sabores'})`}
          >
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2 scroll-thin">
              {otherPizzaFlavors.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhum outro sabor disponível neste tamanho.</p>
              ) : (
                otherPizzaFlavors.map((flavor) => (
                  <label key={flavor.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={flavorIds.includes(flavor.id)}
                      onChange={() => toggleFlavor(flavor.id)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600"
                    />
                    {flavor.name}
                  </label>
                ))
              )}
            </div>
          </Field>
        )}

        {availableGroups.map(({ group, options }) => (
          <Field
            key={group.id}
            label={`${group.name}${group.min_select > 0 ? ' (obrigatório)' : ''} — máx. ${group.max_select}`}
          >
            <div className="flex flex-wrap gap-2">
              {options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => toggleOption(group, option.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs ${
                    optionIds.includes(option.id)
                      ? 'border-brand-600 bg-brand-50 text-brand-800'
                      : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  {option.name}
                  {option.price_cents > 0 && ` · +${formatMoney(option.price_cents)}`}
                </button>
              ))}
            </div>
          </Field>
        ))}

        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <Field label="Quantidade">
            <Input
              type="number"
              min={1}
              max={50}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
            />
          </Field>
          <Field label="Observações (opcional)">
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="ex.: sem cebola, cortar em 8, embalar separado…"
            />
          </Field>
        </div>

        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Prévia do item</span>
            <span className="font-semibold text-slate-900">{formatMoney(previewUnit * quantity)}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
