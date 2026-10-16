-- =============================================================================
-- 11_fechamento_seguro.sql — a mesa não é liberada com pedido em andamento
-- =============================================================================
-- Achado de auditoria (16/10/2026, migração 0012): `close_table_account`
-- calculava os pedidos em andamento e gravava na auditoria, mas não impedia o
-- fechamento — dava para liberar a mesa com pedido `preparing`/`ready` e a
-- entrega passava a ser recusada (pedido preso, cozinha produzindo para mesa
-- já liberada).
--
-- O que este arquivo prova:
--   1. fechamento NORMAL é recusado enquanto houver pedido aguardando ação;
--   2. pedido entregue ou cancelado não bloqueia (a mesa fecha normalmente);
--   3. fechamento EXCEPCIONAL (administrador) exige justificativa e CANCELA os
--      pendentes com ela, com histórico e auditoria — nada fica preso;
--   4. pedido com dinheiro recebido não é cancelado em silêncio: exige estorno;
--   5. mesa sem consumo pode ser encerrada normalmente (não fica presa);
--   6. `cash_session_is_open()` responde ao salão sem vazar valores;
--   7. o garçom não força fechamento (não regrediu).
-- =============================================================================

-- ------------------------------------- 1) pedido em andamento bloqueia o fechar
do $$
declare
  v_fx record;
  v_mesa uuid;
  v_session uuid;
  v_order public.orders;
  v_fechamento jsonb;
begin
  select * into v_fx from tests.fx;
  select id into v_mesa from public.restaurant_tables where number = 11;

  perform tests.login('carlos.caixa');
  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 11',
                                                        '00000000-0000-0000-0000-000000000201'::uuid));
  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-000000000202'::uuid);
  perform tests.eq_int(v_order.total_cents, 5300, '11.1 pedido de teste: 5300');

  -- `received` (recém-lançado) já bloqueia: o pedido ainda vai ser produzido
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid)$sql$, v_session),
    'ORDERS_IN_PROGRESS', '11.2 pedido recém-lançado impede o fechamento');

  -- e continua bloqueando em cada etapa até ser entregue
  perform public.advance_order_status(v_order.id, 'confirmed');
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid)$sql$, v_session),
    'ORDERS_IN_PROGRESS', '11.3 pedido confirmado impede o fechamento');
  perform public.advance_order_status(v_order.id, 'preparing');
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid)$sql$, v_session),
    'ORDERS_IN_PROGRESS', '11.4 pedido em preparo impede o fechamento');
  perform public.advance_order_status(v_order.id, 'ready');
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid)$sql$, v_session),
    'ORDERS_IN_PROGRESS', '11.5 pedido pronto aguardando entrega impede o fechamento');

  -- a mesa segue ocupada e o atendimento, aberto
  perform tests.eq_text((select status from public.table_overview where number = 11),
    'occupied', '11.6 a mesa continua ocupada depois da recusa');

  -- 2) entregue e quitado, fecha normalmente
  perform public.advance_order_status(v_order.id, 'delivered_to_table');
  perform public.register_payment(v_order.id, 'pix', 5300, null, false, null,
    '00000000-0000-0000-0000-000000000209'::uuid);
  v_fechamento := public.close_table_account(v_session);
  perform tests.eq_int((v_fechamento ->> 'orders_in_production')::bigint, 0,
    '11.7 pedido entregue não conta como pendência');
  perform tests.eq_text((select status from public.table_overview where number = 11),
    'available', '11.8 mesa liberada depois da entrega e do fechamento');

  perform tests.logout();
end
$$;

-- ------------------- 2) fechamento excepcional cancela o pendente (não prende)
do $$
declare
  v_fx record;
  v_mesa uuid;
  v_session uuid;
  v_order public.orders;
  v_fechamento jsonb;
begin
  select * into v_fx from tests.fx;
  select id into v_mesa from public.restaurant_tables where number = 12;

  perform tests.login('carlos.caixa');
  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 11 forçado',
                                                        '00000000-0000-0000-0000-000000000203'::uuid));
  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 2))),
    '00000000-0000-0000-0000-000000000204'::uuid);
  perform public.advance_order_status(v_order.id, 'confirmed');
  perform public.advance_order_status(v_order.id, 'preparing');

  -- o caixa não força o fechamento: a exceção é do administrador
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid, true, 'Forçado pelo caixa')$sql$, v_session),
    'FORBIDDEN', '11.9a o caixa não força fechamento');
  perform tests.logout();

  -- o administrador força, mas a pendência exige justificativa
  perform tests.login('ana.admin');
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid, true, 'ab')$sql$, v_session),
    'REASON_REQUIRED', '11.9 fechamento excepcional com pendência exige justificativa');
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid, true)$sql$, v_session),
    'REASON_REQUIRED', '11.10 forçar sem motivo é recusado');
  v_fechamento := public.close_table_account(v_session, true,
    'cliente foi embora durante o preparo — não entregue');
  perform tests.eq_int((v_fechamento ->> 'orders_cancelled_on_close')::bigint, 1,
    '11.11 o fechamento excepcional cancela 1 pedido pendente');
  perform tests.eq_text((select status from public.orders where id = v_order.id),
    'cancelled', '11.12 o pedido pendente ficou cancelado, não preso em produção');
  perform tests.eq_text((select cancel_reason from public.orders where id = v_order.id),
    'cliente foi embora durante o preparo — não entregue', '11.13 a justificativa ficou no pedido');
  perform tests.ok(
    exists (select 1 from public.order_status_history h
             where h.order_id = v_order.id and h.to_status = 'cancelled' and h.from_status = 'preparing'),
    '11.14 o histórico registra de/para do cancelamento no fechamento');
  perform tests.ok(
    exists (select 1 from public.audit_logs a
             where a.action = 'order.status.cancelled' and a.entity_id = v_order.id::text
               and (a.details ->> 'on_session_close') = 'true'),
    '11.15 o cancelamento no fechamento fica auditado com a marca do fechamento');

  -- nenhum pedido ficou "em produção" numa sessão fechada: nada preso
  perform tests.eq_int(
    (select count(*) from public.orders
      where table_session_id = v_session
        and status in ('received', 'confirmed', 'preparing', 'ready')),
    0, '11.16 não sobra pedido em andamento em atendimento encerrado');

  -- a entrega do pedido cancelado continua recusada
  perform tests.logout();
  perform tests.login('gisele.garcom');
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'delivered_to_table')$sql$, v_order.id),
    'CANCELLED', '11.17 pedido cancelado no fechamento não aceita entrega');
  perform tests.logout();
end
$$;

-- --------------------------- 3) dinheiro recebido exige estorno, não silêncio
do $$
declare
  v_fx record;
  v_mesa uuid;
  v_session uuid;
  v_order public.orders;
  v_fechamento jsonb;
begin
  select * into v_fx from tests.fx;
  select id into v_mesa from public.restaurant_tables where number = 8;

  perform tests.login('carlos.caixa');
  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 11 estorno',
                                                        '00000000-0000-0000-0000-000000000205'::uuid));
  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))),
    '00000000-0000-0000-0000-000000000206'::uuid);
  perform public.advance_order_status(v_order.id, 'confirmed');
  perform public.advance_order_status(v_order.id, 'preparing');
  perform public.register_payment(v_order.id, 'pix', 500, null, false, null,
    '00000000-0000-0000-0000-000000000207'::uuid);

  perform tests.logout();
  perform tests.login('ana.admin');
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid, true, 'fechamento com dinheiro recebido')$sql$, v_session),
    'PAYMENT_REFUND_REQUIRED',
    '11.18 fechar cancelando pedido com dinheiro recebido exige estorno antes');

  -- com o estorno feito, o fechamento excepcional passa e cancela o pedido
  perform tests.logout();
  perform tests.login('carlos.caixa');
  perform public.reverse_payment(
    (select id from public.payments where order_id = v_order.id and status = 'confirmed'),
    'estorno antes do fechamento (teste 11)');
  perform public.advance_order_status(v_order.id, 'cancelled', 'cancelado no balcão (teste 11)');

  -- atendimento sem pedido pendente e sem saldo: fecha normalmente
  v_fechamento := public.close_table_account(v_session);
  perform tests.eq_int((v_fechamento ->> 'total_cents')::bigint, 0,
    '11.19 pedido cancelado não entra no total fechado');
  perform tests.eq_text((select status from public.table_overview where number = 8),
    'available', '11.20 mesa liberada depois do cancelamento e do fechamento');
  perform tests.logout();
end
$$;

-- ------------------------------------------ 4) mesa sem consumo também fecha
do $$
declare
  v_mesa uuid;
  v_session uuid;
  v_fechamento jsonb;
begin
  select id into v_mesa from public.restaurant_tables where number = 3;

  perform tests.login('gisele.garcom');
  v_session := (select id from public.open_table_session(v_mesa, 4::smallint, 'Sentou e não pediu',
                                                        '00000000-0000-0000-0000-000000000208'::uuid));

  -- sem pedido nenhum: nada bloqueia, o garçom encerra o atendimento
  v_fechamento := public.close_table_account(v_session);
  perform tests.eq_int((v_fechamento ->> 'total_cents')::bigint, 0,
    '11.21 atendimento sem consumo fecha com total zero');
  perform tests.eq_int((v_fechamento ->> 'orders_cancelled_on_close')::bigint, 0,
    '11.22 nada é cancelado quando não há pedido');
  perform tests.eq_text((select status from public.table_overview where number = 3),
    'available', '11.23 mesa sem consumo é liberada');

  -- e o garçom não força fechamento (não regrediu com a 0012)
  perform tests.logout();
end
$$;

-- ---------------------- 5) o salão sabe do caixa sem ver valores (0012)
do $$
begin
  -- há turno aberto nesta altura da suíte (o arquivo 10 deixou um)
  perform tests.login('gisele.garcom');
  perform tests.eq_bool(public.cash_session_is_open(), true,
    '11.24 garçom sabe que o caixa está aberto sem ler a gaveta');

  perform tests.logout();
  perform tests.login_anon();
  perform tests.expect_denied(
    'select public.cash_session_is_open()',
    '11.25 visitante anônimo não pergunta pelo caixa');
  perform tests.logout();
end
$$;
