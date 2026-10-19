-- =============================================================================
-- 20_desconto_abaixo_do_pago.sql — desconto não passa por baixo do recebido (A8)
-- =============================================================================

do $$
declare
  v_fx      record;
  v_mesa    uuid;
  v_session uuid;
  v_order   public.orders;
begin
  select * into v_fx from tests.fx;

  perform tests.login('ana.admin');

  if not exists (select 1 from public.cash_sessions where status = 'open') then
    perform public.start_cash_session(5000, 'Turno do teste 20');
  end if;

  select t.id into v_mesa
    from public.restaurant_tables t
   where t.number <> 12
     and not exists (select 1 from public.table_sessions s
                      where s.table_id = t.id and s.status = 'open')
   order by t.number
   limit 1;

  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 20'));

  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-000000000403'::uuid);
  perform tests.eq_int(v_order.total_cents, 5300, 'pedido do teste: pizza G 5000 + queijo 300');

  -- Recebe 4500 dos 5300.
  perform public.register_payment(v_order.id, 'pix', 4500, null, false, null,
                                  '00000000-0000-0000-0000-000000000404'::uuid);
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 4500,
    'recebimento parcial registrado');

  -- 20% deixaria o total em 4240, abaixo dos 4500 já recebidos: recusa com código.
  perform tests.expect_error(
    format($sql$select public.set_order_discount(%L::uuid, 'Cortesia do gerente', 20, null)$sql$, v_order.id),
    'DISCOUNT_BELOW_PAID', 'desconto que passaria por baixo do recebido é recusado');

  perform tests.eq_int((select total_cents from public.orders where id = v_order.id), 5300,
    'o total continua intacto depois da recusa');
  perform tests.eq_int((select discount_cents from public.orders where id = v_order.id), 0,
    'nenhum desconto foi gravado');
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 4500,
    'o recebimento continua registrado');

  -- 10% deixa o total exatamente no valor recebido: permitido.
  perform public.set_order_discount(v_order.id, 'Cortesia de 10%', 10, null);
  perform tests.eq_int((select total_cents from public.orders where id = v_order.id), 4770,
    'desconto de 10% reduz o total para 4770');
  perform tests.eq_int((select discount_cents from public.orders where id = v_order.id), 530,
    'desconto gravado em 530');
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 4500,
    'valor recebido permanece');

  perform tests.logout();
end
$$;
