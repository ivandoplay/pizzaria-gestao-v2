-- =============================================================================
-- 0008 — RELATÓRIOS E INDICADORES (seção 13 do prompt)
--
-- Todas as agregações acontecem NO BANCO (não no navegador) e respeitam o
-- fuso horário configurado em business_settings.timezone.
--
-- DEFINIÇÕES OFICIAIS DOS INDICADORES (evita ambiguidade):
--   * Período de venda: janela sobre orders.created_at (hora local da pizzaria).
--   * bruto (subtotal_itens_cents) = soma dos itens NÃO cancelados.
--   * descontos_cents              = soma de orders.discount_cents.
--   * taxas_entrega_cents          = soma de orders.delivery_fee_cents.
--   * cancelados_*                 = pedidos com status 'cancelled' (nunca contam
--                                    como venda válida).
--   * liquido_valido_cents         = Σ total_cents dos pedidos não cancelados.
--   * recebido_cents               = Σ payments 'confirmed' cujo created_at cai
--                                    no período (data do RECEBIMENTO, que pode
--                                    diferir da data da venda).
--   * pendente_cents               = Σ (total - pago) dos pedidos não cancelados.
--   * ticket_medio_cents           = liquido_valido / pedidos válidos.
--   * Nenhum indicador de lucro é exibido (não há cadastro de custos/despesas).
--
-- PERMISSÕES: relatórios financeiros completos -> administrador.
--             consulta operacional do dia -> caixa (manager).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Resumo financeiro do período (com filtros opcionais)
-- -----------------------------------------------------------------------------
create or replace function public.get_financial_summary(
  p_from         timestamptz,
  p_to           timestamptz,
  p_service_mode text default null,   -- 'dine_in' | 'delivery' | null (todos)
  p_employee_id  uuid default null,   -- criador do pedido
  p_category_id  uuid default null    -- filtra pedidos que contenham a categoria
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile  public.profiles;
  v_settings public.business_settings;
  v_result   jsonb;
begin
  v_profile := app_private.require_role('admin');
  select * into v_settings from public.business_settings where id;

  with filtered as (
    select o.*
    from public.orders o
    where o.created_at >= p_from
      and o.created_at < p_to
      and (p_service_mode is null or o.service_mode = p_service_mode)
      and (p_employee_id is null or o.created_by = p_employee_id)
      and (
        p_category_id is null
        or exists (
          select 1
          from public.order_items oi
          join public.products pr on pr.id = oi.product_id
          where oi.order_id = o.id
            and oi.is_cancelled = false
            and pr.category_id = p_category_id
        )
      )
  ),
  valid as (
    select * from filtered where status <> 'cancelled'
  ),
  cancelled as (
    select * from filtered where status = 'cancelled'
  ),
  received as (
    select p.*
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and p.created_at >= p_from and p.created_at < p_to
      and o.status <> 'cancelled'
      and (p_service_mode is null or o.service_mode = p_service_mode)
      and (p_employee_id is null or o.created_by = p_employee_id)
      and (
        p_category_id is null
        or exists (
          select 1
          from public.order_items oi
          join public.products pr on pr.id = oi.product_id
          where oi.order_id = o.id
            and oi.is_cancelled = false
            and pr.category_id = p_category_id
        )
      )
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_settings.timezone),
    'orders_valid_count',        (select count(*) from valid),
    'orders_cancelled_count',    (select count(*) from cancelled),
    'gross_items_cents',         coalesce((select sum(subtotal_cents) from valid), 0),
    'discounts_cents',           coalesce((select sum(discount_cents) from valid), 0),
    'delivery_fees_cents',       coalesce((select sum(delivery_fee_cents) from valid), 0),
    'cancelled_cents',           coalesce((select sum(total_cents) from cancelled), 0),
    'net_valid_cents',           coalesce((select sum(total_cents) from valid), 0),
    'received_cents',            coalesce((select sum(amount_cents) from received), 0),
    'pending_cents',             coalesce((select sum(total_cents - paid_cents) from valid), 0),
    'ticket_average_cents',      case when (select count(*) from valid) > 0
                                   then round((select sum(total_cents) from valid)::numeric
                                              / (select count(*) from valid))::integer
                                   else 0 end,
    'dine_in', jsonb_build_object(
      'orders_count', (select count(*) from valid where service_mode = 'dine_in'),
      'net_cents',    coalesce((select sum(total_cents) from valid where service_mode = 'dine_in'), 0)
    ),
    'delivery', jsonb_build_object(
      'orders_count', (select count(*) from valid where service_mode = 'delivery'),
      'net_cents',    coalesce((select sum(total_cents) from valid where service_mode = 'delivery'), 0),
      'fees_cents',   coalesce((select sum(delivery_fee_cents) from valid where service_mode = 'delivery'), 0)
    )
  )
  into v_result;

  return v_result;
end
$$;

-- -----------------------------------------------------------------------------
-- Série temporal (dia/semana/mês) para gráficos
-- -----------------------------------------------------------------------------
create or replace function public.get_sales_series(
  p_from         timestamptz,
  p_to           timestamptz,
  p_bucket       text default 'day',   -- 'day' | 'week' | 'month'
  p_service_mode text default null
)
returns table (
  bucket_start  timestamptz,
  orders_count  bigint,
  gross_cents   bigint,
  discount_cents bigint,
  net_cents     bigint,
  received_cents bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile  public.profiles;
  v_settings public.business_settings;
  v_tz       text;
  v_trunc    text;
begin
  perform app_private.require_role('admin');
  select * into v_settings from public.business_settings where id;
  v_tz := v_settings.timezone;

  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'INVALID_BUCKET: use day, week ou month' using errcode = '22023';
  end if;
  v_trunc := p_bucket;

  return query
  with base as (
    select
      date_trunc(v_trunc, (o.created_at at time zone v_tz)) at time zone v_tz as b,
      o.subtotal_cents, o.discount_cents, o.total_cents
    from public.orders o
    where o.created_at >= p_from and o.created_at < p_to
      and o.status <> 'cancelled'
      and (p_service_mode is null or o.service_mode = p_service_mode)
  ),
  recv as (
    select
      date_trunc(v_trunc, (p.created_at at time zone v_tz)) at time zone v_tz as b,
      sum(p.amount_cents)::bigint as received
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and p.created_at >= p_from and p.created_at < p_to
      and o.status <> 'cancelled'
      and (p_service_mode is null or o.service_mode = p_service_mode)
    group by 1
  )
  select
    b.b,
    count(*)::bigint,
    coalesce(sum(b.subtotal_cents), 0)::bigint,
    coalesce(sum(b.discount_cents), 0)::bigint,
    coalesce(sum(b.total_cents), 0)::bigint,
    coalesce(max(r.received), 0)::bigint
  from base b
  left join recv r on r.b = b.b
  group by b.b
  order by b.b;
end
$$;

-- -----------------------------------------------------------------------------
-- Produtos mais vendidos
-- -----------------------------------------------------------------------------
create or replace function public.get_top_products(
  p_from        timestamptz,
  p_to          timestamptz,
  p_limit       integer default 20,
  p_category_id uuid default null
)
returns table (
  product_id    uuid,
  product_name  text,
  category_name text,
  quantity      bigint,
  total_cents   bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_private.require_role('admin');

  return query
  select
    oi.product_id,
    oi.product_name,
    max(oi.category_name),
    sum(oi.quantity)::bigint,
    sum(oi.total_cents)::bigint
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.created_at >= p_from and o.created_at < p_to
    and o.status <> 'cancelled'
    and oi.is_cancelled = false
    and (p_category_id is null or exists (
          select 1 from public.products pr
          where pr.id = oi.product_id and pr.category_id = p_category_id))
  group by oi.product_id, oi.product_name
  order by sum(oi.quantity) desc, sum(oi.total_cents) desc
  limit greatest(coalesce(p_limit, 20), 1);
end
$$;

-- -----------------------------------------------------------------------------
-- Vendas por funcionário
-- -----------------------------------------------------------------------------
create or replace function public.get_sales_by_employee(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  profile_id    uuid,
  full_name     text,
  role          text,
  orders_count  bigint,
  net_cents     bigint,
  cancelled_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_private.require_role('admin');

  return query
  select
    p.id,
    p.full_name,
    p.role,
    count(o.id) filter (where o.status <> 'cancelled')::bigint,
    coalesce(sum(o.total_cents) filter (where o.status <> 'cancelled'), 0)::bigint,
    count(o.id) filter (where o.status = 'cancelled')::bigint
  from public.profiles p
  left join public.orders o
    on o.created_by = p.id
   and o.created_at >= p_from and o.created_at < p_to
  group by p.id, p.full_name, p.role
  having count(o.id) > 0
  order by 5 desc;
end
$$;

-- -----------------------------------------------------------------------------
-- Recebimentos por forma de pagamento (e quanto entrou na gaveta)
-- -----------------------------------------------------------------------------
create or replace function public.get_payment_method_report(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  method_id        text,
  label            text,
  kind             text,
  payments_count   bigint,
  received_cents   bigint,
  change_cents     bigint,
  in_drawer_cents  bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_private.require_role('admin');

  return query
  select
    pm.id,
    pm.label,
    pm.kind,
    count(p.id) filter (where p.status = 'confirmed')::bigint,
    coalesce(sum(p.amount_cents) filter (where p.status = 'confirmed'), 0)::bigint,
    coalesce(sum(p.change_cents) filter (where p.status = 'confirmed'), 0)::bigint,
    case when pm.affects_cash_drawer
         then coalesce(sum(p.amount_cents) filter (where p.status = 'confirmed'), 0)::bigint
         else 0::bigint end
  from public.payment_methods pm
  left join public.payments p
    on p.method_id = pm.id
   and p.created_at >= p_from and p.created_at < p_to
  group by pm.id, pm.label, pm.kind, pm.affects_cash_drawer, pm.sort_order
  order by pm.sort_order;
end
$$;

-- -----------------------------------------------------------------------------
-- Caixa: sessões do período, com divergências
-- -----------------------------------------------------------------------------
create or replace function public.get_cash_sessions_report(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  session_id        uuid,
  opened_at         timestamptz,
  opened_by_name    text,
  closed_at         timestamptz,
  closed_by_name    text,
  opening_cents     integer,
  cash_sales_cents  bigint,
  movements_in_cents  bigint,
  movements_out_cents bigint,
  expected_cents    integer,
  counted_cents     integer,
  difference_cents  integer,
  variance_reason   text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_private.require_role('admin');

  return query
  select
    cs.id,
    cs.opened_at,
    opener.full_name,
    cs.closed_at,
    closer.full_name,
    cs.opening_amount_cents,
    coalesce((select sum(m.amount_cents) from public.cash_movements m
               where m.cash_session_id = cs.id and m.category = 'sale'), 0)::bigint,
    coalesce((select sum(m.amount_cents) from public.cash_movements m
               where m.cash_session_id = cs.id and m.kind = 'in'), 0)::bigint,
    coalesce((select sum(m.amount_cents) from public.cash_movements m
               where m.cash_session_id = cs.id and m.kind = 'out'), 0)::bigint,
    cs.expected_cash_cents,
    cs.counted_cash_cents,
    cs.difference_cents,
    cs.variance_reason
  from public.cash_sessions cs
  left join public.profiles opener on opener.id = cs.opened_by
  left join public.profiles closer on closer.id = cs.closed_by
  where cs.opened_at >= p_from and cs.opened_at < p_to
  order by cs.opened_at desc;
end
$$;

-- -----------------------------------------------------------------------------
-- Lista detalhada de pedidos (histórico com filtros; paginada)
-- -----------------------------------------------------------------------------
create or replace function public.get_orders_page(
  p_from       timestamptz,
  p_to         timestamptz,
  p_status     text default null,
  p_service_mode text default null,
  p_table_number integer default null,
  p_search     text default null,     -- nº do pedido, nome ou telefone do cliente
  p_limit      integer default 50,
  p_offset     integer default 0
)
returns table (
  id                uuid,
  order_number      bigint,
  service_mode      text,
  status            text,
  table_number      integer,
  customer_name     text,
  customer_phone    text,
  total_cents       integer,
  paid_cents        integer,
  balance_cents     integer,
  created_by_name   text,
  created_at        timestamptz,
  account_closed_at timestamptz,
  cancel_reason     text,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_private.require_role('admin', 'manager');

  return query
  with f as (
    select
      o.id, o.order_number, o.service_mode, o.status, t.number as table_number,
      o.customer_name_snapshot as customer_name, o.customer_phone_snapshot as customer_phone,
      o.total_cents, o.paid_cents, o.created_by, o.created_at,
      o.account_closed_at, o.cancel_reason
    from public.orders o
    left join public.table_sessions s on s.id = o.table_session_id
    left join public.restaurant_tables t on t.id = s.table_id
    where o.created_at >= p_from and o.created_at < p_to
      and (p_status is null or o.status = p_status)
      and (p_service_mode is null or o.service_mode = p_service_mode)
      and (p_table_number is null or t.number = p_table_number)
      and (
        p_search is null or btrim(p_search) = ''
        or o.order_number::text = regexp_replace(coalesce(p_search, ''), '\D', '', 'g')
        or o.customer_name_snapshot ilike '%' || btrim(p_search) || '%'
        -- telefone: compara só os dígitos dos dois lados (o caixa digita "988887777")
        or regexp_replace(coalesce(o.customer_phone_snapshot, ''), '\D', '', 'g')
             like '%' || regexp_replace(coalesce(p_search, ''), '\D', '', 'g') || '%'
      )
  )
  select
    f.id, f.order_number, f.service_mode, f.status, f.table_number,
    f.customer_name, f.customer_phone, f.total_cents, f.paid_cents,
    f.total_cents - f.paid_cents, p.full_name, f.created_at,
    f.account_closed_at, f.cancel_reason,
    count(*) over ()::bigint
  from f
  join public.profiles p on p.id = f.created_by
  order by f.created_at desc
  limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Resumo operacional (caixa pode consultar o próprio turno)
-- -----------------------------------------------------------------------------
create or replace function public.get_operational_summary(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_tz      text;
  v_day     date;
begin
  v_profile := app_private.require_role('admin', 'manager');
  select bs.timezone into v_tz from public.business_settings bs where bs.id;
  v_day := (p_at at time zone v_tz)::date;

  return (
    select jsonb_build_object(
      'timezone', v_tz,
      'tables_occupied', (select count(*) from public.table_overview where status in ('occupied', 'awaiting_close', 'attention')),
      'tables_available', (select count(*) from public.table_overview where status = 'available'),
      'tables_awaiting_close', (select count(*) from public.table_overview where status = 'awaiting_close'),
      'open_orders_count', (
        select count(*) from public.orders o
        where o.status <> 'cancelled' and o.account_closed_at is null
      ),
      'orders_in_production', (
        select count(*) from public.orders o
        where o.status in ('received', 'confirmed', 'preparing')
      ),
      'orders_ready', (
        select count(*) from public.orders o where o.status = 'ready'
      ),
      'deliveries_in_progress', (
        select count(*) from public.orders o
        where o.service_mode = 'delivery'
          and o.status in ('received', 'confirmed', 'preparing', 'ready', 'out_for_delivery')
      ),
      'open_accounts_balance_cents', (
        select coalesce(sum(o.total_cents - o.paid_cents), 0)
        from public.orders o
        where o.status <> 'cancelled' and o.account_closed_at is null
      ),
      'cash_session', (
        select jsonb_build_object(
          'id', cs.id,
          'opened_at', cs.opened_at,
          'opened_by', (select p.full_name from public.profiles p where p.id = cs.opened_by),
          'opening_amount_cents', cs.opening_amount_cents,
          'expected_cash_cents', cs.opening_amount_cents
            + coalesce((select sum(case when m.kind = 'in' then m.amount_cents else -m.amount_cents end)
                        from public.cash_movements m where m.cash_session_id = cs.id), 0),
          'cash_sales_cents', coalesce((select sum(m.amount_cents) from public.cash_movements m
                                        where m.cash_session_id = cs.id and m.category = 'sale'), 0),
          'received_today_cents', coalesce((
            select sum(p.amount_cents) from public.payments p
            where p.status = 'confirmed'
              and (p.created_at at time zone v_tz)::date = v_day
          ), 0)
        )
        from public.cash_sessions cs
        where cs.status = 'open'
        limit 1
      ),
      'day', jsonb_build_object(
        'date', v_day,
        'orders_count', (
          select count(*) from public.orders o
          where (o.created_at at time zone v_tz)::date = v_day and o.status <> 'cancelled'
        ),
        'net_cents', (
          select coalesce(sum(o.total_cents), 0) from public.orders o
          where (o.created_at at time zone v_tz)::date = v_day and o.status <> 'cancelled'
        )
      )
    )
  );
end
$$;
