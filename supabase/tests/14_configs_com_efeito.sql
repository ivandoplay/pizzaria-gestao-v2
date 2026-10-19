-- =============================================================================
-- 14_configs_com_efeito.sql — mínimo de delivery e pagamento dividido (A6)
-- =============================================================================
-- Antes desta correção as duas configurações existiam só na tela: o servidor
-- não lia nenhuma delas.
-- =============================================================================

-- ------------------------------------------------ 1) pedido mínimo de delivery
do $$
declare
  v_fx      record;
  v_antes   bigint;
  v_pedido  public.orders;
begin
  select * into v_fx from tests.fx;

  perform tests.login('ana.admin');
  update public.business_settings set min_delivery_order_cents = 2000 where id;
  perform tests.logout();

  perform tests.login('carlos.caixa');

  select count(*) into v_antes from public.orders;

  -- 1 refrigerante = R$ 7,00 em itens (a taxa de R$ 8,00 não conta): recusado.
  perform tests.expect_error(
    format($sql$
      select public.create_order(%L::jsonb, '00000000-0000-0000-0000-000000000f01'::uuid)
    $sql$, jsonb_build_object(
      'service_mode', 'delivery',
      'customer', jsonb_build_object('name', 'Cliente Mínimo', 'phone', '(86) 97777-6666'),
      'address', jsonb_build_object('street', 'Rua A', 'number', '10', 'neighborhood', 'Centro Teste'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))
    )::text),
    'DELIVERY_MINIMUM_NOT_MET', 'delivery abaixo do mínimo é recusado');
  perform tests.eq_int((select count(*) from public.orders), v_antes,
    'pedido recusado pelo mínimo não deixa registro');

  -- 3 refrigerantes = R$ 21,00 em itens: aceito.
  v_pedido := public.create_order(
    jsonb_build_object(
      'service_mode', 'delivery',
      'customer', jsonb_build_object('name', 'Cliente Mínimo', 'phone', '(86) 97777-6666'),
      'address', jsonb_build_object('street', 'Rua A', 'number', '10', 'neighborhood', 'Centro Teste'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 3))
    ),
    '00000000-0000-0000-0000-000000000f02'::uuid);
  perform tests.eq_int(v_pedido.subtotal_cents, 2100, 'pedido no mínimo: itens somam R$ 21,00');

  -- Mínimo em zero desliga a exigência (comportamento anterior preservado).
  perform tests.logout();
  perform tests.login('ana.admin');
  update public.business_settings set min_delivery_order_cents = 0 where id;
  perform tests.logout();
  perform tests.login('carlos.caixa');
  v_pedido := public.create_order(
    jsonb_build_object(
      'service_mode', 'delivery',
      'customer', jsonb_build_object('name', 'Cliente Mínimo', 'phone', '(86) 97777-6666'),
      'address', jsonb_build_object('street', 'Rua A', 'number', '10', 'neighborhood', 'Centro Teste'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))
    ),
    '00000000-0000-0000-0000-000000000f03'::uuid);
  perform tests.eq_int(v_pedido.subtotal_cents, 700, 'mínimo 0 aceita pedido pequeno');
  perform tests.logout();
end
$$;

-- ------------------------------------------------ 2) pagamento dividido
do $$
declare
  v_fx      record;
  v_mesa    uuid;
  v_session uuid;
  v_order   public.orders;
begin
  select * into v_fx from tests.fx;

  perform tests.login('carlos.caixa');

  -- Garante um caixa aberto para os recebimentos.
  if not exists (select 1 from public.cash_sessions where status = 'open') then
    perform public.start_cash_session(5000, 'Turno do teste 14');
  end if;

  select t.id into v_mesa
    from public.restaurant_tables t
   where t.number between 9 and 12
     and not exists (select 1 from public.table_sessions s
                      where s.table_id = t.id and s.status = 'open')
   order by t.number
   limit 1;

  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 14'));

  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-0000000000f1'::uuid);
  perform tests.eq_int(v_order.total_cents, 5300, 'pedido do teste de pagamento dividido');

  perform tests.logout();
  perform tests.login('ana.admin');
  update public.business_settings set split_payment_enabled = false where id;
  perform tests.logout();
  perform tests.login('carlos.caixa');

  -- Primeira parcela em Pix: permitida.
  perform public.register_payment(v_order.id, 'pix', 3000, null, false, null,
                                  '00000000-0000-0000-0000-0000000000f2'::uuid);

  -- Segunda parcela em OUTRA forma: recusada.
  perform tests.expect_error(
    format($sql$select public.register_payment(%L::uuid, 'cash', 2300, 2300)$sql$, v_order.id),
    'SPLIT_PAYMENT_DISABLED', 'segunda forma de pagamento é recusada com a configuração desligada');

  -- Segunda parcela na MESMA forma: permitida (continua sendo um recebimento parcial).
  perform public.register_payment(v_order.id, 'pix', 2300, null, false, null,
                                  '00000000-0000-0000-0000-0000000000f3'::uuid);
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 5300,
    'parcelas na mesma forma quitam o pedido');

  -- Com a configuração ligada, a segunda forma volta a ser aceita.
  perform tests.logout();
  perform tests.login('ana.admin');
  update public.business_settings set split_payment_enabled = true where id;
  perform tests.logout();
  perform tests.login('carlos.caixa');

  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-0000000000f4'::uuid);
  perform public.register_payment(v_order.id, 'pix', 1000, null, false, null,
                                  '00000000-0000-0000-0000-0000000000f5'::uuid);
  perform public.register_payment(v_order.id, 'cash', 1000, 1000, false, null,
                                  '00000000-0000-0000-0000-0000000000f6'::uuid);
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 2000,
    'com a configuração ligada, duas formas diferentes somam no pedido');

  perform tests.logout();
end
$$;
