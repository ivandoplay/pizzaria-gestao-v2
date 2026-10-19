-- =============================================================================
-- 25_correcoes_da_auditoria.sql — prova dos achados B3, B7, B8 e B12
--
-- Reproduz o cenário do achado B3 (garçom que registra recebimento e não vê o
-- próprio registro), confirma que o delivery continua fora do alcance dele e
-- que a porta do `anon` foi fechada de verdade.
-- =============================================================================

do $$
declare
  v_fx       record;
  v_mesa     uuid;
  v_sessao   uuid;
  v_salao    public.orders;
  v_delivery public.orders;
  v_pagos    integer;
begin
  select * into v_fx from tests.fx;

  -- ---------- B7: anon não tem privilégio em tabela/view ----------
  perform tests.eq_bool(has_table_privilege('anon', 'public.orders', 'SELECT'), false,
    'anon não tem SELECT em orders');
  perform tests.eq_bool(has_table_privilege('anon', 'public.products', 'INSERT'), false,
    'anon não tem INSERT em products');
  perform tests.eq_bool(has_table_privilege('anon', 'public.order_overview', 'SELECT'), false,
    'anon não tem SELECT na view order_overview');

  -- ---------- B12: search_path fixo nos auxiliares ----------
  perform tests.eq_int(
    (select count(*)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app_private'
        and p.proname in ('set_updated_at', 'jwt_role', 'is_service', 'redact_jsonb')
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
           where cfg like 'search_path=%')),
    0, 'os auxiliares de app_private têm search_path fixo');

  perform tests.login('ana.admin');

  if not exists (select 1 from public.cash_sessions where status = 'open') then
    perform public.start_cash_session(5000, 'Turno do teste 25');
  end if;

  -- ---------- pedido do salão pago em Pix ----------
  select t.id into v_mesa
    from public.restaurant_tables t
   where t.number <> 12
     and t.is_active
     and not exists (select 1 from public.table_sessions s
                      where s.table_id = t.id and s.status = 'open')
   order by t.number
   limit 1;

  v_sessao := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 25'));

  v_salao := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_sessao,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))),
    '00000000-0000-0000-0000-000000000801'::uuid);

  perform public.register_payment(v_salao.id, 'pix', v_salao.total_cents, null, false, null,
                                  '00000000-0000-0000-0000-000000000802'::uuid);

  -- ---------- pedido de delivery ainda em aberto ----------
  v_delivery := public.create_order(
    jsonb_build_object(
      'service_mode', 'delivery',
      'customer', jsonb_build_object('name', 'Cliente Teste 25', 'phone', '(86) 97777-6666'),
      'address', jsonb_build_object(
        'street', 'Rua da Auditoria', 'number', '25', 'neighborhood', 'Centro Teste'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))),
    '00000000-0000-0000-0000-000000000803'::uuid);

  -- ---------- B3: o garçom vê o recebimento do salão ----------
  perform tests.logout();
  perform tests.login('gisele.garcom');

  select count(*) into v_pagos from public.payments where order_id = v_salao.id;
  perform tests.eq_int(v_pagos, 1, 'garçom vê o recebimento do pedido do salão');

  select count(*) into v_pagos from public.payments where order_id = v_delivery.id;
  perform tests.eq_int(v_pagos, 0, 'garçom continua sem ver recebimento de delivery');

  -- ---------- B8: nem por chamada direta ele registra no delivery ----------
  perform tests.expect_error(
    format(
      'select public.register_payment(%L, %L, %s, null, false, null, %L)',
      v_delivery.id, 'pix', 100,
      '00000000-0000-0000-0000-000000000804'),
    'FORBIDDEN',
    'garçom não registra recebimento de delivery nem chamando o RPC direto');

  -- O caixa continua pagando o delivery normalmente.
  perform tests.logout();
  perform tests.login('carlos.caixa');
  perform public.register_payment(v_delivery.id, 'cash', v_delivery.total_cents,
                                  v_delivery.total_cents, false, null,
                                  '00000000-0000-0000-0000-000000000805'::uuid);

  select count(*) into v_pagos from public.payments where order_id = v_delivery.id;
  perform tests.eq_int(v_pagos, 1, 'caixa registra o recebimento do delivery');

  -- ---------- o garçom vê o valor recebido da conta do salão ----------
  perform tests.logout();
  perform tests.login('gisele.garcom');
  perform tests.eq_int(
    (select paid_cents from public.orders where id = v_salao.id),
    v_salao.total_cents, 'garçom continua vendo o total recebido da conta');

  -- Limpeza: entrega o pedido e fecha a conta para não deixar mesa aberta.
  perform tests.logout();
  perform tests.login('ana.admin');
  perform public.advance_order_status(v_salao.id, 'preparing', 'Teste 25');
  perform public.advance_order_status(v_salao.id, 'ready', 'Teste 25');
  perform public.advance_order_status(v_salao.id, 'delivered_to_table', 'Teste 25');
  perform public.close_table_account(v_sessao);
end
$$;
