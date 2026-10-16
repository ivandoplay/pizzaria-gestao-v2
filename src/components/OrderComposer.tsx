import { useMemo, useState } from 'react'
import { Button, Callout, EmptyState, Field, IconButton, Modal, QtyStepper, SearchInput, Textarea } from './ui'
import { Icon, type NomeIcone } from './icons'
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
  /**
   * Empilha catálogo e lista do pedido em vez de colocá-los lado a lado.
   *
   * Serve para quando o compositor entra numa coluna estreita (a tela da mesa
   * no computador): o lado a lado precisa de ~900px, e sem largura o catálogo
   * virava uma grade de 3 colunas de 70px com o nome do produto quebrado letra
   * por letra. O conteúdo e as regras são os mesmos — muda só o arranjo.
   */
  empilhado?: boolean
}

/** Ícone por tipo de produto — ajuda a achar a categoria no meio do cardápio. */
const ICONE_CATEGORIA: { chave: RegExp; icone: NomeIcone }[] = [
  { chave: /pizza/i, icone: 'pizza' },
  { chave: /bebida|refrigerante|suco|água|agua/i, icone: 'bebida' },
  { chave: /lanche|burg|sandu/i, icone: 'lanche' },
  { chave: /porç|porc|petisco/i, icone: 'talheres' },
  { chave: /sobremesa|doce|sorvete/i, icone: 'pizza' },
]

function iconeDaCategoria(nome: string | null | undefined): NomeIcone {
  const achado = ICONE_CATEGORIA.find((item) => item.chave.test(nome ?? ''))
  return achado?.icone ?? 'cardapio'
}

/**
 * Compositor de itens do pedido: produto → tamanho → sabores → adicionais →
 * quantidade → observações.
 *
 * IMPORTANTE: os valores exibidos aqui são uma PRÉVIA para o atendimento. O valor
 * oficial é sempre recalculado pelo servidor (RPC create_order) a partir do
 * catálogo — nenhum preço enviado pelo navegador é aceito.
 */
export function OrderComposer({ menu, halfRule, items, onChange, disabled, empilhado = false }: Props) {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selecionado, setSelecionado] = useState<Product | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const activeCategories = menu.categories.filter((category) => category.is_active)
  const nomeCategoria = (id: string) => activeCategories.find((category) => category.id === id)?.name ?? null

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
      .sort(
        (a, b) =>
          (nomeCategoria(a.category_id) ?? '').localeCompare(nomeCategoria(b.category_id) ?? '') ||
          a.sort_order - b.sort_order ||
          a.name.localeCompare(b.name),
      )
  }, [categoryId, menu.products, search])

  const precoMinimo = (productId: string) => {
    const precos = menu.variants
      .filter((variant) => variant.product_id === productId && variant.is_available)
      .map((variant) => variant.price_cents)
    return precos.length > 0 ? Math.min(...precos) : 0
  }

  const subtotal = cartSubtotalPreview(items)

  /**
   * Item "de um toque": tem um único tamanho/preço e nenhum grupo de escolha
   * obrigatório. Nesses casos o garçom adiciona direto da grade, sem abrir a
   * janela de montagem — é o que mais pesa no meio do salão cheio.
   */
  function varianteUnica(productId: string) {
    const doProduto = menu.variants.filter((variante) => variante.product_id === productId && variante.is_available)
    return doProduto.length === 1 ? doProduto[0] : null
  }

  function podeAdicionarDireto(product: Product) {
    if (product.kind === 'pizza') return false
    if (!varianteUnica(product.id)) return false
    const gruposDoProduto = menu.links
      .filter((link) => link.product_id === product.id)
      .map((link) => link.group_id)
    // Só é direto quando nenhum grupo exige escolha.
    return gruposDoProduto.every(
      (groupId) => (menu.groups.find((grupo) => grupo.id === groupId)?.min_select ?? 0) === 0,
    )
  }

  function adicionarDireto(product: Product) {
    const variante = varianteUnica(product.id)
    if (!variante) return
    const tamanho = menu.sizes.find((size) => size.id === variante.size_id) ?? null
    const novo: CartItem = {
      key: newClientUuid(),
      product_id: product.id,
      variant_id: variante.id,
      quantity: 1,
      notes: '',
      flavor_product_ids: [],
      modifier_option_ids: [],
      preview: {
        product_name: product.name,
        size_name: tamanho ? `${tamanho.name}${tamanho.slices ? ` · ${tamanho.slices} fatias` : ''}` : '',
        flavors: [product.name],
        modifiers: [],
        unit_price_cents: computeItemPreview({
          kind: product.kind,
          variantId: variante.id,
          flavorProductIds: [],
          optionIds: [],
          halfRule,
          variants: menu.variants,
          options: menu.options,
        }).unit_cents,
      },
    }
    onChange([...items, novo])
    setAviso(`“${product.name}” adicionado à lista`)
    window.setTimeout(() => setAviso(null), 2500)
  }

  function alterarQuantidade(key: string, quantidade: number) {
    onChange(items.map((item) => (item.key === key ? { ...item, quantity: quantidade } : item)))
  }

  return (
    <div className={empilhado ? "space-y-4" : "grid gap-4 lg:grid-cols-[1fr_320px]"} data-empilhado={empilhado ? 'true' : undefined}>
      {/* Catálogo */}
      <div className="min-w-0 space-y-3">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Buscar item do cardápio…" />

        <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => setCategoryId(null)}
            className={`min-h-[44px] shrink-0 rounded-full border px-4 py-2.5 text-xs font-medium transition sm:min-h-0 sm:px-3 sm:py-1.5 ${
              categoryId === null
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-300 bg-white text-ink-600 hover:border-ink-400'
            }`}
          >
            Todos os itens
          </button>
          {activeCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setCategoryId(category.id)}
              className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 py-2.5 text-xs font-medium transition sm:min-h-0 sm:px-3 sm:py-1.5 ${
                categoryId === category.id
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ink-300 bg-white text-ink-600 hover:border-ink-400'
              }`}
            >
              <Icon nome={iconeDaCategoria(category.name)} className="h-3.5 w-3.5" />
              {category.name}
            </button>
          ))}
        </div>

        {productsOfCategory.length === 0 ? (
          <EmptyState
            icone="busca"
            title="Nenhum item encontrado"
            description="Ajuste a busca ou escolha outra categoria. Itens indisponíveis não aparecem no lançamento."
          />
        ) : (
          <>
            {aviso && (
              <p
                role="status"
                className="animate-fade-in mb-2 flex items-center gap-2 rounded-control bg-emerald-50 px-3 py-2 text-pequeno font-medium text-emerald-800"
              >
                <Icon nome="check" className="h-4 w-4" />
                {aviso}
              </p>
            )}
            <div className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 ${empilhado ? '' : 'xl:grid-cols-3'}`}>
            {productsOfCategory.map((product) => (
              <button
                key={product.id}
                type="button"
                disabled={disabled}
                onClick={() => (podeAdicionarDireto(product) ? adicionarDireto(product) : setSelecionado(product))}
                className="grade-navegavel relative flex h-full min-h-[88px] flex-col justify-between gap-2 rounded-card border border-ink-200 bg-white p-3 text-left shadow-card transition duration-150 ease-smooth hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-raised active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {podeAdicionarDireto(product) && !disabled && (
                  <span
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-700"
                    aria-hidden
                  >
                    <Icon nome="mais" className="h-4 w-4" />
                  </span>
                )}
                <span className="flex items-start gap-2 pr-8">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
                    <Icon nome={iconeDaCategoria(nomeCategoria(product.category_id))} className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold leading-snug text-ink-900">{product.name}</span>
                    {product.description && (
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-ink-500">
                        {product.description}
                      </span>
                    )}
                  </span>
                </span>
                <span className="num text-xs font-semibold text-brand-700">
                  {product.kind === 'pizza' ? 'a partir de ' : ''}
                  {formatMoney(precoMinimo(product.id))}
                </span>
              </button>
            ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
              Itens com <strong className="font-semibold text-ink-600">+</strong> entram na lista com um toque (tamanho
              único e sem escolha obrigatória). Os demais abrem a montagem — pizza, tamanhos e adicionais.
            </p>
          </>
        )}
      </div>

      {/* Lista do pedido */}
      <div className={`h-fit min-w-0 rounded-card border border-ink-200 bg-white shadow-card ${empilhado ? '' : 'lg:sticky lg:top-24'}`}>
        <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <Icon nome="sacola" className="h-4 w-4 text-ink-500" />
            <h3 className="text-[13px] font-semibold text-ink-900">Lista do pedido</h3>
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600">
              {items.length}
            </span>
          </div>
          {items.length > 0 && !disabled && (
            <Button variant="ghost" size="sm" icone="lixeira" onClick={() => onChange([])}>
              Limpar
            </Button>
          )}
        </header>

        <div className="p-3.5">
          {items.length === 0 ? (
            <EmptyState
              icone="sacola"
              title="Lista vazia"
              description="Escolha um item do cardápio para começar a montar o pedido."
            />
          ) : (
            <div className="space-y-2.5">
              {items.map((item) => (
                <div key={item.key} className="rounded-control border border-ink-200 bg-white p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold leading-snug text-ink-900">
                        {item.preview.product_name}
                      </p>
                      <p className="text-[11px] text-ink-500">{item.preview.size_name}</p>
                      {item.preview.flavors.length > 1 && (
                        <p className="text-[11px] text-ink-500">
                          Sabores: {item.preview.flavors.join(' + ')}
                        </p>
                      )}
                      {item.preview.modifiers.length > 0 && (
                        <p className="text-[11px] text-ink-500">
                          {item.preview.modifiers.map((modifier) => modifier.name).join(', ')}
                        </p>
                      )}
                      {item.notes && <p className="text-[11px] italic text-ink-500">“{item.notes}”</p>}
                    </div>
                    {!disabled && (
                      <IconButton
                        nome="fechar"
                        titulo="Remover item da lista"
                        size="sm"
                        variant="ghost"
                        className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => onChange(items.filter((other) => other.key !== item.key))}
                      />
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <QtyStepper
                      value={item.quantity}
                      min={1}
                      max={50}
                      disabled={disabled}
                      onChange={(quantidade) => alterarQuantidade(item.key, quantidade)}
                    />
                    <span className="num text-sm font-semibold text-ink-900">
                      {formatMoney(item.preview.unit_price_cents * item.quantity)}
                    </span>
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between border-t border-ink-200 pt-2.5 text-sm">
                <span className="text-ink-500">Subtotal (prévia)</span>
                <span className="num font-semibold text-ink-900">{formatMoney(subtotal)}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-500">
                O valor final é recalculado pelo servidor no momento do envio, com o preço vigente no banco.
              </p>
              {/* A promessa de quem envia fica junto da lista: na barra de envio
                  ela empurrava o botão para fora da tela no celular. */}
              <p className="flex items-start gap-1.5 text-[11px] leading-snug text-ink-500">
                <Icon nome="cadeado" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                O envio é idempotente: cliques repetidos não duplicam o pedido.
              </p>
            </div>
          )}
        </div>
      </div>

      {selecionado && (
        <ProductModal
          product={selecionado}
          menu={menu}
          halfRule={halfRule}
          onClose={() => setSelecionado(null)}
          onAdd={(item) => {
            onChange([...items, item])
            setSelecionado(null)
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
  const sizes = menu.sizes.filter((size) => size.is_active)
  const variants = menu.variants.filter((variant) => variant.product_id === product.id && variant.is_available)

  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null)
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')
  const [flavorIds, setFlavorIds] = useState<string[]>([])
  const [optionIds, setOptionIds] = useState<string[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [buscaSabor, setBuscaSabor] = useState('')

  const variant = variants.find((item) => item.id === variantId) ?? null
  const size = variant ? (sizes.find((item) => item.id === variant.size_id) ?? null) : null

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
      .filter((entry) => entry.options.length > 0)
  }, [menu.groups, menu.links, menu.options, product.id])

  const otherPizzaFlavors = useMemo(() => {
    if (product.kind !== 'pizza' || !size) return []
    const termo = buscaSabor.trim().toLowerCase()
    return menu.products
      .filter((other) => other.kind === 'pizza' && other.id !== product.id && other.is_active && other.is_available)
      .filter((other) =>
        menu.variants.some(
          (candidate) => candidate.product_id === other.id && candidate.size_id === size.id && candidate.is_available,
        ),
      )
      .filter((other) => (termo ? other.name.toLowerCase().includes(termo) : true))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [menu.products, menu.variants, product.id, product.kind, size, buscaSabor])

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
    setErro(null)
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
    setErro(null)
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
      setErro('Escolha o tamanho do item antes de adicionar.')
      return
    }

    for (const { group, options } of availableGroups) {
      const escolhidas = options.filter((option) => optionIds.includes(option.id)).length
      if (escolhidas < group.min_select) {
        setErro(`Escolha ao menos ${group.min_select} opção(ões) em “${group.name}”.`)
        return
      }
      if (escolhidas > group.max_select) {
        setErro(`O grupo “${group.name}” aceita no máximo ${group.max_select} opção(ões).`)
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
        size_name: `${size.name}${product.kind === 'pizza' && size.slices ? ` · ${size.slices} fatias` : ''}`,
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
      descricao={product.description ?? undefined}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icone="mais" onClick={handleAdd}>
            Adicionar · {formatMoney(previewUnit * quantity)}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {variants.length === 0 && (
          <Callout tom="erro" titulo="Item sem preço cadastrado">
            Este item não tem tamanho/preço disponível no cardápio. Ajuste o cardápio antes de lançá-lo.
          </Callout>
        )}

        <Field label="Tamanho" obrigatorio>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {variants.map((candidate) => {
              const candidateSize = sizes.find((item) => item.id === candidate.size_id)
              if (!candidateSize) return null
              const ativo = variantId === candidate.id
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => {
                    setVariantId(candidate.id)
                    setFlavorIds([])
                    setErro(null)
                  }}
                  aria-pressed={ativo}
                  className={`rounded-control border px-3 py-2 text-left text-xs transition ${
                    ativo
                      ? 'border-brand-600 bg-brand-50 text-brand-800 shadow-sm'
                      : 'border-ink-300 bg-white text-ink-700 hover:border-ink-400'
                  }`}
                >
                  <span className="block font-semibold">{candidateSize.name}</span>
                  <span className="num block">{formatMoney(candidate.price_cents)}</span>
                  {candidateSize.kind === 'pizza' && candidateSize.slices ? (
                    <span className="block text-[10px] text-ink-500">
                      {candidateSize.slices} fatias
                      {candidateSize.max_flavors > 1 ? ` · até ${candidateSize.max_flavors} sabores` : ''}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </Field>

        {product.kind === 'pizza' && maxFlavors > 1 && (
          <Field
            label={`Segundo sabor (opcional — regra de preço: ${
              halfRule === 'highest' ? 'sabor mais caro' : 'média dos sabores'
            })`}
            hint={flavorIds.length > 0 ? 'Clique novamente para remover o sabor escolhido.' : 'Meio a meio: escolha um segundo sabor.'}
          >
            <div className="space-y-2">
              <SearchInput
                value={buscaSabor}
                onValueChange={setBuscaSabor}
                placeholder="Buscar sabor…"
              />
              <div className="scroll-thin max-h-44 space-y-1 overflow-y-auto rounded-control border border-ink-200 p-2">
                {otherPizzaFlavors.length === 0 ? (
                  <p className="p-2 text-xs text-ink-500">Nenhum outro sabor disponível neste tamanho.</p>
                ) : (
                  otherPizzaFlavors.map((flavor) => {
                    const escolhido = flavorIds.includes(flavor.id)
                    const preco = menu.variants.find(
                      (candidate) => candidate.product_id === flavor.id && candidate.size_id === size?.id,
                    )?.price_cents
                    return (
                      <button
                        key={flavor.id}
                        type="button"
                        onClick={() => toggleFlavor(flavor.id)}
                        aria-pressed={escolhido}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                          escolhido ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200' : 'hover:bg-ink-50'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              escolhido ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300'
                            }`}
                          >
                            {escolhido && <Icon nome="check" className="h-3 w-3" />}
                          </span>
                          <span className="truncate">{flavor.name}</span>
                        </span>
                        {preco !== undefined && <span className="num text-xs text-ink-500">{formatMoney(preco)}</span>}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </Field>
        )}

        {availableGroups.map(({ group, options }) => {
          const escolhidas = options.filter((option) => optionIds.includes(option.id)).length
          return (
            <Field
              key={group.id}
              label={group.name}
              obrigatorio={group.min_select > 0}
              hint={`Escolha ${group.min_select > 0 ? `de ${group.min_select}` : 'até'} ${group.max_select} · selecionados: ${escolhidas}`}
            >
              <div className="flex flex-wrap gap-2">
                {options.map((option) => {
                  const ativo = optionIds.includes(option.id)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleOption(group, option.id)}
                      aria-pressed={ativo}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
                        ativo
                          ? 'border-brand-600 bg-brand-50 text-brand-800'
                          : 'border-ink-300 bg-white text-ink-700 hover:border-ink-400'
                      }`}
                    >
                      {ativo && <Icon nome="check" className="h-3 w-3" />}
                      {option.name}
                      {option.price_cents > 0 && (
                        <span className="num font-medium">+{formatMoney(option.price_cents)}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </Field>
          )
        })}

        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          <Field label="Quantidade">
            <QtyStepper value={quantity} min={1} max={50} onChange={setQuantity} />
          </Field>
          <Field label="Observações" hint="Vão para a comanda da produção.">
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="ex.: sem cebola, cortar em 8, embalar separado…"
              className="min-h-[44px]"
            />
          </Field>
        </div>

        {erro && <Callout tom="erro">{erro}</Callout>}

        <div className="rounded-card border border-ink-200 bg-ink-50/70 p-3.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-ink-600">
              Prévia do item
              {preview.pricing_rule !== 'single' && (
                <span className="ml-1 text-[11px] text-ink-500">
                  ({preview.pricing_rule === 'highest' ? 'sabor mais caro' : 'média dos sabores'})
                </span>
              )}
            </span>
            <span className="num font-semibold text-ink-900">{formatMoney(previewUnit * quantity)}</span>
          </div>
          {quantity > 1 && (
            <p className="mt-0.5 text-right text-[11px] text-ink-500">
              {formatMoney(previewUnit)} por unidade
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
