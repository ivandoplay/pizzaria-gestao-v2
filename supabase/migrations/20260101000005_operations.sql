-- =============================================================================
-- 0005 — ATENDIMENTO: mesas, sessões, pedidos, itens, pagamentos
--
-- MODELO (entidades distintas — exigência da seção 9.1):
--   * order           = pedido (salão ou delivery). Guarda SNAPSHOT de preços.
--   * table_session   = período de atendimento de uma mesa (pode ter N pedidos).
--   * conta           = conta da sessão / do pedido delivery (valores devidos).
--   * payment         = recebimento individual (pode haver N por conta).
--
-- INVARIANTES GARANTIDAS PELO BANCO:
--   1. No máximo 1 sessão aberta por mesa (índice único parcial).
--   2. No máximo 1 sessão de caixa aberta (migração 0003).
--   3. Preços são SEMPRE recalculados no servidor a partir do catálogo;
--      o que o navegador envia é ignorado (apenas IDs são confiados).
--   4. Idempotência: client_uuid único em orders/payments/cash_movements.
--   5. Totais do pedido recalculados por trigger — nunca "digitados".
--   6. Itens/pagamentos não podem ser alterados após o fechamento da conta.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SEQUÊNCIA DE NÚMEROS DE PEDIDO (salão + delivery)
-- -----------------------------------------------------------------------------
create sequence if not exists public.order_number_seq start 1 increment 1;

create or replace function app_private.set_order_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.order_number is null then
    new.order_number := nextval('public.order_number_seq');
  end if;
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- RESTAURANT_TABLES — o estado operacional é DERIVADO da sessão aberta,
-- nunca armazenado como status (evita estados conflitantes).
-- -----------------------------------------------------------------------------
create table if not exists public.restaurant_tables (
  id         uuid primary key default gen_random_uuid(),
  number     integer not null unique check (number > 0),
  name       text,
  seats      smallint check (seats is null or seats > 0),
  is_active  boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- TABLE_SESSIONS
-- -----------------------------------------------------------------------------
create table if not exists public.table_sessions (
  id             uuid primary key default gen_random_uuid(),
  table_id       uuid not null references public.restaurant_tables (id) on delete restrict,
  opened_by      uuid not null references public.profiles (id) on delete restrict,
  opened_at      timestamptz not null default now(),
  guest_count    smallint check (guest_count is null or guest_count > 0),
  notes          text,
  status         text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  closed_by      uuid references public.profiles (id) on delete restrict,
  closed_at      timestamptz,
  -- Snapshot financeiro do fechamento:
  closed_total_cents   integer,
  closed_paid_cents    integer,
  closed_with_balance  boolean not null default false,
  close_reason         text,
  client_uuid    uuid unique,
  constraint table_sessions_closed_consistency check (
    (status = 'open' and closed_at is null)
    or
    (status in ('closed', 'cancelled') and closed_at is not null)
  )
);

-- Regra: uma única sessão ABERTA por mesa (garante "sem sessões duplicadas"
-- mesmo com duas requisições simultâneas).
create unique index if not exists table_sessions_single_open_idx
  on public.table_sessions (table_id) where status = 'open';
create index if not exists table_sessions_status_idx on public.table_sessions (status, opened_at desc);

-- -----------------------------------------------------------------------------
-- ORDERS
-- -----------------------------------------------------------------------------
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     bigint not null unique,
  service_mode     text not null check (service_mode in ('dine_in', 'delivery')),
  status           text not null default 'received' check (status in (
                     'received',           -- recebido
                     'confirmed',          -- confirmado
                     'preparing',          -- em preparação
                     'ready',              -- pronto
                     'delivered_to_table', -- entregue à mesa (salão)
                     'out_for_delivery',   -- saiu para entrega (delivery)
                     'delivered',          -- entregue (delivery)
                     'cancelled'           -- cancelado
                   )),
  table_session_id uuid references public.table_sessions (id) on delete restrict,
  created_by       uuid not null references public.profiles (id) on delete restrict,
  created_at       timestamptz not null default now(),

  -- Cliente/entrega (snapshot, para recibo e relatórios por bairro)
  customer_id               uuid references public.customers (id) on delete restrict,
  delivery_address_id       uuid references public.customer_addresses (id) on delete restrict,
  delivery_fee_zone_id      uuid references public.delivery_fee_zones (id) on delete restrict,
  customer_name_snapshot    text,
  customer_phone_snapshot   text,
  delivery_address_snapshot jsonb,
  delivery_neighborhood     text,
  delivery_fee_cents        integer not null default 0 check (delivery_fee_cents >= 0),
  delivery_notes            text,

  -- Financeiro (valores SEMPRE recalculados no servidor por trigger/RPC)
  subtotal_cents   integer not null default 0 check (subtotal_cents >= 0),
  discount_cents   integer not null default 0 check (discount_cents >= 0),
  discount_pct     numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  discount_reason  text,
  discount_authorized_by uuid references public.profiles (id) on delete set null,
  total_cents      integer not null default 0 check (total_cents >= 0),
  paid_cents       integer not null default 0 check (paid_cents >= 0),
  change_given_cents integer not null default 0 check (change_given_cents >= 0),

  notes            text,
  cash_session_id  uuid references public.cash_sessions (id) on delete restrict,
  account_closed_at timestamptz,
  closed_by        uuid references public.profiles (id) on delete set null,

  -- Marcas de tempo das mudanças de estado (auditoria operacional)
  confirmed_at     timestamptz,
  preparing_at     timestamptz,
  ready_at         timestamptz,
  delivered_at     timestamptz,

  -- Idempotência (clique repetido / reenvio após falha de conexão)
  client_uuid      uuid unique,

  -- Cancelamento (histórico preservado; nada é apagado)
  cancelled_at     timestamptz,
  cancelled_by     uuid references public.profiles (id) on delete restrict,
  cancel_reason    text,

  constraint orders_dine_in_needs_session
    check (service_mode <> 'dine_in' or table_session_id is not null),
  constraint orders_delivery_needs_customer
    check (service_mode <> 'delivery' or customer_id is not null),
  constraint orders_discount_reason_required
    check (discount_cents = 0 or discount_reason is not null),
  constraint orders_cancel_consistency
    check (
      (status = 'cancelled' and cancelled_at is not null and cancel_reason is not null)
      or (status <> 'cancelled' and cancelled_at is null)
    ),
  constraint orders_paid_within_total
    check (paid_cents <= total_cents)
);

create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists orders_session_idx on public.orders (table_session_id) where table_session_id is not null;
create index if not exists orders_customer_idx on public.orders (customer_id) where customer_id is not null;
create index if not exists orders_service_mode_idx on public.orders (service_mode, created_at desc);
create index if not exists orders_created_by_idx on public.orders (created_by, created_at desc);
create index if not exists orders_open_account_idx on public.orders (created_at)
  where account_closed_at is null and status <> 'cancelled';

drop trigger if exists orders_set_number on public.orders;
create trigger orders_set_number
  before insert on public.orders
  for each row execute function app_private.set_order_number();

-- -----------------------------------------------------------------------------
-- ORDER_ITEMS — valores unitários CONGELADOS (preço histórico).
-- -----------------------------------------------------------------------------
create table if not exists public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  line_number       smallint not null check (line_number > 0),
  product_id        uuid not null references public.products (id) on delete restrict,
  variant_id        uuid not null references public.product_variants (id) on delete restrict,
  -- Snapshot histórico (mudanças futuras no cardápio NÃO afetam esta linha):
  product_name      text not null,
  category_name     text,
  size_name         text not null,
  quantity          integer not null check (quantity between 1 and 50),
  unit_base_price_cents integer not null check (unit_base_price_cents >= 0),
  modifiers_unit_cents  integer not null default 0 check (modifiers_unit_cents >= 0),
  unit_price_cents  integer not null check (unit_price_cents >= 0),
  modifiers_total_cents integer not null default 0 check (modifiers_total_cents >= 0),
  total_cents       integer not null check (total_cents >= 0),
  pricing_rule      text check (pricing_rule in ('single', 'highest', 'average')),
  notes             text,
  is_cancelled      boolean not null default false,
  cancelled_by      uuid references public.profiles (id) on delete restrict,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_by        uuid not null references public.profiles (id) on delete restrict,
  created_at        timestamptz not null default now(),
  unique (order_id, line_number),
  constraint order_items_total_math
    check (total_cents = unit_price_cents * quantity),
  constraint order_items_unit_math
    check (unit_price_cents = unit_base_price_cents + modifiers_unit_cents),
  constraint order_items_modifiers_math
    check (modifiers_total_cents = modifiers_unit_cents * quantity),
  constraint order_items_cancel_consistency
    check ((is_cancelled = false and cancelled_at is null)
           or (is_cancelled = true and cancelled_at is not null and cancel_reason is not null))
);

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id, created_at desc);

-- Sabores da pizza (1 ou 2). Snapshot de nome.
create table if not exists public.order_item_flavors (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete restrict,
  flavor_name   text not null,
  position      smallint not null check (position between 1 and 2),
  unique (order_item_id, position)
);

create index if not exists order_item_flavors_item_idx on public.order_item_flavors (order_item_id);

-- Adicionais escolhidos. Snapshot de nome e preço.
create table if not exists public.order_item_modifiers (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  group_id      uuid references public.modifier_groups (id) on delete set null,
  group_name    text not null,
  option_id     uuid references public.modifier_options (id) on delete set null,
  option_name   text not null,
  price_cents   integer not null check (price_cents >= 0),
  quantity      smallint not null default 1 check (quantity between 1 and 20),
  created_at    timestamptz not null default now()
);

create index if not exists order_item_modifiers_item_idx on public.order_item_modifiers (order_item_id);

-- Histórico de estados do pedido.
create table if not exists public.order_status_history (
  id          bigint generated by default as identity primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now(),
  notes       text
);

create index if not exists order_status_history_order_idx on public.order_status_history (order_id, changed_at);

-- -----------------------------------------------------------------------------
-- PAYMENTS — recebimentos individuais. Nunca apagados: viram 'reversed'.
-- -----------------------------------------------------------------------------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete restrict,
  cash_session_id uuid not null references public.cash_sessions (id) on delete restrict,
  method_id       text not null references public.payment_methods (id) on delete restrict,
  amount_cents    integer not null check (amount_cents > 0),
  tendered_cents  integer check (tendered_cents is null or tendered_cents >= 0),
  change_cents    integer not null default 0 check (change_cents >= 0),
  is_prepaid      boolean not null default false,
  status          text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  note            text,
  reversed_at     timestamptz,
  reversed_by     uuid references public.profiles (id) on delete restrict,
  reverse_reason  text,
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  client_uuid     uuid unique,
  constraint payments_change_math
    check (change_cents = greatest(coalesce(tendered_cents, amount_cents) - amount_cents, 0)),
  constraint payments_tendered_covers_amount
    check (tendered_cents is null or tendered_cents >= amount_cents),
  constraint payments_reverse_consistency
    check ((status = 'confirmed' and reversed_at is null)
           or (status = 'reversed' and reversed_at is not null and reverse_reason is not null))
);

create index if not exists payments_order_idx on public.payments (order_id, created_at);
create index if not exists payments_method_idx on public.payments (method_id, created_at desc);
create index if not exists payments_cash_session_idx on public.payments (cash_session_id);
create index if not exists payments_created_idx on public.payments (created_at desc) where status = 'confirmed';

-- FKs pendentes das movimentações de caixa
alter table public.cash_movements
  drop constraint if exists cash_movements_payment_id_fkey;
alter table public.cash_movements
  add constraint cash_movements_payment_id_fkey
  foreign key (payment_id) references public.payments (id) on delete restrict;

alter table public.cash_movements
  drop constraint if exists cash_movements_order_id_fkey;
alter table public.cash_movements
  add constraint cash_movements_order_id_fkey
  foreign key (order_id) references public.orders (id) on delete restrict;

-- -----------------------------------------------------------------------------
-- RECÁLCULO OFICIAL DE TOTAIS
-- Única fonte de verdade dos valores. Chamado por triggers (itens/pagamentos)
-- e pelos RPCs. SECURITY DEFINER para atualizar orders sob qualquer perfil.
-- -----------------------------------------------------------------------------
create or replace function app_private.recalc_order_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal integer;
  v_discount integer;
  v_fee      integer;
  v_paid     integer;
  v_change   integer;
  v_total    integer;
begin
  select
    coalesce(sum(case when oi.is_cancelled then 0 else oi.total_cents end), 0)
  into v_subtotal
  from public.order_items oi
  where oi.order_id = p_order_id;

  select coalesce(sum(p.amount_cents), 0), coalesce(sum(p.change_cents), 0)
  into v_paid, v_change
  from public.payments p
  where p.order_id = p_order_id and p.status = 'confirmed';

  select coalesce(o.discount_cents, 0), coalesce(o.delivery_fee_cents, 0)
  into v_discount, v_fee
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return;
  end if;

  v_discount := least(v_discount, v_subtotal);
  v_total := greatest(v_subtotal - v_discount, 0) + v_fee;

  update public.orders o
     set subtotal_cents     = v_subtotal,
         discount_cents     = v_discount,
         total_cents        = v_total,
         paid_cents         = v_paid,
         change_given_cents = v_change
   where o.id = p_order_id;
end
$$;

create or replace function app_private.trigger_recalc_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  v_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  perform app_private.recalc_order_totals(v_order_id);
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

-- Trava: pedido com conta fechada/cancelada não aceita novos itens.
create or replace function app_private.guard_closed_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  select o.* into v_order
  from public.orders o
  where o.id = case when tg_op = 'DELETE' then old.order_id else new.order_id end;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND' using errcode = '23503';
  end if;

  if v_order.account_closed_at is not null then
    raise exception 'ORDER_ACCOUNT_CLOSED: conta já fechada; alterações exigem procedimento administrativo'
      using errcode = '55006';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED: pedido cancelado não aceita alterações' using errcode = '55006';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

-- Trava: não registrar pagamento em pedido cancelado/conta fechada, nem
-- pagamento acima do saldo, nem dinheiro sem valor recebido.
create or replace function app_private.guard_payment_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_method public.payment_methods;
  v_balance integer;
begin
  select o.* into v_order from public.orders o where o.id = new.order_id for update;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND' using errcode = '23503';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED: pedido cancelado não aceita pagamento' using errcode = '55006';
  end if;
  if v_order.account_closed_at is not null then
    raise exception 'ORDER_ACCOUNT_CLOSED: conta já fechada' using errcode = '55006';
  end if;

  select m.* into v_method from public.payment_methods m where m.id = new.method_id;
  if v_method.id is null or not v_method.is_active then
    raise exception 'PAYMENT_METHOD_INVALID: forma de pagamento inativa ou inexistente' using errcode = '22023';
  end if;

  if v_method.requires_change and new.tendered_cents is null then
    raise exception 'TENDERED_REQUIRED: informar o valor recebido em dinheiro para calcular o troco'
      using errcode = '22023';
  end if;

  v_balance := v_order.total_cents - v_order.paid_cents;
  if new.amount_cents > v_balance then
    raise exception 'AMOUNT_EXCEEDS_BALANCE: valor % excede o saldo pendente %',
      new.amount_cents, v_balance using errcode = '22023';
  end if;

  return new;
end
$$;

drop trigger if exists order_items_guard on public.order_items;
create trigger order_items_guard
  before insert or update or delete on public.order_items
  for each row execute function app_private.guard_closed_order();

drop trigger if exists order_items_recalc on public.order_items;
create trigger order_items_recalc
  after insert or update or delete on public.order_items
  for each row execute function app_private.trigger_recalc_order();

drop trigger if exists payments_guard_insert on public.payments;
create trigger payments_guard_insert
  before insert on public.payments
  for each row execute function app_private.guard_payment_insert();

drop trigger if exists payments_recalc on public.payments;
create trigger payments_recalc
  after insert or update or delete on public.payments
  for each row execute function app_private.trigger_recalc_order();

-- -----------------------------------------------------------------------------
-- Triggers de auditoria das tabelas operacionais
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['restaurant_tables', 'table_sessions', 'orders', 'order_items', 'payments'] loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$I', t);
    -- Somente tabelas que possuem a coluna updated_at recebem o trigger.
    if t = 'restaurant_tables' then
      execute format(
        'create trigger set_updated_at_%1$s before update on public.%1$I
           for each row execute function app_private.set_updated_at()', t);
    end if;
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
         for each row execute function app_private.audit_trigger()', t);
  end loop;
end
$$;
