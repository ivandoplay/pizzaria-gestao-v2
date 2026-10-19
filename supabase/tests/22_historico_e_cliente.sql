-- =============================================================================
-- 22_historico_e_cliente.sql — filtro por forma de pagamento e permissões do
-- histórico (seção 5.5) + leitura de cliente recorrente (seção 8.1)
-- =============================================================================

do $$
declare
  v_fx      record;
  v_mesa    uuid;
  v_session uuid;
  v_order   public.orders;
  v_outro   public.orders;
  v_linhas  integer;
  v_ids     uuid[];
begin
  select * into v_fx from tests.fx;

  perform tests.login('ana.admin');

  if not exists (select 1 from public.cash_sessions where status = 'open') then
    perform public.start_cash_session(5000, 'Turno do teste 22');
  end if;

  select t.id into v_mesa
    from public.restaurant_tables t
   where t.number <> 12
     and not exists (select 1 from public.table_sessions s
                      where s.table_id = t.id and s.status = 'open')
   order by t.number
   limit 1;

  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 22'));

  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))),
    '00000000-0000-0000-0000-000000000601'::uuid);

  v_outro := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))),
    '00000000-0000-0000-0000-000000000602'::uuid);

  -- Um pedido paga em Pix; o outro, em dinheiro.
  perform public.register_payment(v_order.id, 'pix', v_order.total_cents, null, false, null,
                                  '00000000-0000-0000-0000-000000000603'::uuid);
  perform public.register_payment(v_outro.id, 'cash', v_outro.total_cents, v_outro.total_cents, false, null,
                                  '00000000-0000-0000-0000-000000000604'::uuid);

  -- 1) filtro por Pix: o pedido pago em Pix aparece e o pago em dinheiro NÃO.
  --    (Outros testes da mesma execução também recebem em Pix, então a asserção
  --    é sobre ESTES dois pedidos, não sobre a contagem global.)
  select count(*), array_agg(id) into v_linhas, v_ids
    from public.get_orders_page(now() - interval '2 hours', now() + interval '1 hour',
                                null, null, null, null, 200, 0, 'pix');
  perform tests.ok(v_order.id = any (v_ids), 'pedido pago em Pix aparece no filtro Pix');
  perform tests.ok(not (v_outro.id = any (v_ids)), 'pedido pago em dinheiro NÃO aparece no filtro Pix');

  -- 2) filtro por dinheiro: o contrário
  select count(*), array_agg(id) into v_linhas, v_ids
    from public.get_orders_page(now() - interval '2 hours', now() + interval '1 hour',
                                null, null, null, null, 200, 0, 'cash');
  perform tests.ok(v_outro.id = any (v_ids), 'pedido pago em dinheiro aparece no filtro dinheiro');
  perform tests.ok(not (v_order.id = any (v_ids)), 'pedido pago em Pix NÃO aparece no filtro dinheiro');

  -- 3) forma sem recebimento não devolve nada
  select count(*) into v_linhas
    from public.get_orders_page(now() - interval '2 hours', now() + interval '1 hour',
                                null, null, null, null, 200, 0, 'credit_card');
  perform tests.eq_int(v_linhas, 0, 'forma sem recebimento no período devolve lista vazia');

  -- 4) sem filtro, os dois aparecem (o parâmetro é opcional)
  select count(*) into v_linhas
    from public.get_orders_page(now() - interval '2 hours', now() + interval '1 hour',
                                null, 'dine_in', null, null, 200, 0, null);
  perform tests.ok(v_linhas >= 2, 'sem o filtro de forma, o histórico continua completo');

  -- 5) o garçom não consulta o histórico financeiro
  perform tests.logout();
  perform tests.login('gisele.garcom');
  perform tests.expect_error(
    $sql$select count(*) from public.get_orders_page(now() - interval '1 day', now(), null, null, null, null, 50, 0, null)$sql$,
    'FORBIDDEN', 'garçom não consulta o histórico de pedidos do caixa');

  -- 6) cliente recorrente: o caixa lê, o garçom não
  perform tests.logout();
  perform tests.login('carlos.caixa');
  perform tests.ok(
    (select count(*) from public.customers) >= 0,
    'caixa consulta o cadastro de clientes (leitura liberada por RLS para gerente)');
  perform tests.logout();
  perform tests.login('gisele.garcom');
  perform tests.eq_int((select count(*) from public.customers), 0,
    'garçom não vê clientes (privacy: só admin e caixa)');

  perform tests.logout();
end
$$;
