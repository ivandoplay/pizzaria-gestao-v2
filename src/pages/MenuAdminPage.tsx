import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMenu } from '../lib/hooks'
import * as api from '../lib/api'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Select,
  Textarea,
  useToast,
} from '../components/ui'
import { formatMoney, parseMoneyToCents } from '../lib/format'
import { translateError } from '../lib/errors'
import type { Category, ModifierGroup, ModifierOption, Product, ProductSize } from '../lib/types'

type Tab = 'produtos' | 'categorias' | 'tamanhos' | 'adicionais'

export default function MenuAdminPage() {
  const [tab, setTab] = useState<Tab>('produtos')
  const menu = useMenu()
  const queryClient = useQueryClient()

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['menu'] })

  if (menu.isLoading) return <LoadingBlock label="Carregando o cardápio…" />
  if (menu.error) return <ErrorBlock message={translateError(menu.error)} onRetry={() => void menu.refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['produtos', 'Produtos e preços'],
            ['categorias', 'Categorias'],
            ['tamanhos', 'Tamanhos'],
            ['adicionais', 'Adicionais'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <Button key={key} variant={tab === key ? 'primary' : 'secondary'} size="sm" onClick={() => setTab(key)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === 'produtos' && <ProductsTab menu={menu.data!} refresh={refresh} />}
      {tab === 'categorias' && <CategoriesTab categories={menu.data!.categories} refresh={refresh} />}
      {tab === 'tamanhos' && <SizesTab sizes={menu.data!.sizes} refresh={refresh} />}
      {tab === 'adicionais' && (
        <ModifiersTab
          groups={menu.data!.groups}
          options={menu.data!.options}
          products={menu.data!.products}
          links={menu.data!.links}
          refresh={refresh}
        />
      )}
    </div>
  )
}

// ===========================================================================
// PRODUTOS E PREÇOS
// ===========================================================================
function ProductsTab({ menu, refresh }: { menu: NonNullable<ReturnType<typeof useMenu>['data']>; refresh: () => void }) {
  const toast = useToast()
  const [editing, setEditing] = useState<Partial<Product> | null>(null)
  const [busy, setBusy] = useState(false)
  const [deactivating, setDeactivating] = useState<Product | null>(null)
  const [pricesFor, setPricesFor] = useState<Product | null>(null)

  const pizzaSizes = menu.sizes.filter((size) => size.kind === 'pizza' && size.is_active)
  const otherSizes = menu.sizes.filter((size) => size.kind === 'other' && size.is_active)

  async function save() {
    if (!editing?.name || !editing.category_id || !editing.kind) {
      toast.error('Informe nome, categoria e tipo do produto.')
      return
    }
    setBusy(true)
    try {
      await api.upsertProduct({
        id: editing.id,
        category_id: editing.category_id,
        name: editing.name.trim(),
        description: editing.description?.trim() || null,
        kind: editing.kind,
        is_available: editing.is_available ?? true,
        is_active: editing.is_active ?? true,
        sort_order: editing.sort_order ?? 0,
        image_url: editing.image_url ?? null,
      })
      toast.success('Produto salvo.')
      setEditing(null)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(product: Product) {
    setBusy(true)
    try {
      await api.upsertProduct({ ...product, is_active: !product.is_active })
      toast.success(product.is_active ? 'Produto desativado (histórico preservado).' : 'Produto reativado.')
      setDeactivating(null)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function toggleAvailable(product: Product) {
    try {
      await api.upsertProduct({ ...product, is_available: !product.is_available })
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    }
  }

  return (
    <>
      <Card
        title={`Produtos (${menu.products.length})`}
        actions={<Button size="sm" onClick={() => setEditing({ kind: 'simple', is_available: true, is_active: true })}>+ Novo produto</Button>}
      >
        <DataTable
          rows={menu.products}
          rowKey={(row) => row.id}
          emptyMessage="Nenhum produto cadastrado."
          columns={[
            {
              key: 'name',
              header: 'Produto',
              render: (row) => (
                <div>
                  <p className="font-medium text-slate-800">{row.name}</p>
                  {row.description && <p className="text-[11px] text-slate-500">{row.description}</p>}
                </div>
              ),
            },
            {
              key: 'category',
              header: 'Categoria',
              render: (row) => menu.categories.find((category) => category.id === row.category_id)?.name ?? '—',
            },
            { key: 'kind', header: 'Tipo', render: (row) => (row.kind === 'pizza' ? 'Pizza (sabores)' : 'Item simples') },
            {
              key: 'status',
              header: 'Situação',
              render: (row) => (
                <div className="flex flex-wrap gap-1">
                  <Badge tone={row.is_active ? 'green' : 'slate'}>{row.is_active ? 'Ativo' : 'Desativado'}</Badge>
                  <Badge tone={row.is_available ? 'blue' : 'amber'}>{row.is_available ? 'Disponível' : 'Indisponível'}</Badge>
                </div>
              ),
            },
            {
              key: 'prices',
              header: 'Preços',
              render: (row) => {
                const variants = menu.variants.filter((variant) => variant.product_id === row.id)
                return (
                  <div className="text-xs text-slate-600">
                    {variants.length === 0 ? (
                      <span className="text-amber-700">sem preço cadastrado</span>
                    ) : (
                      variants
                        .map((variant) => {
                          const size = menu.sizes.find((item) => item.id === variant.size_id)
                          return `${size?.name ?? '?'}: ${formatMoney(variant.price_cents)}`
                        })
                        .join(' · ')
                    )}
                  </div>
                )
              },
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) => (
                <div className="flex flex-wrap justify-end gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setPricesFor(row)}>
                    Preços
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleAvailable(row)}>
                    {row.is_available ? 'Marcar indisponível' : 'Disponibilizar'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeactivating(row)}>
                    {row.is_active ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
        <p className="mt-2 text-[11px] text-slate-500">
          Produtos nunca são apagados: desativar preserva o histórico de vendas. Alterar preços aqui não muda pedidos já
          registrados.
        </p>
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?.id ? 'Editar produto' : 'Novo produto'}
        onClose={() => setEditing(null)}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={save} loading={busy}>
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome *">
              <Input value={editing.name ?? ''} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
            </Field>
            <Field label="Categoria *">
              <Select
                value={editing.category_id ?? ''}
                onChange={(event) => setEditing({ ...editing, category_id: event.target.value })}
              >
                <option value="">Selecione…</option>
                {menu.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo *" hint="Pizzas aceitam sabores e regra de meio a meio.">
              <Select
                value={editing.kind ?? 'simple'}
                onChange={(event) => setEditing({ ...editing, kind: event.target.value as 'simple' | 'pizza' })}
              >
                <option value="simple">Item simples (bebida, sobremesa…)</option>
                <option value="pizza">Pizza (com sabores)</option>
              </Select>
            </Field>
            <Field label="Ordem de exibição">
              <Input
                type="number"
                value={editing.sort_order ?? 0}
                onChange={(event) => setEditing({ ...editing, sort_order: Number(event.target.value) })}
              />
            </Field>
            <Field label="Descrição" className="sm:col-span-2">
              <Textarea
                value={editing.description ?? ''}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
            </Field>
            <Field label="URL da imagem (Supabase Storage)" className="sm:col-span-2" hint="Opcional. O upload de imagens usa o bucket configurado no Supabase Storage.">
              <Input
                value={editing.image_url ?? ''}
                onChange={(event) => setEditing({ ...editing, image_url: event.target.value })}
                placeholder="https://…/storage/v1/object/public/menu/foto.jpg"
              />
            </Field>
          </div>
        )}
      </Modal>

      <PricesModal
        product={pricesFor}
        sizes={pricesFor?.kind === 'pizza' ? pizzaSizes : otherSizes}
        variants={menu.variants.filter((variant) => variant.product_id === pricesFor?.id)}
        onClose={() => setPricesFor(null)}
        onSaved={() => {
          refresh()
          setPricesFor(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(deactivating)}
        title={deactivating?.is_active ? 'Desativar produto' : 'Reativar produto'}
        confirmLabel={deactivating?.is_active ? 'Desativar' : 'Reativar'}
        tone={deactivating?.is_active ? 'danger' : 'success'}
        loading={busy}
        onCancel={() => setDeactivating(null)}
        onConfirm={() => deactivating && toggleActive(deactivating)}
        message={
          <p>
            {deactivating?.is_active
              ? 'O produto deixa de aparecer em novos pedidos, mas continua nos pedidos anteriores e relatórios.'
              : 'O produto volta a ficar disponível para novos pedidos.'}
          </p>
        }
      />
    </>
  )
}

function PricesModal({
  product,
  sizes,
  variants,
  onClose,
  onSaved,
}: {
  product: Product | null
  sizes: ProductSize[]
  variants: { id: string; product_id: string; size_id: string; price_cents: number; is_available: boolean }[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const current = (sizeId: string) => {
    const variant = variants.find((item) => item.size_id === sizeId)
    return variant ? (variant.price_cents / 100).toFixed(2).replace('.', ',') : ''
  }

  async function save() {
    if (!product) return
    setBusy(true)
    try {
      for (const size of sizes) {
        const raw = values[size.id]
        if (raw === undefined) continue
        const cents = parseMoneyToCents(raw)
        await api.upsertVariant({ product_id: product.id, size_id: size.id, price_cents: cents, is_available: true })
      }
      toast.success('Preços atualizados.')
      onSaved()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(product)}
      title={`Preços — ${product?.name ?? ''}`}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={save} loading={busy}>
            Salvar preços
          </Button>
        </>
      }
    >
      {product && (
        <div className="space-y-3">
          {sizes.length === 0 && <p className="text-sm text-amber-700">Cadastre tamanhos antes de definir preços.</p>}
          {sizes.map((size) => (
            <Field key={size.id} label={size.name} hint={size.kind === 'pizza' ? `até ${size.max_flavors} sabor(es)` : undefined}>
              <Input
                inputMode="decimal"
                placeholder={current(size.id) || '0,00'}
                value={values[size.id] ?? ''}
                onChange={(event) => setValues({ ...values, [size.id]: event.target.value })}
              />
            </Field>
          ))}
          <p className="text-[11px] text-slate-500">
            Deixe em branco os tamanhos que não devem ser alterados. Preços novos valem apenas para pedidos futuros.
          </p>
        </div>
      )}
    </Modal>
  )
}

// ===========================================================================
// CATEGORIAS
// ===========================================================================
function CategoriesTab({ categories, refresh }: { categories: Category[]; refresh: () => void }) {
  const toast = useToast()
  const [editing, setEditing] = useState<Partial<Category> | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!editing?.name) return
    setBusy(true)
    try {
      await api.upsertCategory(editing as Partial<Category> & { name: string })
      toast.success('Categoria salva.')
      setEditing(null)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card
        title={`Categorias (${categories.length})`}
        actions={
          <Button size="sm" onClick={() => setEditing({ is_active: true, sort_order: categories.length * 10 })}>
            + Nova categoria
          </Button>
        }
      >
        <DataTable
          rows={categories}
          rowKey={(row) => row.id}
          columns={[
            { key: 'name', header: 'Nome', render: (row) => row.name },
            { key: 'description', header: 'Descrição', render: (row) => row.description ?? '—' },
            { key: 'order', header: 'Ordem', align: 'right', render: (row) => row.sort_order },
            {
              key: 'status',
              header: 'Situação',
              render: (row) => <Badge tone={row.is_active ? 'green' : 'slate'}>{row.is_active ? 'Ativa' : 'Desativada'}</Badge>,
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await api.upsertCategory({ ...row, is_active: !row.is_active })
                        refresh()
                      } catch (error) {
                        toast.error(translateError(error))
                      }
                    }}
                  >
                    {row.is_active ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
        <p className="mt-2 text-[11px] text-slate-500">
          Desativar uma categoria não apaga produtos nem histórico de vendas.
        </p>
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?.id ? 'Editar categoria' : 'Nova categoria'}
        onClose={() => setEditing(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={save} loading={busy}>
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <Field label="Nome *">
              <Input value={editing.name ?? ''} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
            </Field>
            <Field label="Descrição">
              <Input
                value={editing.description ?? ''}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
            </Field>
            <Field label="Ordem de exibição">
              <Input
                type="number"
                value={editing.sort_order ?? 0}
                onChange={(event) => setEditing({ ...editing, sort_order: Number(event.target.value) })}
              />
            </Field>
          </div>
        )}
      </Modal>
    </>
  )
}

// ===========================================================================
// TAMANHOS
// ===========================================================================
function SizesTab({ sizes, refresh }: { sizes: ProductSize[]; refresh: () => void }) {
  const toast = useToast()
  const [editing, setEditing] = useState<Partial<ProductSize> | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!editing?.code || !editing.name || !editing.kind) return
    setBusy(true)
    try {
      await api.upsertProductSize({
        id: editing.id,
        code: editing.code.trim().toUpperCase(),
        name: editing.name.trim(),
        kind: editing.kind,
        slices: editing.slices ?? null,
        max_flavors: editing.kind === 'pizza' ? (editing.max_flavors ?? 2) : 1,
        sort_order: editing.sort_order ?? 0,
        is_active: editing.is_active ?? true,
      } as Partial<ProductSize> & { code: string; name: string; kind: 'pizza' | 'other' })
      toast.success('Tamanho salvo.')
      setEditing(null)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card
        title={`Tamanhos (${sizes.length})`}
        actions={
          <Button size="sm" onClick={() => setEditing({ kind: 'pizza', is_active: true, max_flavors: 2, sort_order: sizes.length * 10 })}>
            + Novo tamanho
          </Button>
        }
      >
        <DataTable
          rows={sizes}
          rowKey={(row) => row.id}
          columns={[
            { key: 'code', header: 'Código', render: (row) => row.code },
            { key: 'name', header: 'Nome', render: (row) => row.name },
            { key: 'kind', header: 'Tipo', render: (row) => (row.kind === 'pizza' ? 'Pizza' : 'Item simples') },
            { key: 'slices', header: 'Fatias', align: 'right', render: (row) => row.slices ?? '—' },
            { key: 'flavors', header: 'Sabores', align: 'right', render: (row) => row.max_flavors },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await api.upsertProductSize({ ...row, is_active: !row.is_active })
                        refresh()
                      } catch (error) {
                        toast.error(translateError(error))
                      }
                    }}
                  >
                    {row.is_active ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
        <p className="mt-2 text-[11px] text-slate-500">
          O tamanho define quantos sabores a pizza aceita (até 2: sabor único ou meio a meio).
        </p>
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?.id ? 'Editar tamanho' : 'Novo tamanho'}
        onClose={() => setEditing(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={save} loading={busy}>
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Código *" hint="ex.: G, GG, LAT">
              <Input value={editing.code ?? ''} onChange={(event) => setEditing({ ...editing, code: event.target.value })} />
            </Field>
            <Field label="Nome *">
              <Input value={editing.name ?? ''} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
            </Field>
            <Field label="Tipo *">
              <Select
                value={editing.kind ?? 'pizza'}
                onChange={(event) => setEditing({ ...editing, kind: event.target.value as 'pizza' | 'other' })}
              >
                <option value="pizza">Pizza (aceita sabores)</option>
                <option value="other">Item simples</option>
              </Select>
            </Field>
            <Field label="Fatias">
              <Input
                type="number"
                value={editing.slices ?? ''}
                onChange={(event) => setEditing({ ...editing, slices: event.target.value ? Number(event.target.value) : null })}
              />
            </Field>
            {editing.kind === 'pizza' && (
              <Field label="Máximo de sabores" hint="1 = sabor único; 2 = meio a meio.">
                <Input
                  type="number"
                  min={1}
                  max={2}
                  value={editing.max_flavors ?? 2}
                  onChange={(event) => setEditing({ ...editing, max_flavors: Number(event.target.value) })}
                />
              </Field>
            )}
            <Field label="Ordem">
              <Input
                type="number"
                value={editing.sort_order ?? 0}
                onChange={(event) => setEditing({ ...editing, sort_order: Number(event.target.value) })}
              />
            </Field>
          </div>
        )}
      </Modal>
    </>
  )
}

// ===========================================================================
// ADICIONAIS
// ===========================================================================
function ModifiersTab({
  groups,
  options,
  products,
  links,
  refresh,
}: {
  groups: ModifierGroup[]
  options: ModifierOption[]
  products: Product[]
  links: { product_id: string; group_id: string }[]
  refresh: () => void
}) {
  const toast = useToast()
  const [groupForm, setGroupForm] = useState<Partial<ModifierGroup> | null>(null)
  const [optionForm, setOptionForm] = useState<Partial<ModifierOption> | null>(null)
  const [linkFor, setLinkFor] = useState<ModifierGroup | null>(null)
  const [busy, setBusy] = useState(false)

  async function saveGroup() {
    if (!groupForm?.name) return
    setBusy(true)
    try {
      await api.upsertModifierGroup({
        id: groupForm.id,
        name: groupForm.name.trim(),
        description: groupForm.description ?? null,
        min_select: groupForm.min_select ?? 0,
        max_select: groupForm.max_select ?? 1,
        is_active: groupForm.is_active ?? true,
        sort_order: groupForm.sort_order ?? 0,
      } as Partial<ModifierGroup> & { name: string })
      toast.success('Grupo salvo.')
      setGroupForm(null)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  async function saveOption() {
    if (!optionForm?.name || !optionForm.group_id) return
    setBusy(true)
    try {
      await api.upsertModifierOption({
        id: optionForm.id,
        group_id: optionForm.group_id,
        name: optionForm.name.trim(),
        price_cents: optionForm.price_cents ?? 0,
        is_available: optionForm.is_available ?? true,
        sort_order: optionForm.sort_order ?? 0,
      } as Partial<ModifierOption> & { group_id: string; name: string })
      toast.success('Opção salva.')
      setOptionForm(null)
      refresh()
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card
        title={`Grupos de adicionais (${groups.length})`}
        actions={
          <Button size="sm" onClick={() => setGroupForm({ min_select: 0, max_select: 1, is_active: true, sort_order: groups.length * 10 })}>
            + Novo grupo
          </Button>
        }
      >
        <DataTable
          rows={groups}
          rowKey={(row) => row.id}
          emptyMessage="Nenhum grupo de adicionais."
          columns={[
            {
              key: 'name',
              header: 'Grupo',
              render: (row) => (
                <div>
                  <p className="font-medium text-slate-800">{row.name}</p>
                  {row.description && <p className="text-[11px] text-slate-500">{row.description}</p>}
                </div>
              ),
            },
            {
              key: 'limits',
              header: 'Obrigatório / Limite',
              render: (row) => `${row.min_select > 0 ? `mín. ${row.min_select}` : 'opcional'} · máx. ${row.max_select}`,
            },
            {
              key: 'options',
              header: 'Opções',
              render: (row) => (
                <div className="flex flex-wrap gap-1">
                  {options
                    .filter((option) => option.group_id === row.id)
                    .map((option) => (
                      <button
                        key={option.id}
                        onClick={() =>
                          setOptionForm({ ...option, price_cents: option.price_cents })
                        }
                        className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:border-brand-400"
                        title="Editar opção (preço em reais será pedido abaixo)"
                      >
                        {option.name} · {formatMoney(option.price_cents)}
                      </button>
                    ))}
                  <Button size="sm" variant="ghost" onClick={() => setOptionForm({ group_id: row.id, is_available: true, price_cents: 0 })}>
                    + opção
                  </Button>
                </div>
              ),
            },
            {
              key: 'products',
              header: 'Aplicado em',
              render: (row) => {
                const linkedProducts = links
                  .filter((link) => link.group_id === row.id)
                  .map((link) => products.find((product) => product.id === link.product_id)?.name)
                  .filter(Boolean)
                return <span className="text-xs text-slate-600">{linkedProducts.length === 0 ? 'nenhum produto' : linkedProducts.join(', ')}</span>
              },
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setLinkFor(row)}>
                    Vincular a produtos
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setGroupForm(row)}>
                    Editar
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={Boolean(groupForm)}
        title={groupForm?.id ? 'Editar grupo' : 'Novo grupo de adicionais'}
        onClose={() => setGroupForm(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setGroupForm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={saveGroup} loading={busy}>
              Salvar
            </Button>
          </>
        }
      >
        {groupForm && (
          <div className="space-y-3">
            <Field label="Nome *">
              <Input value={groupForm.name ?? ''} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mínimo obrigatório" hint="0 = opcional; 1+ = obrigatório">
                <Input
                  type="number"
                  min={0}
                  value={groupForm.min_select ?? 0}
                  onChange={(event) => setGroupForm({ ...groupForm, min_select: Number(event.target.value) })}
                />
              </Field>
              <Field label="Máximo por item">
                <Input
                  type="number"
                  min={1}
                  value={groupForm.max_select ?? 1}
                  onChange={(event) => setGroupForm({ ...groupForm, max_select: Number(event.target.value) })}
                />
              </Field>
            </div>
            <Field label="Descrição">
              <Input
                value={groupForm.description ?? ''}
                onChange={(event) => setGroupForm({ ...groupForm, description: event.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(optionForm)}
        title={optionForm?.id ? 'Editar opção' : 'Nova opção de adicional'}
        onClose={() => setOptionForm(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOptionForm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={saveOption} loading={busy}>
              Salvar
            </Button>
          </>
        }
      >
        {optionForm && (
          <div className="space-y-3">
            <Field label="Nome *">
              <Input value={optionForm.name ?? ''} onChange={(event) => setOptionForm({ ...optionForm, name: event.target.value })} />
            </Field>
            <Field label="Preço (R$)">
              <Input
                inputMode="decimal"
                value={optionForm.price_cents !== undefined ? (optionForm.price_cents / 100).toFixed(2).replace('.', ',') : ''}
                onChange={(event) => setOptionForm({ ...optionForm, price_cents: parseMoneyToCents(event.target.value) })}
              />
            </Field>
            <Field label="Disponível">
              <Select
                value={optionForm.is_available === false ? 'nao' : 'sim'}
                onChange={(event) => setOptionForm({ ...optionForm, is_available: event.target.value === 'sim' })}
              >
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </Select>
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(linkFor)}
        title={`Vincular "${linkFor?.name ?? ''}" aos produtos`}
        onClose={() => setLinkFor(null)}
        size="md"
      >
        <div className="max-h-80 space-y-1 overflow-y-auto scroll-thin">
          {products.length === 0 && <EmptyState title="Cadastre produtos primeiro" />}
          {products.map((product) => {
            const linked = links.some((link) => link.group_id === linkFor?.id && link.product_id === product.id)
            return (
              <label key={product.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={linked}
                  onChange={async (event) => {
                    if (!linkFor) return
                    try {
                      if (event.target.checked) await api.linkProductModifierGroup(product.id, linkFor.id)
                      else await api.unlinkProductModifierGroup(product.id, linkFor.id)
                      refresh()
                    } catch (error) {
                      toast.error(translateError(error))
                    }
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                {product.name}
                <span className="text-[11px] text-slate-500">{product.kind === 'pizza' ? '(pizza)' : ''}</span>
              </label>
            )
          })}
        </div>
      </Modal>
    </>
  )
}
