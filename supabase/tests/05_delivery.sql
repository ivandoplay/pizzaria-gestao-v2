-- =============================================================================
-- 05_delivery.sql — clientes, endereços, taxa por bairro e fluxo do delivery
-- =============================================================================
-- Critérios (seção 17): "delivery acompanhável do recebimento à entrega";
-- "taxa por bairro configurável"; "lançamento manual (sem integração externa)".
-- =============================================================================

-- --------------------------------- 1) pedido de delivery com cliente e endereço
do $$
declare
  v_fx record;
  v_order public.orders;
  v_customer public.customers;
  v_endereco jsonb;
begin
  select * into v_fx from tests.fx;

  perform tests.login('carlos.caixa');

  v_order := public.create_order(
    jsonb_build_object(
      'service_mode', 'delivery',
      'customer', jsonb_build_object('name', 'João Zona', 'phone', '(86) 98888-7777'),
      'address', jsonb_build_object(
        'street', 'Rua das Flores', 'number', '120', 'neighborhood', 'Centro Teste',
        'reference', 'Ao lado da praça'),
      'delivery_notes', 'Entregar no portão azul',
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 2))
    ),
    '00000000-0000-0000-0000-0000000000d1'::uuid);

  perform tests.eq_int(v_order.total_cents, 2200, 'total do pedido de delivery (2 x 700 + taxa 800)');
  perform tests.eq_int(v_order.delivery_fee_cents, 800, 'taxa aplicada pela zona do bairro (Centro Teste)');
  perform tests.eq_text(v_order.delivery_neighborhood, 'Centro Teste', 'bairro registrado no pedido');
  perform tests.eq_text(v_order.customer_name_snapshot, 'João Zona', 'nome do cliente guardado no pedido');

  select * into v_customer from public.customers where phone_digits = '86988887777';
  perform tests.ok(v_customer.id is not null, 'cliente criado a partir do telefone');
  perform tests.eq_text(v_customer.phone, '(86) 98888-7777', 'telefone guardado como o cliente informou');
  perform tests.eq_text(v_customer.phone_digits, '86988887777',
    'telefone normalizado em dígitos (chave de busca por cliente)');

  select delivery_address_snapshot into v_endereco from public.orders where id = v_order.id;
  perform tests.eq_text(v_endereco ->> 'street', 'Rua das Flores', 'endereço gravado como snapshot do pedido');
  perform tests.eq_text(v_endereco ->> 'number', '120', 'número do endereço no snapshot');

  perform tests.logout();
end
$$;

-- ---------------------------- 2) cliente recorrente não é duplicado; taxa padrão
do $$
declare
  v_fx record;
  v_order public.orders;
  v_customer_before integer;
begin
  select * into v_fx from tests.fx;
  select count(*) into v_customer_before from public.customers;

  perform tests.login('carlos.caixa');

  -- mesmo telefone, com máscara diferente → reaproveita o cliente
  v_order := public.create_order(
    jsonb_build_object(
      'service_mode', 'delivery',
      'customer', jsonb_build_object('name', 'João Zona', 'phone', '86 98888.7777'),
      'address', jsonb_build_object('street', 'Rua das Flores', 'number', '120', 'neighborhood', 'Centro Teste'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))
    ),
    '00000000-0000-0000-0000-0000000000d2'::uuid);

  perform tests.eq_int((select count(*) from public.customers)::bigint, v_customer_before::bigint,
    'cliente recorrente não é duplicado');
  perform tests.eq_int(v_order.delivery_fee_cents, 800, 'taxa do bairro mantida');
  perform tests.eq_int(v_order.total_cents, 6100, 'total = pizza 5300 + taxa 800');

  perform tests.logout();

  -- taxa padrão para bairros sem zona cadastrada
  perform tests.login('ana.admin');
  update public.business_settings set default_delivery_fee_cents = 500;
  perform tests.logout();

  perform tests.login('carlos.caixa');
  v_order := public.create_order(
    jsonb_build_object(
      'service_mode', 'delivery',
      'customer', jsonb_build_object('name', 'Maria Sem Zona', 'phone', '86977776666'),
      'address', jsonb_build_object('street', 'Av. Central', 'number', '50', 'neighborhood', 'Bairro Novo'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))
    ),
    '00000000-0000-0000-0000-0000000000d3'::uuid);

  perform tests.eq_int(v_order.delivery_fee_cents, 500, 'bairro sem zona usa a taxa padrão');
  perform tests.eq_int(v_order.total_cents, 1200, 'total com taxa padrão = 700 + 500');

  -- validações de entrada
  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','delivery',
      'customer', jsonb_build_object('name','Sem Endereço','phone','86900001111'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id',%L,'variant_id',%L,'quantity',1))))$sql$, v_fx.drink, v_fx.variant_drink_un),
    'ADDRESS_REQUIRED', 'delivery exige endereço de entrega');

  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','delivery',
      'customer', jsonb_build_object('name','Sem Telefone','phone','123'),
      'address', jsonb_build_object('street','Rua X','number','1','neighborhood','Bairro Novo'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id',%L,'variant_id',%L,'quantity',1))))$sql$, v_fx.drink, v_fx.variant_drink_un),
    'CUSTOMER_PHONE_INVALID', 'telefone sem DDD é recusado');

  perform tests.logout();

  perform tests.login('ana.admin');
  update public.business_settings set default_delivery_fee_cents = 0;
  perform tests.logout();
end
$$;

-- --------------------------------------------- 3) acompanhamento do delivery
do $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where client_uuid = '00000000-0000-0000-0000-0000000000d1';

  perform tests.login('carlos.caixa');

  perform public.advance_order_status(v_order.id, 'confirmed');
  perform public.advance_order_status(v_order.id, 'preparing');
  perform public.advance_order_status(v_order.id, 'ready');

  -- pedido de delivery não pode ser entregue "na mesa"
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'delivered_to_table')$sql$, v_order.id),
    'INVALID_TRANSITION', 'pedido de delivery não é entregue à mesa');

  perform public.advance_order_status(v_order.id, 'out_for_delivery', 'Saiu com o entregador João');
  perform tests.eq_text((select status from public.orders where id = v_order.id), 'out_for_delivery',
    'pedido registrado como "saiu para entrega"');

  perform public.advance_order_status(v_order.id, 'delivered', 'Entregue no portão azul');
  perform tests.eq_text((select status from public.orders where id = v_order.id), 'delivered',
    'pedido marcado como entregue');

  perform tests.eq_int((select count(*) from public.order_status_history where order_id = v_order.id), 6,
    'todo o trajeto do delivery fica no histórico');

  perform tests.logout();
end
$$;

-- ------------------------------------------ 4) pagamento, estorno e fechamento
do $$
declare
  v_order public.orders;
  v_pago public.payments;
  v_resultado jsonb;
begin
  select * into v_order from public.orders where client_uuid = '00000000-0000-0000-0000-0000000000d2';

  -- Pedido do delivery pago ANTES (antecipado) para testar o estorno
  perform tests.login('carlos.caixa');

  v_pago := public.register_payment(v_order.id, 'pix', 3000, null, true, 'Pix antecipado',
                                    '00000000-0000-0000-0000-0000000000d4'::uuid);
  perform tests.eq_bool((select is_prepaid from public.payments where id = v_pago.id), true,
    'pagamento antecipado registrado como tal');
  perform tests.eq_int((select balance_cents from public.order_overview where id = v_order.id), 3100,
    'saldo pendente após o sinal');

  -- cancelar pedido já pago exige estorno antes
  perform tests.expect_error(
    format($sql$select public.advance_order_status(%L::uuid, 'cancelled', 'cliente desistiu')$sql$, v_order.id),
    'PAYMENT_REFUND_REQUIRED', 'cancelamento com valor recebido exige estorno antes');

  perform public.reverse_payment(v_pago.id, 'Cliente desistiu do pedido');
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 0,
    'estorno libera o cancelamento');

  perform public.advance_order_status(v_order.id, 'cancelled', 'Cliente desistiu — estornado');
  perform tests.eq_text((select status from public.orders where id = v_order.id), 'cancelled',
    'pedido de delivery cancelado com justificativa');

  -- pedido cancelado não é fechado nem recebe pagamento
  perform tests.expect_error(
    format($sql$select public.close_delivery_account(%L::uuid)$sql$, v_order.id),
    'ORDER_CANCELLED', 'pedido cancelado não é "fechado"');
  perform tests.expect_error(
    format($sql$select public.register_payment(%L::uuid, 'pix', 100)$sql$, v_order.id),
    'ORDER_CANCELLED', 'pedido cancelado não aceita novo recebimento');

  perform tests.logout();

  -- fechamento normal de um pedido de delivery quitado
  select * into v_order from public.orders where client_uuid = '00000000-0000-0000-0000-0000000000d3';
  perform tests.login('carlos.caixa');

  perform tests.expect_error(
    format($sql$select public.close_delivery_account(%L::uuid)$sql$, v_order.id),
    'BALANCE_PENDING', 'pedido de delivery com saldo não fecha sem autorização');

  perform public.register_payment(v_order.id, 'cash', 1200, 2000, false, null,
                                  '00000000-0000-0000-0000-0000000000d5'::uuid);
  perform tests.eq_int((select change_cents from public.payments
                         where client_uuid = '00000000-0000-0000-0000-0000000000d5'), 800,
    'troco do delivery calculado pelo servidor');

  v_resultado := public.close_delivery_account(v_order.id);
  perform tests.eq_bool((v_resultado ->> 'closed_with_balance')::boolean, false,
    'pedido de delivery fechado sem saldo');
  perform tests.ok((select account_closed_at is not null from public.orders where id = v_order.id),
    'data de fechamento gravada no pedido de delivery');
  perform tests.logout();
end
$$;

-- ------------------------------- 5) fechamento forçado e taxa ajustada (admin)
do $$
declare
  v_fx record;
  v_order public.orders;
  v_resultado jsonb;
begin
  select * into v_fx from tests.fx;

  perform tests.login('carlos.caixa');
  v_order := public.create_order(
    jsonb_build_object(
      'service_mode', 'delivery',
      'customer', jsonb_build_object('name', 'Pedro Fiado', 'phone', '86966665555'),
      'address', jsonb_build_object('street', 'Rua do Mercado', 'number', '77', 'neighborhood', 'Centro Teste'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 1))
    ),
    '00000000-0000-0000-0000-0000000000d6'::uuid);

  -- caixa não força fechamento
  perform tests.expect_error(
    format($sql$select public.close_delivery_account(%L::uuid, true, 'cliente vai pagar depois')$sql$, v_order.id),
    'FORBIDDEN', 'somente o administrador força o fechamento com saldo');
  perform tests.logout();

  perform tests.login('ana.admin');

  -- taxa editável apenas pelo administrador, com motivo
  perform tests.expect_error(
    format($sql$select public.set_delivery_fee(%L::uuid, 1000, '')$sql$, v_order.id),
    'REASON_REQUIRED', 'ajuste da taxa exige motivo');

  perform public.set_delivery_fee(v_order.id, 1000, 'Cliente distante — taxa combinada por telefone');
  perform tests.eq_int((select delivery_fee_cents from public.orders where id = v_order.id), 1000,
    'administrador ajusta a taxa do pedido');
  perform tests.eq_int((select total_cents from public.orders where id = v_order.id), 1700,
    'total recalculado com a taxa ajustada');

  -- fechamento forçado com saldo exige justificativa e fica registrado
  perform tests.expect_error(
    format($sql$select public.close_delivery_account(%L::uuid, true)$sql$, v_order.id),
    'REASON_REQUIRED', 'fechamento com saldo exige justificativa do administrador');

  v_resultado := public.close_delivery_account(v_order.id, true, 'Cliente pagará na próxima compra (autorizado)');
  perform tests.eq_int((v_resultado ->> 'balance_cents')::bigint, 1700,
    'saldo pendente registrado no fechamento forçado');
  perform tests.eq_bool((v_resultado ->> 'closed_with_balance')::boolean, true,
    'conta marcada como fechada com saldo');

  perform tests.ok(
    (select count(*) from public.audit_logs
      where action = 'delivery_account.close' and entity_id = v_order.id::text) = 1,
    'fechamento forçado fica na auditoria com o motivo');
  perform tests.logout();
end
$$;

-- ----------------------------------- 6) o caixa enxerga; o garçom não interfere
do $$
begin
  perform tests.login('carlos.caixa');
  perform tests.ok((select count(*) from public.orders where service_mode = 'delivery') = 4,
    'caixa enxerga todos os pedidos de delivery');
  perform tests.eq_int(
    (select count(*) from public.order_overview where service_mode = 'delivery' and balance_cents > 0
      and account_closed_at is null and status <> 'cancelled'),
    1, 'há um pedido de delivery em aberto (o que ficou com saldo, já fechado, não conta)');
  perform tests.logout();

  perform tests.login('gisele.garcom');
  perform tests.eq_int((select count(*) from public.orders where service_mode = 'delivery'), 0,
    'garçom não vê pedidos de delivery');
  perform tests.expect_error(
    $sql$select public.create_order(jsonb_build_object(
      'service_mode','delivery',
      'customer', jsonb_build_object('name','Tentativa','phone','86911112222'),
      'address', jsonb_build_object('street','Rua Y','number','2','neighborhood','Centro Teste'),
      'items', jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'variant_id', gen_random_uuid(), 'quantity', 1))))$sql$,
    'FORBIDDEN', 'garçom não lança delivery');
  perform tests.logout();
end
$$;
