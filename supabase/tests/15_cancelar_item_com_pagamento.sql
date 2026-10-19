-- =============================================================================
-- 15_cancelar_item_com_pagamento.sql — cancelamento parcial com dinheiro (A8)
-- =============================================================================

do $$
declare
  v_fx      record;
  v_mesa    uuid;
  v_session uuid;
  v_order   public.orders;
  v_item    public.order_items;
begin
  select * into v_fx from tests.fx;

  perform tests.login('carlos.caixa');

  if not exists (select 1 from public.cash_sessions where status = 'open') then
    perform public.start_cash_session(5000, 'Turno do teste 15');
  end if;

  select t.id into v_mesa
    from public.restaurant_tables t
   where t.number <> 12
     and not exists (select 1 from public.table_sessions s
                      where s.table_id = t.id and s.status = 'open')
   order by t.number
   limit 1;

  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 15'));

  -- 2 x (pizza G 5000 + extra queijo 300) = 10600
  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 2,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-000000000301'::uuid);
  perform tests.eq_int(v_order.total_cents, 10600, 'pedido do teste: 2 x 5300');

  select * into v_item from public.order_items where order_id = v_order.id limit 1;

  -- Recebe 5000: o pedido ainda tem saldo.
  perform public.register_payment(v_order.id, 'pix', 5000, null, false, null,
                                  '00000000-0000-0000-0000-000000000302'::uuid);
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 5000,
    'recebimento parcial registrado');

  -- Cancelar as 2 unidades deixaria o total em 0 < 5000 recebidos: recusa com código.
  perform tests.expect_error(
    format($sql$select public.cancel_order_item(%L::uuid, 'Cliente desistiu de metade', 2)$sql$, v_item.id),
    'PAYMENT_REFUND_REQUIRED', 'cancelar item que deixaria o total abaixo do recebido é recusado');
  perform tests.eq_int((select quantity from public.order_items where id = v_item.id), 2,
    'o item continua intacto depois da recusa');
  perform tests.eq_int((select total_cents from public.orders where id = v_order.id), 10600,
    'o pedido continua com o total original depois da recusa');

  -- Cancelar 1 unidade deixa o total em 5300, ainda acima dos 5000 recebidos: permitido.
  perform public.cancel_order_item(v_item.id, 'Cliente reduziu a quantidade', 1);
  perform tests.eq_int((select quantity from public.order_items where id = v_item.id), 1,
    'cancelamento de uma unidade ajusta a quantidade');
  perform tests.eq_int((select total_cents from public.orders where id = v_order.id), 5300,
    'total recalculado para 5300');
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 5000,
    'valor recebido permanece registrado');

  perform tests.logout();
end
$$;
