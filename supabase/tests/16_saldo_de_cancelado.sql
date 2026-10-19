-- =============================================================================
-- 16_saldo_de_cancelado.sql — cancelado não entra em “a receber” (A9)
-- =============================================================================

do $$
declare
  v_fx      record;
  v_mesa    uuid;
  v_session uuid;
  v_ok      public.orders;
  v_cancel  public.orders;
  v_soma_antes bigint;
  v_soma_depois bigint;
begin
  select * into v_fx from tests.fx;

  perform tests.login('carlos.caixa');

  select t.id into v_mesa
    from public.restaurant_tables t
   where t.number not in (11, 12)
     and not exists (select 1 from public.table_sessions s
                      where s.table_id = t.id and s.status = 'open')
   order by t.number
   limit 1;

  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 16'));

  -- Pedido que segue válido, sem pagamento: tem saldo.
  v_ok := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))),
    '00000000-0000-0000-0000-000000000401'::uuid);
  perform tests.eq_int((select balance_cents from public.order_overview where id = v_ok.id), 700,
    'pedido válido continua com saldo');

  -- Segundo pedido, cancelado: não pode ter saldo.
  v_cancel := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 2))),
    '00000000-0000-0000-0000-000000000402'::uuid);
  select coalesce(sum(balance_cents), 0) into v_soma_antes
    from public.order_overview
   where account_closed_at is null and status <> 'cancelled';

  perform public.advance_order_status(v_cancel.id, 'cancelled', 'Pedido de teste cancelado');

  perform tests.eq_int((select balance_cents from public.order_overview where id = v_cancel.id), 0,
    'pedido cancelado não tem saldo a receber');
  perform tests.eq_int((select paid_cents from public.order_overview where id = v_cancel.id), 0,
    'pedido cancelado mantém o valor recebido registrado (zero)');
  perform tests.eq_int((select total_cents from public.order_overview where id = v_cancel.id), 1400,
    'pedido cancelado mantém o total para histórico');

  -- O que o painel soma cai exatamente o valor do pedido cancelado.
  select coalesce(sum(balance_cents), 0) into v_soma_depois
    from public.order_overview
   where account_closed_at is null and status <> 'cancelled';
  perform tests.eq_int(v_soma_depois, v_soma_antes - 1400,
    'soma “a receber” perde o valor do pedido cancelado');

  perform tests.logout();
end
$$;
