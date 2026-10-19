-- =============================================================================
-- 23_relatorio_por_forma.sql — resumo financeiro filtrado por forma (seção 13)
-- =============================================================================

do $$
declare
  v_fx       record;
  v_mesa     uuid;
  v_session  uuid;
  v_pix      public.orders;
  v_dinheiro public.orders;
  v_resumo   jsonb;
  v_base     jsonb;
  -- `now()` é o início DESTA transação: os pagamentos dos outros arquivos da
  -- suíte aconteceram antes, então o recorte isola o teste.
  v_de       timestamptz := now();
begin
  select * into v_fx from tests.fx;

  perform tests.login('ana.admin');

  if not exists (select 1 from public.cash_sessions where status = 'open') then
    perform public.start_cash_session(5000, 'Turno do teste 23');
  end if;

  select t.id into v_mesa
    from public.restaurant_tables t
   where t.number <> 12
     and not exists (select 1 from public.table_sessions s
                      where s.table_id = t.id and s.status = 'open')
   order by t.number
   limit 1;

  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 23'));

  v_pix := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 2))),
    '00000000-0000-0000-0000-000000000701'::uuid);

  v_dinheiro := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 3))),
    '00000000-0000-0000-0000-000000000702'::uuid);

  perform public.register_payment(v_pix.id, 'pix', v_pix.total_cents, null, false, null,
                                  '00000000-0000-0000-0000-000000000703'::uuid);
  perform public.register_payment(v_dinheiro.id, 'cash', v_dinheiro.total_cents,
                                  v_dinheiro.total_cents, false, null,
                                  '00000000-0000-0000-0000-000000000704'::uuid);

  v_base := public.get_financial_summary(v_de, v_de + interval '1 hour', null, null, null, null);

  -- Só Pix: o recebido é exatamente o pedido pago em Pix.
  v_resumo := public.get_financial_summary(v_de, v_de + interval '1 hour', null, null, null, 'pix');
  perform tests.eq_int((v_resumo ->> 'received_cents')::integer, v_pix.total_cents,
    'resumo filtrado por Pix recebe só o valor pago em Pix');
  perform tests.ok(
    (v_resumo ->> 'net_valid_cents')::integer = v_pix.total_cents,
    'resumo filtrado por Pix conta só o pedido que teve Pix');
  perform tests.ok(
    (v_base ->> 'received_cents')::integer
      = (v_resumo ->> 'received_cents')::integer
      + (public.get_financial_summary(v_de, v_de + interval '1 hour', null, null, null, 'cash') ->> 'received_cents')::integer,
    'a soma por forma fecha com o total sem filtro');

  -- Forma sem recebimento: nada entra, nada recebido.
  v_resumo := public.get_financial_summary(v_de, v_de + interval '1 hour', null, null, null, 'credit_card');
  perform tests.eq_int((v_resumo ->> 'received_cents')::integer, 0,
    'forma sem recebimento devolve recebido zero');
  perform tests.eq_int((v_resumo ->> 'orders_valid_count')::integer, 0,
    'forma sem recebimento devolve contagem de pedidos zero');

  -- Sem filtro continua igual ao de antes (parâmetro opcional).
  perform tests.ok((v_base ->> 'orders_valid_count')::integer >= 2,
    'sem filtro de forma o resumo continua completo');

  -- Só o administrador lê o resumo financeiro.
  perform tests.logout();
  perform tests.login('carlos.caixa');
  perform tests.expect_error(
    $sql$select public.get_financial_summary(now() - interval '1 day', now())$sql$,
    'FORBIDDEN', 'caixa não acessa o resumo financeiro do administrador');

  perform tests.logout();
end
$$;
