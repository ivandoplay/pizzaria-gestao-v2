-- =============================================================================
-- 0021 — Desconto não pode deixar o total abaixo do que já foi recebido
--
-- Achado irmão do A8, encontrado ao revisar os caminhos que diminuem o total de
-- um pedido depois de haver recebimento: `set_order_discount` aceitava qualquer
-- desconto até o subtotal, e o recálculo seguinte violava a constraint
-- `orders_paid_within_total` — o operador recebia
-- "new row for relation orders violates check constraint".
--
-- Agora a função calcula o total resultante e recusa, antes de gravar, com
-- DISCOUNT_BELOW_PAID e os dois valores. Comportamento normal não muda.
-- =============================================================================

create or replace function public.set_order_discount(
  p_order_id      uuid,
  p_reason        text,
  p_discount_pct  numeric default null,
  p_discount_cents integer default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile  public.profiles;
  v_order    public.orders;
  v_settings public.business_settings;
  v_reason   text;
  v_pct      numeric(5, 2);
  v_cents    integer;
  v_limit    numeric(5, 2);
begin
  v_profile := app_private.require_role('admin', 'manager');

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED: informe o motivo do desconto' using errcode = '22023';
  end if;
  if p_discount_pct is null and p_discount_cents is null then
    raise exception 'DISCOUNT_REQUIRED: informe percentual ou valor do desconto' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = '22023';
  end if;
  if v_order.account_closed_at is not null then
    raise exception 'ORDER_ACCOUNT_CLOSED: conta fechada; descontos exigem procedimento administrativo'
      using errcode = '55006';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED' using errcode = '55006';
  end if;
  if v_order.subtotal_cents <= 0 then
    raise exception 'EMPTY_ORDER: pedido sem itens válidos' using errcode = '22023';
  end if;

  select * into v_settings from public.business_settings where id;

  if p_discount_pct is not null then
    v_pct := round(p_discount_pct, 2);
    v_cents := round(v_order.subtotal_cents::numeric * v_pct / 100)::integer;
  else
    v_cents := greatest(p_discount_cents, 0);
    v_pct := round((v_cents::numeric / v_order.subtotal_cents::numeric) * 100, 2);
  end if;

  if v_cents > v_order.subtotal_cents then
    raise exception 'DISCOUNT_TOO_HIGH: desconto maior que o subtotal do pedido' using errcode = '22023';
  end if;

  -- O desconto não pode derrubar o total abaixo do que já foi recebido: o
  -- recálculo esbarraria em `orders_paid_within_total` e o operador veria um
  -- erro cru de constraint. Aqui o caminho é explícito: estornar primeiro.
  if greatest(v_order.subtotal_cents - v_cents, 0) + v_order.delivery_fee_cents < v_order.paid_cents then
    raise exception 'DISCOUNT_BELOW_PAID: o desconto deixaria o total em R$ %, abaixo dos R$ % já recebidos; estorne o recebimento antes de aplicar o desconto',
      to_char((greatest(v_order.subtotal_cents - v_cents, 0) + v_order.delivery_fee_cents)::numeric / 100, 'FM999990.00'),
      to_char(v_order.paid_cents::numeric / 100, 'FM999990.00')
      using errcode = '22023';
  end if;

  -- Limite por perfil: caixa até max_discount_pct_without_auth; admin até o teto.
  v_limit := case when v_profile.role = 'admin'
                  then v_settings.max_discount_pct_hard
                  else v_settings.max_discount_pct_without_auth end;

  if v_pct > v_limit then
    raise exception 'DISCOUNT_LIMIT_EXCEEDED: desconto de %%% acima do limite de %%% para o perfil %; solicite autorização do administrador',
      v_pct, v_limit, v_profile.role using errcode = '42501';
  end if;

  update public.orders o
     set discount_cents        = v_cents,
         discount_pct          = v_pct,
         discount_reason       = v_reason,
         discount_authorized_by = v_profile.id
   where o.id = v_order.id;

  perform app_private.recalc_order_totals(v_order.id);
  select o.* into v_order from public.orders o where o.id = v_order.id;

  perform app_private.log_audit(
    'order.discount', 'orders', v_order.id::text, v_order.order_number, v_order.table_session_id,
    v_order.cash_session_id, v_cents, v_reason,
    jsonb_build_object('discount_pct', v_pct, 'limit_pct', v_limit, 'role', v_profile.role)
  );

  return v_order;
end
$$;
