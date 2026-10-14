-- =============================================================================
-- 0004 — CLIENTES, ENDEREÇOS E TAXAS DE ENTREGA
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CUSTOMERS — clientes recorrentes (delivery por telefone/WhatsApp).
-- A busca é feita por telefone normalizado (somente dígitos).
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) >= 2),
  phone        text not null check (length(regexp_replace(phone, '\D', '', 'g')) between 10 and 13),
  phone_digits text generated always as (regexp_replace(phone, '\D', '', 'g')) stored,
  email        text,
  notes        text,
  is_active    boolean not null default true,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists customers_phone_digits_key on public.customers (phone_digits);
create index if not exists customers_name_idx on public.customers (lower(btrim(name)));

-- -----------------------------------------------------------------------------
-- CUSTOMER_ADDRESSES
-- -----------------------------------------------------------------------------
create table if not exists public.customer_addresses (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers (id) on delete cascade,
  label          text,
  street         text not null check (length(btrim(street)) >= 2),
  number         text not null,
  complement     text,
  neighborhood   text not null check (length(btrim(neighborhood)) >= 2),
  city           text not null default 'Teresina',
  state          text not null default 'PI' check (char_length(state) = 2),
  postal_code    text,
  reference      text,
  delivery_notes text,
  is_default     boolean not null default false,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Um endereço padrão por cliente.
create unique index if not exists customer_addresses_single_default_idx
  on public.customer_addresses (customer_id) where is_default;
create index if not exists customer_addresses_customer_idx on public.customer_addresses (customer_id);
create index if not exists customer_addresses_neighborhood_idx
  on public.customer_addresses (lower(btrim(neighborhood)));

-- -----------------------------------------------------------------------------
-- DELIVERY_FEE_ZONES — taxa de entrega por bairro (opcional, configurável).
-- Quando o bairro não tem zona cadastrada, aplica-se a taxa padrão de
-- business_settings.default_delivery_fee_cents.
-- -----------------------------------------------------------------------------
create table if not exists public.delivery_fee_zones (
  id          uuid primary key default gen_random_uuid(),
  neighborhood text not null check (length(btrim(neighborhood)) >= 2),
  fee_cents   integer not null check (fee_cents >= 0),
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists delivery_fee_zones_neighborhood_key
  on public.delivery_fee_zones (lower(btrim(neighborhood)));

do $$
declare
  t text;
begin
  foreach t in array array['customers', 'customer_addresses', 'delivery_fee_zones'] loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$I', t);
    execute format(
      'create trigger set_updated_at_%1$s before update on public.%1$I
         for each row execute function app_private.set_updated_at()', t);
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
         for each row execute function app_private.audit_trigger()', t);
  end loop;
end
$$;
