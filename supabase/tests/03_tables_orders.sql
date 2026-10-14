-- =============================================================================
-- 03_tables_orders.sql — mesas, atendimentos, pedidos e fluxo de produção
-- =============================================================================
-- Critérios (seção 17): "mesas e atendimentos consistentes"; "pedido enviado à
-- produção com histórico de situação"; "pedido nunca é duplicado".
-- =============================================================================

-- --------------------------------------------------- 1) abrir e travar a mesa
do $$
declare
  v_fx record;
  v_mesa7 uuid;
  v_s1 public.table_sessions;
  v_s2 public.table_sessions;
  v_status text;
begin
  select * into v_fx from tests.fx;
  select id into v_mesa7 from public.restaurant_tables where number = 7;

  perform tests.login('gisele.garcom');

  v_s1 := public.open_table_session(v_mesa7, 4::smallint, 'Aniversário', '00000000-0000-0000-0000-0000000000b1'::uuid);
  perform tests.ok(v_s1.id is not null, 'garçom abre o atendimento da mesa 7');
  perform tests.eq_int(v_s1.guest_count, 4::bigint, 'número de pessoas registrado');
  perform tests.eq_text(v_s1.status, 'open', 'atendimento aberto');

  -- requisição repetida (mesmo client_uuid) devolve o MESMO atendimento
  v_s2 := public.open_table_session(v_mesa7, 4::smallint, 'Aniversário', '00000000-0000-0000-0000-0000000000b1'::uuid);
  perform tests.eq_text(v_s2.id::text, v_s1.id::text, 'clique repetido não abre dois atendimentos');

  perform tests.eq_int((select count(*) from public.table_sessions where table_id = v_mesa7), 1,
    'existe exatamente um atendimento nessa mesa');

  -- mesa ocupada recusa novo atendimento
  perform tests.expect_error(
    format($sql$select public.open_table_session(%L::uuid, 2::smallint, null, %L::uuid)$sql$,
           v_mesa7, '00000000-0000-0000-0000-0000000000b2'),
    'TABLE_ALREADY_OPEN', 'mesa já ocupada recusa novo atendimento');

  select status into v_status from public.table_overview where id = v_mesa7;
  perform tests.eq_text(v_status, 'occupied', 'mapa de mesas mostra a mesa como ocupada');

  perform tests.logout();
end
$$;

-- ----------------------------------- 2) pedido do garçom e fluxo até a entrega
do $$
declare
  v_fx record;
  v_session uuid;
  v_order public.orders;
  v_item public.order_items;
begin
  select * into v_fx from tests.fx;
  select id into v_session from public.table_sessions where status = 'open'
    and table_id = (select id from public.restaurant_tables where number = 7);

  perform tests.login('gisele.garcom');

  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 2))),
    '00000000-0000-0000-0000-0000000000b3'::uuid);
  perform tests.eq_int(v_order.total_cents, 1400, 'garçom lança pedido na mesa (2 refrigerantes = 1400)');
  perform tests.eq_text(v_order.status, 'received', 'pedido nasce "recebido"');
  perform tests.eq_int((select count(*) from public.order_status_history where order_id = v_order.id), 1,
    'abertura do pedido fica no histórico');

  -- o garçom NÃO confirma nem cancela (isso é do caixa/admin)
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'confirmed')$sql$, v_order.id),
    'FORBIDDEN', 'garçom não confirma pedido (tarefa do caixa)');
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'cancelled', 'desisti')$sql$, v_order.id),
    'FORBIDDEN', 'garçom não cancela pedido');

  perform tests.logout();

  -- caixa conduz a produção
  perform tests.login('carlos.caixa');

  -- salto de etapa é bloqueado
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'ready')$sql$, v_order.id),
    'INVALID_TRANSITION', 'não é possível pular etapas da produção');

  -- cancelamento sem motivo é bloqueado
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'cancelled')$sql$, v_order.id),
    'REASON_REQUIRED', 'cancelar pedido exige motivo');

  perform public.advance_order_status(v_order.id, 'confirmed');
  perform public.advance_order_status(v_order.id, 'preparing');
  perform public.advance_order_status(v_order.id, 'ready');
  perform tests.eq_text((select status from public.orders where id = v_order.id), 'ready',
    'caixa conduz recebido → confirmado → preparo → pronto');

  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'delivered')$sql$, v_order.id),
    'INVALID_TRANSITION', 'pedido de salão não pode ser marcado como "entregue" (isso é do delivery)');

  perform tests.logout();

  -- garçom entrega na mesa
  perform tests.login('gisele.garcom');
  perform public.advance_order_status(v_order.id, 'delivered_to_table');
  perform tests.eq_text((select status from public.orders where id = v_order.id), 'delivered_to_table',
    'garçom registra a entrega na mesa');
  perform tests.logout();

  -- Pedido já ENTREGUE na mesa não pode mais ser cancelado: a comida foi servida.
  perform tests.login('carlos.caixa');
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'cancelled', 'cliente foi embora')$sql$, v_order.id),
    'INVALID_TRANSITION', 'pedido entregue na mesa não é cancelado (proteção contra perda de histórico)');

  -- ...mas um pedido novo, ainda não entregue, é cancelado com justificativa
  declare
    v_fx record;
    v_session uuid;
    v_outro public.orders;
  begin
    select * into v_fx from tests.fx;
    select id into v_session from public.table_sessions where status = 'open'
      and table_id = (select id from public.restaurant_tables where number = 7);

    v_outro := public.create_order(
      jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
        'items', jsonb_build_array(jsonb_build_object(
          'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))),
      '00000000-0000-0000-0000-0000000000b9'::uuid);

    perform public.advance_order_status(v_outro.id, 'cancelled', 'Cliente desistiu do item');
    perform tests.eq_text((select status from public.orders where id = v_outro.id), 'cancelled',
      'caixa cancela pedido com justificativa');
    perform tests.eq_int(
      (select count(*) from public.order_status_history where order_id = v_outro.id), 2,
      'histórico registra a criação e o cancelamento');
    perform tests.eq_int((select total_cents from public.orders where id = v_outro.id), 700,
      'pedido cancelado preserva o valor histórico para a auditoria');
    perform tests.eq_int(
      (select total_cents from public.table_overview where number = 7),
      (select coalesce(sum(total_cents), 0) from public.orders
        where table_session_id = v_session and status <> 'cancelled'),
      'a conta da mesa ignora pedidos cancelados');
  end;

  perform tests.eq_int(
    (select count(*) from public.order_status_history where order_id = v_order.id), 5,
    'todas as mudanças de situação ficam registradas no histórico');
  perform tests.logout();
end
$$;

-- --------------------------------------------- 3) cancelamento de pedido/itens
do $$
declare
  v_fx record;
  v_session uuid;
  v_order public.orders;
  v_item public.order_items;
  v_item2 public.order_items;
begin
  select * into v_fx from tests.fx;
  select id into v_session from public.table_sessions where status = 'open'
    and table_id = (select id from public.restaurant_tables where number = 7);

  perform tests.login('carlos.caixa');

  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(
        jsonb_build_object('product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 3),
        jsonb_build_object('product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
                           'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-0000000000b4'::uuid);

  perform tests.eq_int(v_order.subtotal_cents, 2100 + 5300,
    'dois itens: 3 refrigerantes (2100) + pizza G com extra queijo (5300)');

  select * into v_item from public.order_items where order_id = v_order.id and product_id = v_fx.drink;
  select * into v_item2 from public.order_items where order_id = v_order.id and product_id = v_fx.pizza_a;
  perform tests.eq_int(v_item.line_number, 1::bigint, 'itens numerados em sequência');
  perform tests.eq_int(v_item2.line_number, 2::bigint, 'segundo item na sequência');

  -- cancelamento sem motivo é recusado
  perform tests.expect_error(
    format($sql$select public.cancel_order_item(%L::uuid, '  ')$sql$, v_item.id),
    'REASON_REQUIRED', 'cancelar item exige motivo');

  -- cancelar mais unidades do que existe é recusado
  perform tests.expect_error(
    format($sql$select public.cancel_order_item(%L::uuid, 'teste', 9)$sql$, v_item.id),
    'INVALID_QUANTITY', 'não se cancela mais unidades do que o item tem');

  -- cancelamento PARCIAL: 1 de 3 refrigerantes
  perform public.cancel_order_item(v_item.id, 'Cliente desistiu de uma unidade', 1);
  perform tests.eq_int((select quantity from public.order_items where id = v_item.id), 2::bigint,
    'cancelamento parcial reduz a quantidade');
  perform tests.eq_int((select total_cents from public.order_items where id = v_item.id), 1400,
    'cancelamento parcial recalcula o total da linha');
  perform tests.eq_int((select subtotal_cents from public.orders where id = v_order.id), 6700,
    'subtotal do pedido recalculado após o cancelamento parcial');

  -- cancelamento TOTAL do item
  perform public.cancel_order_item(v_item2.id, 'Pizza saiu errada');
  perform tests.eq_bool((select is_cancelled from public.order_items where id = v_item2.id), true,
    'item cancelado por completo fica marcado (não é apagado)');
  perform tests.eq_int((select subtotal_cents from public.orders where id = v_order.id), 1400,
    'subtotal considera apenas itens válidos');

  perform tests.expect_error(
    format($sql$select public.cancel_order_item(%L::uuid, 'de novo')$sql$, v_item2.id),
    'ITEM_ALREADY_CANCELLED', 'não se cancela duas vezes o mesmo item');

  perform tests.logout();

  -- auditoria: cancelamento de item registrado com motivo
  perform tests.login('ana.admin');
  perform tests.ok(
    (select count(*) from public.audit_logs
      where action = 'order_item.cancel' and reason = 'Pizza saiu errada') = 1,
    'cancelamento de item fica na auditoria com o motivo');
  perform tests.logout();
end
$$;

-- ---------------------------------- 4) consultas: painel, histórico e permissões
do $$
declare
  v_pagina record;
begin
  perform tests.login('carlos.caixa');

  select * into v_pagina from public.get_orders_page(
    now() - interval '1 day', now() + interval '1 day', null, null, null, null, 50, 0);
  perform tests.ok(v_pagina.total_count >= 4, 'lista de pedidos do período traz os pedidos lançados');

  select * into v_pagina from public.get_orders_page(
    now() - interval '1 day', now() + interval '1 day', null, 'dine_in', 7, null, 50, 0);
  perform tests.ok(v_pagina.total_count >= 3, 'filtro por mesa funciona');

  perform tests.logout();

  -- garçom só vê pedidos de salão
  perform tests.login('gisele.garcom');
  perform tests.eq_int((select count(*) from public.orders where service_mode = 'delivery'), 0,
    'garçom não vê pedidos de delivery no painel');
  perform tests.ok((select count(*) from public.orders where service_mode = 'dine_in') > 0,
    'garçom vê os pedidos de salão das mesas');

  -- o mapa de mesas do garçom mostra os valores da conta (soma dos pedidos válidos)
  perform tests.eq_int(
    (select total_cents from public.table_overview where number = 7),
    (select coalesce(sum(o.total_cents), 0) from public.orders o
      join public.table_sessions s on s.id = o.table_session_id
      where s.table_id = (select id from public.restaurant_tables where number = 7)
        and s.status = 'open' and o.status <> 'cancelled'),
    'mapa de mesas mostra o valor pendente da mesa 7');
  perform tests.logout();
end
$$;
