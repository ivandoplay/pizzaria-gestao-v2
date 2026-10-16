-- =============================================================================
-- 09_fila_prontos.sql — fila de pedidos prontos para o garçom (migração 0010)
-- =============================================================================
-- A fila é uma VISÃO dos pedidos que já existem: nada de tabela nova. O que
-- precisa ficar provado aqui:
--
--   1. `order_overview` expõe `ready_at` (tempo real de cozinha) e
--      `session_status` — sem isso a fila ordenaria por `created_at`, contando
--      um tempo que não é o da espera;
--   2. o recorte da fila (mesmo filtro da tela) mostra só pedido de salão,
--      pronto, de atendimento aberto e conta em aberto;
--   3. garçom entrega pedido pronto do salão e o pedido sai da fila;
--   4. garçom NÃO usa a entrega para outras transições;
--   5. pedido que não está pronto, pedido de delivery e pedido de atendimento
--      encerrado são recusados — e o pedido continua intacto depois da recusa;
--   6. segunda confirmação do mesmo pedido é recusada;
--   7. o histórico registra autor, estados anterior/novo e horário.
--
-- Roda no banco de TESTE (tools/run-sql-tests.sh). Usa as mesas 9 e 10, que
-- nenhum outro arquivo da suíte ocupa.
-- =============================================================================

-- ------------------------------------------------- 1) tempo real de cozinha
do $$
declare
  v_fx record;
  v_mesa9 uuid;
  v_session uuid;
  v_order public.orders;
  v_outro public.orders;
  v_pronto timestamptz;
  v_visao record;
begin
  select * into v_fx from tests.fx;
  select id into v_mesa9 from public.restaurant_tables where number = 9;

  -- O garçom abre a mesa e lança dois pedidos.
  perform tests.login('gisele.garcom');

  v_session := (public.open_table_session(v_mesa9, 2::smallint, null,
                                          '00000000-0000-0000-0000-0000000000e1'::uuid)).id;

  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 2))),
    '00000000-0000-0000-0000-0000000000e2'::uuid);

  -- Este segundo pedido fica "recebido": serve para provar que pedido que não
  -- está pronto não é entregável.
  v_outro := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))),
    '00000000-0000-0000-0000-0000000000e3'::uuid);

  perform tests.logout();

  -- O caixa conduz a produção até "pronto".
  perform tests.login('carlos.caixa');
  perform public.advance_order_status(v_order.id, 'confirmed');
  perform public.advance_order_status(v_order.id, 'preparing');
  perform public.advance_order_status(v_order.id, 'ready');

  perform tests.ok(
    (select ready_at is not null from public.orders where id = v_order.id),
    'ao ficar pronto, o pedido recebe ready_at');

  select ready_at into v_pronto from public.orders where id = v_order.id;
  perform tests.logout();

  -- 1) a view passa a mostrar o horário real e a situação do atendimento
  select ready_at, session_status, status into v_visao
    from public.order_overview where id = v_order.id;

  perform tests.ok(v_visao.ready_at is not null, 'order_overview expõe ready_at');
  perform tests.eq_text(v_visao.session_status, 'open', 'order_overview expõe a situação do atendimento');
  perform tests.eq_text(v_visao.status, 'ready', 'pedido pronto aparece como "ready" na view');

  -- 2) o recorte da fila, do ponto de vista do garçom (mesmo filtro da tela)
  perform tests.login('gisele.garcom');
  perform tests.eq_int(
    (select count(*) from public.order_overview
      where status = 'ready' and service_mode = 'dine_in'
        and account_closed_at is null and session_status = 'open'
        and id = v_order.id),
    1, 'pedido pronto da mesa aparece na fila do garçom');
  perform tests.eq_int(
    (select count(*) from public.order_overview
      where status = 'ready' and service_mode = 'dine_in'
        and account_closed_at is null and session_status = 'open'
        and id = v_outro.id),
    0, 'pedido ainda em produção NÃO aparece na fila');
  perform tests.logout();
end
$$;

-- ------------------------------ 2) regras de entrega (matriz de validação)
do $$
declare
  v_fx record;
  v_mesa9 uuid;
  v_mesa10 uuid;
  v_session9 uuid;
  v_session10 uuid;
  v_pronto public.orders;
  v_nao_pronto public.orders;
  v_delivery public.orders;
  v_encerrado public.orders;
  v_hist record;
begin
  select * into v_fx from tests.fx;
  select id into v_mesa9 from public.restaurant_tables where number = 9;
  select id into v_mesa10 from public.restaurant_tables where number = 10;

  select id into v_session9 from public.table_sessions
   where table_id = v_mesa9 and status = 'open';
  select id into v_pronto from public.orders
   where table_session_id = v_session9 and status = 'ready';
  select id into v_nao_pronto from public.orders
   where table_session_id = v_session9 and status = 'received';

  -- O caixa lança um pedido de delivery e o leva até "pronto".
  perform tests.login('carlos.caixa');

  v_delivery := public.create_order(
    jsonb_build_object(
      'service_mode', 'delivery',
      'customer', jsonb_build_object('name', 'Cliente Fila', 'phone', '(86) 97777-6666'),
      'address', jsonb_build_object('street', 'Rua Teste', 'number', '10', 'neighborhood', 'Centro Teste'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))),
    '00000000-0000-0000-0000-0000000000e4'::uuid);
  perform public.advance_order_status(v_delivery.id, 'confirmed');
  perform public.advance_order_status(v_delivery.id, 'preparing');
  perform public.advance_order_status(v_delivery.id, 'ready');
  perform tests.logout();

  -- 3) o garçom entrega o pedido pronto do salão
  perform tests.login('gisele.garcom');

  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'confirmed')$sql$, v_pronto.id),
    'FORBIDDEN', 'garçom não confirma pedido nem por engano');

  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'preparing')$sql$, v_pronto.id),
    'FORBIDDEN', 'garçom não devolve pedido pronto para a produção');

  -- 4) pedido que não está pronto
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'delivered_to_table')$sql$, v_nao_pronto.id),
    'INVALID_TRANSITION', 'pedido ainda em produção não pode ser entregue à mesa');

  -- 5) pedido de delivery
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'delivered_to_table')$sql$, v_delivery.id),
    'INVALID_TRANSITION', 'pedido de delivery não é entregue à mesa');

  -- o pedido recusado continua intacto
  perform tests.eq_text((select status from public.orders where id = v_nao_pronto.id),
    'received', 'depois da recusa, o pedido continua na situação em que estava');

  -- 6) a entrega válida
  perform public.advance_order_status(v_pronto.id, 'delivered_to_table');

  perform tests.eq_text((select status from public.orders where id = v_pronto.id),
    'delivered_to_table', 'garçom confirma a entrega do pedido pronto');
  perform tests.ok((select delivered_at is not null from public.orders where id = v_pronto.id),
    'a entrega registra o horário');

  select from_status, to_status, changed_by, changed_at into v_hist
    from public.order_status_history
   where order_id = v_pronto.id and to_status = 'delivered_to_table';
  perform tests.eq_text(v_hist.from_status, 'ready', 'histórico guarda de onde veio');
  perform tests.eq_text(v_hist.to_status, 'delivered_to_table', 'histórico guarda para onde foi');
  perform tests.eq_text(v_hist.changed_by::text,
    (select id::text from public.profiles where login = 'gisele.garcom'),
    'histórico guarda quem entregou');
  perform tests.ok(v_hist.changed_at is not null, 'histórico guarda o horário');

  -- 7) segunda confirmação do mesmo pedido
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'delivered_to_table')$sql$, v_pronto.id),
    'NO_STATUS_CHANGE', 'confirmar duas vezes o mesmo pedido é recusado');

  -- o pedido entregue sai da fila
  perform tests.eq_int(
    (select count(*) from public.order_overview
      where status = 'ready' and service_mode = 'dine_in'
        and account_closed_at is null and session_status = 'open'
        and id = v_pronto.id),
    0, 'pedido entregue sai da fila');

  perform tests.logout();

  -- ---------------------------------------------------- 3) atendimento fechado
  perform tests.login('gisele.garcom');
  v_session10 := (public.open_table_session(v_mesa10, 2::smallint, null,
                                            '00000000-0000-0000-0000-0000000000e5'::uuid)).id;
  v_encerrado := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session10,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))),
    '00000000-0000-0000-0000-0000000000e6'::uuid);
  perform tests.logout();

  perform tests.login('carlos.caixa');
  perform public.advance_order_status(v_encerrado.id, 'confirmed');
  perform public.advance_order_status(v_encerrado.id, 'preparing');
  perform public.advance_order_status(v_encerrado.id, 'ready');
  perform tests.logout();

  -- A conta é encerrada com o pedido ainda na fila (cliente foi embora).
  perform tests.login('ana.admin');
  perform public.close_table_account(v_session10, true, 'teste da fila: conta encerrada antes da entrega');
  perform tests.logout();

  perform tests.login('gisele.garcom');
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'delivered_to_table')$sql$, v_encerrado.id),
    'SESSION_NOT_OPEN', 'pedido de atendimento encerrado não pode ser entregue');

  perform tests.eq_text((select status from public.orders where id = v_encerrado.id),
    'ready', 'depois da recusa, o pedido continua pronto (nada foi entregue pela metade)');

  -- O atendimento encerrado sai da fila, mesmo com o pedido em "pronto".
  perform tests.eq_int(
    (select count(*) from public.order_overview
      where status = 'ready' and service_mode = 'dine_in'
        and account_closed_at is null and session_status = 'open'
        and id = v_encerrado.id),
    0, 'pedido de atendimento encerrado não aparece na fila');
  perform tests.logout();

  -- Cinto e suspensório: se a conta estiver marcada como fechada mas a sessão
  -- ainda aparecer aberta (estado que só existe em conserto manual), a entrega
  -- também é recusada. Aqui o atendimento é reaberto de propósito, sob o
  -- postgres, só para exercitar essa guarda.
  update public.table_sessions set status = 'open', closed_at = null where id = v_session10;

  perform tests.login('gisele.garcom');
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'delivered_to_table')$sql$, v_encerrado.id),
    'ORDER_ACCOUNT_CLOSED', 'conta marcada como fechada também recusa a entrega');
  perform tests.logout();

  update public.table_sessions
     set status = 'closed', closed_at = now()
   where id = v_session10;

  -- Deixa as mesas como a suíte espera encontrá-las (nenhum atendimento aberto
  -- sobrando nas mesas usadas por este arquivo).
  perform tests.login('ana.admin');
  perform public.close_table_account(v_session9, true, 'limpeza do teste da fila');
  perform tests.logout();
end
$$;
