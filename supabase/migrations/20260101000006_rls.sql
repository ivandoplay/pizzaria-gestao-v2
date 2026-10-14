-- =============================================================================
-- 0006 — SEGURANÇA: RLS, privilégios, views de leitura e realtime
--
-- Princípios (seção 11 do prompt):
--   * RLS habilitada em TODAS as tabelas expostas pela API.
--   * Leitura: conforme perfil. Escrita: apenas onde a operação faz sentido,
--     e nunca nas tabelas financeiras/operacionais críticas (essas só mudam
--     por RPC SECURITY DEFINER que valida o perfil — ver migração 0007).
--   * O frontend NUNCA recebe a service_role. Operações privilegiadas
--     (criar usuário, etc.) passam por Edge Function server-side.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. HELPERS DE ESCRITA (usados nas políticas)
--    app_private.is_admin() / is_manager() / is_active_staff() já existem.
-- -----------------------------------------------------------------------------

-- Impede que o último administrador ativo seja desativado/rebaixado e que
-- alguém altere a própria função (defesa extra além do RLS).
create or replace function app_private.guard_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.profiles;
  v_other_admins integer;
begin
  v_actor := app_private.current_profile();

  if tg_op = 'UPDATE' then
    -- Ninguém altera a própria função (nem admin).
    if v_actor.id is not null and v_actor.id = old.id and new.role <> old.role then
      raise exception 'SELF_ROLE_CHANGE: não é permitido alterar a própria função'
        using errcode = '42501';
    end if;

    -- Proteção do último administrador ativo.
    if old.role = 'admin' and old.is_active
       and (new.role <> 'admin' or new.is_active = false) then
      select count(*) into v_other_admins
      from public.profiles p
      where p.role = 'admin' and p.is_active and p.id <> old.id;

      if v_other_admins = 0 then
        raise exception 'LAST_ADMIN: não é possível desativar/rebaixar o último administrador ativo'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists guard_profiles on public.profiles;
create trigger guard_profiles
  before update on public.profiles
  for each row execute function app_private.guard_profiles();

-- -----------------------------------------------------------------------------
-- 2. HABILITAR RLS
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'business_settings', 'business_hours', 'payment_methods',
    'audit_logs', 'categories', 'product_sizes', 'products', 'product_variants',
    'modifier_groups', 'modifier_options', 'product_modifier_groups',
    'customers', 'customer_addresses', 'delivery_fee_zones',
    'restaurant_tables', 'table_sessions', 'orders', 'order_items',
    'order_item_flavors', 'order_item_modifiers', 'order_status_history',
    'payments', 'cash_sessions', 'cash_movements'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. POLÍTICAS
-- -----------------------------------------------------------------------------

-- ---------- profiles ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    app_private.is_admin()
    or app_private.is_manager()
    or id = app_private.current_profile_id()
  );

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (app_private.is_admin())
  with check (app_private.is_admin());

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (app_private.is_admin());
-- Sem política de DELETE: perfis nunca são apagados (apenas desativados).

-- ---------- configurações (leitura: equipe / escrita: admin) ----------
drop policy if exists business_settings_select on public.business_settings;
create policy business_settings_select on public.business_settings
  for select to authenticated using (app_private.is_active_staff());

drop policy if exists business_settings_write on public.business_settings;
create policy business_settings_write on public.business_settings
  for all to authenticated
  using (app_private.is_admin())
  with check (app_private.is_admin());

drop policy if exists business_hours_select on public.business_hours;
create policy business_hours_select on public.business_hours
  for select to authenticated using (app_private.is_active_staff());

drop policy if exists business_hours_write on public.business_hours;
create policy business_hours_write on public.business_hours
  for all to authenticated
  using (app_private.is_admin()) with check (app_private.is_admin());

drop policy if exists payment_methods_select on public.payment_methods;
create policy payment_methods_select on public.payment_methods
  for select to authenticated using (app_private.is_active_staff());

drop policy if exists payment_methods_write on public.payment_methods;
create policy payment_methods_write on public.payment_methods
  for all to authenticated
  using (app_private.is_admin()) with check (app_private.is_admin());

-- ---------- auditoria (somente administrador lê; ninguém escreve direto) ----------
drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated using (app_private.is_admin());

-- ---------- cardápio (leitura: equipe / escrita: admin) ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'product_sizes', 'products', 'product_variants',
    'modifier_groups', 'modifier_options', 'product_modifier_groups'
  ] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using (app_private.is_active_staff())', t);

    execute format('drop policy if exists %1$s_write_admin on public.%1$I', t);
    execute format(
      'create policy %1$s_write_admin on public.%1$I for all to authenticated
         using (app_private.is_admin()) with check (app_private.is_admin())', t);
  end loop;
end
$$;

-- ---------- delivery/configuração de taxas ----------
drop policy if exists delivery_fee_zones_select on public.delivery_fee_zones;
create policy delivery_fee_zones_select on public.delivery_fee_zones
  for select to authenticated using (app_private.is_active_staff());

drop policy if exists delivery_fee_zones_write on public.delivery_fee_zones;
create policy delivery_fee_zones_write on public.delivery_fee_zones
  for all to authenticated
  using (app_private.is_admin()) with check (app_private.is_admin());

-- ---------- clientes (caixa/admin; garçom não acessa delivery) ----------
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated using (app_private.is_manager());

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert to authenticated with check (app_private.is_manager());

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update to authenticated
  using (app_private.is_manager()) with check (app_private.is_manager());

drop policy if exists customer_addresses_select on public.customer_addresses;
create policy customer_addresses_select on public.customer_addresses
  for select to authenticated using (app_private.is_manager());

drop policy if exists customer_addresses_insert on public.customer_addresses;
create policy customer_addresses_insert on public.customer_addresses
  for insert to authenticated with check (app_private.is_manager());

drop policy if exists customer_addresses_update on public.customer_addresses;
create policy customer_addresses_update on public.customer_addresses
  for update to authenticated
  using (app_private.is_manager()) with check (app_private.is_manager());

-- ---------- mesas ----------
drop policy if exists restaurant_tables_select on public.restaurant_tables;
create policy restaurant_tables_select on public.restaurant_tables
  for select to authenticated using (app_private.is_active_staff());

drop policy if exists restaurant_tables_write on public.restaurant_tables;
create policy restaurant_tables_write on public.restaurant_tables
  for all to authenticated
  using (app_private.is_admin()) with check (app_private.is_admin());

-- ---------- sessões de mesa (somente leitura direta; escrita por RPC) ----------
drop policy if exists table_sessions_select on public.table_sessions;
create policy table_sessions_select on public.table_sessions
  for select to authenticated using (app_private.is_active_staff());

-- ---------- pedidos ----------
-- Garçom vê apenas pedidos de salão; caixa e admin veem tudo.
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (
    app_private.is_manager()
    or (app_private.has_role(array['waiter']) and service_mode = 'dine_in')
  );

-- Itens seguem a visibilidade do pedido (RLS de orders aplica na subconsulta).
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id));

drop policy if exists order_item_flavors_select on public.order_item_flavors;
create policy order_item_flavors_select on public.order_item_flavors
  for select to authenticated
  using (exists (
    select 1 from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = order_item_flavors.order_item_id
  ));

drop policy if exists order_item_modifiers_select on public.order_item_modifiers;
create policy order_item_modifiers_select on public.order_item_modifiers
  for select to authenticated
  using (exists (
    select 1 from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = order_item_modifiers.order_item_id
  ));

drop policy if exists order_status_history_select on public.order_status_history;
create policy order_status_history_select on public.order_status_history
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_status_history.order_id));

-- ---------- financeiro (somente caixa/admin leem; escrita por RPC) ----------
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated using (app_private.is_manager());

drop policy if exists cash_sessions_select on public.cash_sessions;
create policy cash_sessions_select on public.cash_sessions
  for select to authenticated using (app_private.is_manager());

drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  for select to authenticated using (app_private.is_manager());

-- NOTA: não existem políticas de INSERT/UPDATE/DELETE para orders, order_items,
-- payments, cash_sessions, cash_movements e table_sessions. Toda essa escrita
-- acontece exclusivamente via funções RPC (migração 0007), que:
--   (a) validam o perfil do usuário no banco;
--   (b) recalculam valores no servidor;
--   (c) são idempotentes e auditadas.

-- -----------------------------------------------------------------------------
-- 4. PRIVILÉGIOS (GRANTs)
-- -----------------------------------------------------------------------------
-- anon mantém apenas SELECT (padrão Supabase); nenhuma política concede nada a
-- anon, então a RLS devolve zero linhas em vez de erro de permissão.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on all tables in schema public to anon;
revoke all on schema app_private from public;
revoke all on schema app_private from anon;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app_private to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant all on schema app_private to service_role;

-- Funções: RPCs são chamadas pelo cliente autenticado; helpers são usados
-- pelas políticas RLS (avaliadas como o usuário).
grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app_private to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant execute on functions to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. VIEWS DE LEITURA (security_invoker: respeitam a RLS das tabelas base)
-- -----------------------------------------------------------------------------
drop view if exists public.table_overview;
create view public.table_overview
with (security_invoker = true) as
select
  t.id,
  t.number,
  t.name,
  t.seats,
  t.is_active,
  case
    when t.is_active = false then 'inactive'
    when s.id is null then 'available'
    when agg.total_cents > 0 and agg.paid_cents >= agg.total_cents then 'awaiting_close'
    when s.opened_at < now() - interval '2 hours' then 'attention'
    else 'occupied'
  end as status,
  s.id            as open_session_id,
  s.opened_at,
  s.guest_count,
  s.opened_by,
  opener.full_name as opened_by_name,
  coalesce(agg.orders_count, 0)    as open_orders_count,
  coalesce(agg.items_count, 0)     as open_items_count,
  coalesce(agg.subtotal_cents, 0)  as subtotal_cents,
  coalesce(agg.discount_cents, 0)  as discount_cents,
  coalesce(agg.fee_cents, 0)       as delivery_fee_cents,
  coalesce(agg.total_cents, 0)     as total_cents,
  coalesce(agg.paid_cents, 0)      as paid_cents,
  coalesce(agg.total_cents, 0) - coalesce(agg.paid_cents, 0) as balance_cents,
  coalesce(agg.pending_kitchen, 0) as pending_kitchen_count
from public.restaurant_tables t
left join public.table_sessions s
  on s.table_id = t.id and s.status = 'open'
left join public.profiles opener on opener.id = s.opened_by
left join lateral (
  select
    count(distinct o.id)::int as orders_count,
    coalesce(sum((select count(*) from public.order_items oi
                   where oi.order_id = o.id and oi.is_cancelled = false)::int), 0) as items_count,
    coalesce(sum(o.subtotal_cents), 0)::int  as subtotal_cents,
    coalesce(sum(o.discount_cents), 0)::int  as discount_cents,
    coalesce(sum(o.delivery_fee_cents), 0)::int as fee_cents,
    coalesce(sum(o.total_cents), 0)::int     as total_cents,
    coalesce(sum(o.paid_cents), 0)::int      as paid_cents,
    count(distinct o.id) filter (
      where o.status in ('received', 'confirmed', 'preparing', 'ready')
    )::int as pending_kitchen
  from public.orders o
  where o.table_session_id = s.id
    and o.status <> 'cancelled'
    and o.account_closed_at is null
) agg on true;

comment on view public.table_overview is
  'Mapa de mesas com estado derivado da sessão aberta e totais da conta em aberto.';

drop view if exists public.order_overview;
create view public.order_overview
with (security_invoker = true) as
select
  o.id,
  o.order_number,
  o.service_mode,
  o.status,
  o.table_session_id,
  s.table_id,
  t.number                       as table_number,
  o.customer_id,
  o.customer_name_snapshot,
  o.customer_phone_snapshot,
  o.delivery_neighborhood,
  o.delivery_fee_cents,
  o.delivery_notes,
  o.subtotal_cents,
  o.discount_cents,
  o.discount_pct,
  o.total_cents,
  o.paid_cents,
  o.total_cents - o.paid_cents   as balance_cents,
  o.change_given_cents,
  o.status = 'cancelled'         as is_cancelled,
  o.cancel_reason,
  o.notes,
  o.created_by,
  creator.full_name              as created_by_name,
  o.created_at,
  o.account_closed_at,
  o.cash_session_id
from public.orders o
left join public.table_sessions s on s.id = o.table_session_id
left join public.restaurant_tables t on t.id = s.table_id
left join public.profiles creator on creator.id = o.created_by;

comment on view public.order_overview is
  'Pedidos com mesa/cliente e saldo pendente. Herda a RLS de orders (garçom vê apenas salão).';

-- Itens com sabores e adicionais agregados (uma consulta por pedido).
drop view if exists public.order_item_overview;
create view public.order_item_overview
with (security_invoker = true) as
select
  oi.id,
  oi.order_id,
  oi.line_number,
  oi.product_id,
  oi.variant_id,
  oi.product_name,
  oi.category_name,
  oi.size_name,
  oi.quantity,
  oi.unit_base_price_cents,
  oi.modifiers_unit_cents,
  oi.unit_price_cents,
  oi.modifiers_total_cents,
  oi.total_cents,
  oi.pricing_rule,
  oi.notes,
  oi.is_cancelled,
  oi.cancel_reason,
  oi.created_at,
  coalesce(fl.flavors, '[]'::jsonb)   as flavors,
  coalesce(md.modifiers, '[]'::jsonb) as modifiers
from public.order_items oi
left join lateral (
  select jsonb_agg(jsonb_build_object(
           'product_id', f.product_id,
           'name', f.flavor_name,
           'position', f.position
         ) order by f.position) as flavors
  from public.order_item_flavors f
  where f.order_item_id = oi.id
) fl on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
           'group_name', m.group_name,
           'option_name', m.option_name,
           'price_cents', m.price_cents,
           'quantity', m.quantity
         ) order by m.created_at) as modifiers
  from public.order_item_modifiers m
  where m.order_item_id = oi.id
) md on true;

comment on view public.order_item_overview is
  'Itens de pedido com snapshot histórico de sabores e adicionais.';

drop view if exists public.cash_session_overview;
create view public.cash_session_overview
with (security_invoker = true) as
select
  cs.id,
  cs.status,
  cs.opened_by,
  opener.full_name as opened_by_name,
  cs.opened_at,
  cs.opening_amount_cents,
  cs.closed_by,
  closer.full_name as closed_by_name,
  cs.closed_at,
  coalesce(mv.in_total, 0)           as movements_in_cents,
  coalesce(mv.out_total, 0)          as movements_out_cents,
  coalesce(mv.cash_sales_cents, 0)   as cash_sales_cents,
  cs.opening_amount_cents + coalesce(mv.in_total, 0) - coalesce(mv.out_total, 0) as expected_cash_cents,
  cs.counted_cash_cents,
  cs.difference_cents,
  cs.closing_note,
  cs.variance_reason
from public.cash_sessions cs
left join public.profiles opener on opener.id = cs.opened_by
left join public.profiles closer on closer.id = cs.closed_by
left join lateral (
  select
    coalesce(sum(case when m.kind = 'in' then m.amount_cents else 0 end), 0)::int  as in_total,
    coalesce(sum(case when m.kind = 'out' then m.amount_cents else 0 end), 0)::int as out_total,
    coalesce(sum(case when m.category = 'sale' and m.kind = 'in' then m.amount_cents else 0 end), 0)::int as cash_sales_cents
  from public.cash_movements m
  where m.cash_session_id = cs.id
) mv on true;

comment on view public.cash_session_overview is
  'Sessões de caixa com totais de gaveta (apenas dinheiro físico).';

-- -----------------------------------------------------------------------------
-- 6. GRANTS FINAIS (depois da criação das views)
--    Em PostgreSQL, GRANT ... ON ALL TABLES IN SCHEMA abrange tabelas E views.
--    anon recebe apenas SELECT (e a RLS devolve zero linhas para ele).
--    authenticated recebe os privilégios e a RLS é quem decide o que pode.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app_private to authenticated, service_role;

-- ENDURECIMENTO (defesa em profundidade) --------------------------------------
-- Nas tabelas em que TODA a escrita passa por RPC, o GRANT de escrita é retirado
-- do cliente autenticado (veja a nota no topo da seção 3). Elas continuam
-- legíveis e continuam sendo escritas pelas RPCs (security definer).
-- Com isto, mesmo que alguém crie por engano uma política de escrita no futuro,
-- o PostgreSQL nega a operação ANTES de avaliar a RLS: duas camadas, não uma.
revoke insert, update, delete, truncate, references, trigger
  on public.orders,
     public.order_items,
     public.order_item_flavors,
     public.order_item_modifiers,
     public.order_status_history,
     public.payments,
     public.table_sessions,
     public.cash_sessions,
     public.cash_movements,
     public.audit_logs
  from authenticated;

-- -----------------------------------------------------------------------------
-- 7. REALTIME — publicar as tabelas que precisam sincronizar entre painéis
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'restaurant_tables', 'table_sessions', 'orders', 'order_items',
    'order_item_flavors', 'order_item_modifiers', 'order_status_history',
    'payments', 'cash_sessions', 'cash_movements'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
