-- =============================================================================
-- 0002 — CARDÁPIO: categorias, tamanhos, produtos, variações e adicionais
--
-- Regras estruturais:
--   * Produtos NUNCA são excluídos fisicamente quando têm histórico (is_active=false).
--   * Preços ficam em product_variants (produto × tamanho). Pizzas usam tamanhos
--     do tipo 'pizza' (aceitam 1 ou 2 sabores); demais itens usam 'other'.
--   * Pedidos guardam SNAPSHOT de nome/preço (ver migração 0005), portanto mudar
--     preços aqui não altera vendas passadas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CATEGORIES
-- -----------------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) >= 2),
  description text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists categories_name_key on public.categories (lower(btrim(name)));
create index if not exists categories_active_sort_idx on public.categories (sort_order) where is_active;

-- -----------------------------------------------------------------------------
-- PRODUCT_SIZES — tamanhos configuráveis (P/M/G/Família, lata, garrafa, ...).
--   kind='pizza'  -> aceita sabores e usa regras de meio a meio
--   kind='other'  -> item simples (bebida, sobremesa, adicional vendido avulso)
-- -----------------------------------------------------------------------------
create table if not exists public.product_sizes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$'),
  name        text not null check (length(btrim(name)) >= 1),
  kind        text not null check (kind in ('pizza', 'other')),
  slices      smallint check (slices is null or slices > 0),
  serves_from smallint check (serves_from is null or serves_from > 0),
  serves_to   smallint check (serves_to is null or serves_to >= serves_from),
  -- 1 = sabor único; 2 = meio a meio. (Escopo inicial: 1 ou 2 sabores.)
  max_flavors smallint not null default 1 check (max_flavors between 1 and 2),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint product_sizes_flavors_only_pizza check (max_flavors = 1 or kind = 'pizza')
);

create unique index if not exists product_sizes_name_key on public.product_sizes (lower(btrim(name)));

-- -----------------------------------------------------------------------------
-- PRODUCTS
-- -----------------------------------------------------------------------------
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories (id) on delete restrict,
  name         text not null check (length(btrim(name)) >= 2),
  description  text,
  image_url    text,
  kind         text not null default 'simple' check (kind in ('simple', 'pizza')),
  is_available boolean not null default true,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists products_category_name_key
  on public.products (category_id, lower(btrim(name)));
create index if not exists products_category_active_idx
  on public.products (category_id, sort_order) where is_active;

-- -----------------------------------------------------------------------------
-- PRODUCT_VARIANTS — preço por tamanho. Todo produto vendável precisa de ao
-- menos uma variação ativa (validado no RPC de criação de pedido).
-- -----------------------------------------------------------------------------
create table if not exists public.product_variants (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  size_id      uuid not null references public.product_sizes (id) on delete restrict,
  price_cents  integer not null check (price_cents >= 0),
  is_available boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (product_id, size_id)
);

create index if not exists product_variants_product_idx on public.product_variants (product_id);

-- -----------------------------------------------------------------------------
-- MODIFIER_GROUPS / MODIFIER_OPTIONS — adicionais (borda, extra queijo, ...).
-- min_select/max_select validam obrigatoriedade e limites no servidor.
-- -----------------------------------------------------------------------------
create table if not exists public.modifier_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) >= 2),
  description text,
  min_select  smallint not null default 0 check (min_select >= 0),
  max_select  smallint not null default 1 check (max_select >= 1),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint modifier_groups_select_range check (min_select <= max_select)
);

create unique index if not exists modifier_groups_name_key on public.modifier_groups (lower(btrim(name)));

create table if not exists public.modifier_options (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.modifier_groups (id) on delete cascade,
  name         text not null check (length(btrim(name)) >= 1),
  price_cents  integer not null default 0 check (price_cents >= 0),
  is_available boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists modifier_options_group_name_key
  on public.modifier_options (group_id, lower(btrim(name)));

-- -----------------------------------------------------------------------------
-- PRODUCT_MODIFIER_GROUPS — quais grupos de adicionais cada produto aceita.
-- -----------------------------------------------------------------------------
create table if not exists public.product_modifier_groups (
  product_id uuid not null references public.products (id) on delete cascade,
  group_id   uuid not null references public.modifier_groups (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_id, group_id)
);

-- -----------------------------------------------------------------------------
-- Triggers: updated_at + auditoria
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  audit_tables text[] := array[
    'categories', 'product_sizes', 'products', 'product_variants',
    'modifier_groups', 'modifier_options'
  ];
begin
  foreach t in array audit_tables loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$I', t);
    execute format(
      'create trigger set_updated_at_%1$s before update on public.%1$I
         for each row execute function app_private.set_updated_at()', t);
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
         for each row execute function app_private.audit_trigger()', t);
  end loop;

  execute 'drop trigger if exists set_updated_at_product_modifier_groups on public.product_modifier_groups';
  execute 'create trigger set_updated_at_product_modifier_groups before update on public.product_modifier_groups
             for each row execute function app_private.set_updated_at()';
  execute 'drop trigger if exists audit_product_modifier_groups on public.product_modifier_groups';
  execute 'create trigger audit_product_modifier_groups after insert or update or delete on public.product_modifier_groups
             for each row execute function app_private.audit_trigger()';
end
$$;
