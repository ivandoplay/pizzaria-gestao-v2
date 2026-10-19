-- =============================================================================
-- 0024 — Resumo financeiro filtrável por forma de pagamento
--
-- Seção 13 do prompt mestre: os relatórios precisam ser filtráveis por período,
-- produto, categoria, funcionário, modalidade, **forma de pagamento** e estado.
-- Faltava a forma de pagamento — o administrador não conseguia responder
-- "quanto entrou em Pix no período?".
--
-- Regra: com o filtro ativo, entram apenas os pedidos que têm recebimento
-- CONFIRMADO naquela forma, e `received_cents` soma só os recebimentos dessa
-- forma (senão o total recebido misturaria formas e a conta não fecharia).
--
-- Mesmo cuidado da 0023: a assinatura muda, então a versão antiga é removida
-- (evita ambiguidade de sobrecarga) e as permissões são reaplicadas (criar
-- função devolve EXECUTE ao `anon`, e a 0019 tirou isso de propósito).
-- =============================================================================

drop function if exists public.get_financial_summary(timestamptz, timestamptz, text, uuid, uuid);

create or replace function public.get_financial_summary(
  p_from         timestamptz,
  p_to           timestamptz,
  p_service_mode text default null,   -- 'dine_in' | 'delivery' | null (todos)
  p_employee_id  uuid default null,   -- criador do pedido
  p_category_id  uuid default null,   -- filtra pedidos que contenham a categoria
  p_method_id    text default null    -- filtra pela forma de pagamento confirmada
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
      and (
        p_method_id is null
        or exists (
          select 1 from public.payments pay
           where pay.order_id = o.id
             and pay.status = 'confirmed'
             and pay.method_id = p_method_id
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
      and (p_method_id is null or p.method_id = p_method_id)
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

revoke all on function public.get_financial_summary(timestamptz, timestamptz, text, uuid, uuid, text)
  from public, anon;
grant execute on function public.get_financial_summary(timestamptz, timestamptz, text, uuid, uuid, text)
  to authenticated, service_role;
