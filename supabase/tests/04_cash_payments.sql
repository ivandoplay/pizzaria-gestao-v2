-- =============================================================================
-- 04_cash_payments.sql — caixa, recebimentos, descontos e fechamento de conta
-- =============================================================================
-- Critérios (seção 17): "fechamento e pagamentos corretos"; "nada duplica";
-- "valores não reajustam pedidos antigos"; "o caixa fecha com contagem".
-- =============================================================================

-- ------------------------------ 1) recebimento exige caixa aberto + abertura
do $$
declare
  v_fx record;
  v_mesa8 uuid;
  v_session uuid;
  v_order public.orders;
  v_cash public.cash_sessions;
  v_cash2 public.cash_sessions;
begin
  select * into v_fx from tests.fx;
  select id into v_mesa8 from public.restaurant_tables where number = 8;

  perform tests.login('carlos.caixa');

  v_session := (select id from public.open_table_session(v_mesa8, 2::smallint, 'Teste 04',
                                                        '00000000-0000-0000-0000-0000000000c0'::uuid));

  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-0000000000c1'::uuid);
  perform tests.eq_int(v_order.total_cents, 5300, 'pedido de teste: pizza G 5000 + extra queijo 300');

  -- sem caixa aberto não se registra recebimento
  perform tests.expect_error(
    format($sql$select public.register_payment(%L::uuid, 'pix', 1000)$sql$, v_order.id),
    'CASH_SESSION_REQUIRED', 'não há recebimento sem caixa aberto');

  -- abre o caixa com fundo de troco
  v_cash := public.start_cash_session(10000, 'Turno de teste', '00000000-0000-0000-0000-0000000000c2'::uuid);
  perform tests.eq_text(v_cash.status, 'open', 'caixa aberto');
  perform tests.eq_int(v_cash.opening_amount_cents, 10000, 'fundo de troco registrado');

  -- não existe mais de um caixa aberto
  perform tests.expect_error(
    $sql$select public.start_cash_session(5000, 'Segundo turno')$sql$,
    'CASH_SESSION_ALREADY_OPEN', 'não se abre um segundo caixa com o primeiro aberto');

  -- requisição repetida devolve o MESMO caixa
  v_cash2 := public.start_cash_session(10000, 'Turno de teste', '00000000-0000-0000-0000-0000000000c2'::uuid);
  perform tests.eq_text(v_cash2.id::text, v_cash.id::text, 'clique repetido não abre dois caixas');

  perform tests.logout();
end
$$;

-- ------------------------------------- 2) pagamentos parciais, troco e gaveta
do $$
declare
  v_order public.orders;
  v_pix public.payments;
  v_cash_pay public.payments;
  v_repeat public.payments;
  v_fx record;
begin
  select * into v_fx from tests.fx;
  select * into v_order from public.orders where client_uuid = '00000000-0000-0000-0000-0000000000c1';

  perform tests.login('carlos.caixa');

  -- 1º recebimento: Pix parcial de 3000
  v_pix := public.register_payment(v_order.id, 'pix', 3000, null, false, null,
                                   '00000000-0000-0000-0000-0000000000c3'::uuid);
  perform tests.eq_int(v_pix.amount_cents, 3000, 'recebimento parcial em Pix');
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 3000,
    'valor pago somado ao pedido');
  perform tests.eq_int((select balance_cents from public.order_overview where id = v_order.id), 2300,
    'saldo pendente calculado');

  -- clique repetido não cobra duas vezes
  v_repeat := public.register_payment(v_order.id, 'pix', 3000, null, false, null,
                                      '00000000-0000-0000-0000-0000000000c3'::uuid);
  perform tests.eq_text(v_repeat.id::text, v_pix.id::text, 'clique repetido devolve o mesmo recebimento');
  perform tests.eq_int((select count(*) from public.payments where order_id = v_order.id), 1,
    'existe um único recebimento registrado');

  -- Pix não entra na gaveta
  perform tests.eq_int(
    (select coalesce(sum(amount_cents), 0) from public.cash_movements m
      join public.payment_methods pm on pm.id = 'pix'),
    0, 'recebimento em Pix não movimenta a gaveta');

  -- não se recebe mais do que o saldo
  perform tests.expect_error(
    format($sql$select public.register_payment(%L::uuid, 'pix', 9000)$sql$, v_order.id),
    'AMOUNT_EXCEEDS_BALANCE', 'não é possível receber acima do saldo');

  -- valor inválido
  perform tests.expect_error(
    format($sql$select public.register_payment(%L::uuid, 'pix', 0)$sql$, v_order.id),
    'INVALID_AMOUNT', 'valor zero é recusado');

  -- 2º recebimento: dinheiro com troco (2300 pagos com 5000)
  v_cash_pay := public.register_payment(v_order.id, 'cash', 2300, 5000, false, null,
                                        '00000000-0000-0000-0000-0000000000c4'::uuid);
  perform tests.eq_int(v_cash_pay.change_cents, 2700, 'troco calculado pelo servidor');
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 5300,
    'pedido quitado com dois recebimentos');
  perform tests.eq_int((select balance_cents from public.order_overview where id = v_order.id), 0,
    'saldo zerado');

  -- a gaveta recebe o valor LÍQUIDO (troco não é receita)
  perform tests.eq_int(
    (select amount_cents from public.cash_movements
      where payment_id = v_cash_pay.id and source = 'automatic'),
    2300, 'a gaveta recebe o valor líquido, não o valor entregue pelo cliente');

  perform tests.eq_int(
    (select expected_cash_cents from public.cash_session_overview where status = 'open'),
    12300, 'saldo esperado na gaveta = fundo (10000) + dinheiro recebido (2300)');

  perform tests.logout();
end
$$;

-- ------------------------------------------------- 3) estorno com justificativa
do $$
declare
  v_order public.orders;
  v_pix public.payments;
begin
  select * into v_order from public.orders where client_uuid = '00000000-0000-0000-0000-0000000000c1';
  select * into v_pix from public.payments
   where order_id = v_order.id and method_id = 'pix' limit 1;

  perform tests.login('carlos.caixa');

  perform tests.expect_error(
    format($sql$select public.reverse_payment(%L::uuid, '')$sql$, v_pix.id),
    'REASON_REQUIRED', 'estorno exige motivo');

  perform public.reverse_payment(v_pix.id, 'Pix caiu em duplicidade');
  perform tests.eq_text((select status from public.payments where id = v_pix.id), 'reversed',
    'recebimento estornado (registro preservado)');
  perform tests.eq_int((select paid_cents from public.orders where id = v_order.id), 2300,
    'estorno devolve o saldo pendente do pedido');

  perform tests.expect_error(
    format($sql$select public.reverse_payment(%L::uuid, 'de novo')$sql$, v_pix.id),
    'PAYMENT_ALREADY_REVERSED', 'não se estorna duas vezes o mesmo recebimento');

  perform tests.logout();
end
$$;

-- ----------------------------------------------- 4) descontos com limite e conta
do $$
declare
  v_fx record;
  v_order public.orders;
  v_admin uuid;
begin
  select * into v_fx from tests.fx;
  select * into v_order from public.orders where client_uuid = '00000000-0000-0000-0000-0000000000c1';
  select id into v_admin from public.profiles where login = 'ana.admin';

  perform tests.login('carlos.caixa');

  -- fechar conta com saldo pendente é bloqueado
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid)$sql$, v_order.table_session_id),
    'BALANCE_PENDING', 'não se fecha conta com saldo pendente');

  -- desconto exige motivo
  perform tests.expect_error(
    format($sql$select public.set_order_discount(%L::uuid, '')$sql$, v_order.id),
    'REASON_REQUIRED', 'desconto exige motivo');

  -- 10% é o limite do caixa (max_discount_pct_without_auth)
  perform public.set_order_discount(v_order.id, 'Cliente frequente', 10);
  perform tests.eq_int((select discount_cents from public.orders where id = v_order.id), 530,
    'desconto de 10% sobre 5300 = 530');
  perform tests.eq_int((select total_cents from public.orders where id = v_order.id), 4770,
    'total da conta com desconto');
  perform tests.eq_int((select balance_cents from public.order_overview where id = v_order.id), 2470,
    'saldo pendente com desconto aplicado');

  -- acima do limite do caixa
  perform tests.expect_error(
    format($sql$select public.set_order_discount(%L::uuid, 'cortesia', 15)$sql$, v_order.id),
    'DISCOUNT_LIMIT_EXCEEDED', 'caixa não passa do limite de desconto');

  perform tests.logout();

  -- administrador pode autorizar mais (até o teto duro)
  perform tests.login('ana.admin');
  perform public.set_order_discount(v_order.id, 'Autorizado pela gerência', 18);
  perform tests.eq_int((select discount_cents from public.orders where id = v_order.id), 954,
    'administrador aplica 18% (954 sobre 5300)');
  perform tests.eq_text((select discount_authorized_by::text from public.orders where id = v_order.id), v_admin::text,
    'desconto registra quem autorizou');

  perform tests.expect_error(
    format($sql$select public.set_order_discount(%L::uuid, 'muito alto', 25)$sql$, v_order.id),
    'DISCOUNT_LIMIT_EXCEEDED', 'desconto acima do teto absoluto é recusado');

  -- valor em centavos também é aceito e limitado
  perform public.set_order_discount(v_order.id, 'Acordo', null, 300);
  perform tests.eq_int((select discount_cents from public.orders where id = v_order.id), 300,
    'desconto pode ser informado em valor');
  perform tests.logout();

  -- desconto registrado na auditoria
  perform tests.login('ana.admin');
  perform tests.ok(
    (select count(*) from public.audit_logs where action = 'order.discount' and entity_id = v_order.id::text) >= 3,
    'cada desconto fica na auditoria com motivo e autor');
  perform tests.logout();
end
$$;

-- ------------------------------- 5) fechar a conta, liberar a mesa e travar valores
do $$
declare
  v_order public.orders;
  v_session uuid;
  v_result jsonb;
  v_fx record;
begin
  select * into v_fx from tests.fx;
  select * into v_order from public.orders where client_uuid = '00000000-0000-0000-0000-0000000000c1';
  v_session := v_order.table_session_id;

  perform tests.login('carlos.caixa');

  -- paga o saldo restante (5000 - 300 de desconto = 5000... usa o saldo real)
  declare
    v_saldo integer;
  begin
    select balance_cents into v_saldo from public.order_overview where id = v_order.id;
    perform public.register_payment(v_order.id, 'debit_card', v_saldo, null, false, null,
                                    '00000000-0000-0000-0000-0000000000c5'::uuid);
  end;

  perform tests.eq_int((select balance_cents from public.order_overview where id = v_order.id), 0,
    'conta quitada com débito');

  v_result := public.close_table_account(v_session);
  perform tests.eq_bool((v_result ->> 'closed_with_balance')::boolean, false,
    'conta fechada sem saldo pendente');
  perform tests.eq_int((v_result ->> 'total_cents')::bigint, 5000,
    'total fechado da conta (5300 - 300 de desconto)');

  perform tests.ok((select account_closed_at is not null from public.orders where id = v_order.id),
    'pedido marcado com a data de fechamento');
  perform tests.eq_text((select status from public.table_overview where number = 8), 'available',
    'mesa liberada depois do fechamento');

  -- depois de fechada, a conta não aceita mais nada
  perform tests.expect_error(
    format($sql$select public.register_payment(%L::uuid, 'pix', 100)$sql$, v_order.id),
    'ORDER_ACCOUNT_CLOSED', 'conta fechada não recebe novo pagamento');

  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid)$sql$, v_session),
    'SESSION_NOT_OPEN', 'não se fecha a mesma conta duas vezes');

  perform tests.logout();

  -- ajuste de item depois do fechamento exige procedimento administrativo
  perform tests.login('ana.admin');
  perform tests.expect_error(
    format($sql$select public.cancel_order_item(%L::uuid, 'ajuste tardio')$sql$,
           (select id from public.order_items where order_id = v_order.id limit 1)),
    'ORDER_ACCOUNT_CLOSED', 'item de conta fechada só muda com procedimento administrativo');

  -- a mesa 7 continua aberta com saldo: o mapa mostra isso
  perform tests.eq_text((select status from public.table_overview where number = 7), 'occupied',
    'mesa com saldo pendente continua ocupada');
  perform tests.logout();
end
$$;

-- -------------------------------------- 6) movimentações manuais do caixa
do $$
declare
  v_cash uuid;
  v_mov public.cash_movements;
  v_mov2 public.cash_movements;
  v_expected integer;
begin
  select id into v_cash from public.cash_sessions where status = 'open';

  perform tests.login('carlos.caixa');

  select expected_cash_cents into v_expected from public.cash_session_overview where id = v_cash;

  -- sangria (retirada) com motivo
  v_mov := public.add_cash_movement(v_cash, 'out', 'withdrawal', 5000, 'Depósito bancário',
                                    'Retirada para depósito', '00000000-0000-0000-0000-0000000000c6'::uuid);
  perform tests.eq_int(v_mov.amount_cents, 5000, 'sangria registrada');

  -- repetição não duplica
  v_mov2 := public.add_cash_movement(v_cash, 'out', 'withdrawal', 5000, 'Depósito bancário',
                                     'Retirada para depósito', '00000000-0000-0000-0000-0000000000c6'::uuid);
  perform tests.eq_text(v_mov2.id::text, v_mov.id::text, 'clique repetido não duplica a movimentação');
  perform tests.eq_int((select count(*) from public.cash_movements where client_uuid = '00000000-0000-0000-0000-0000000000c6'), 1,
    'existe uma única sangria registrada');

  perform tests.eq_int(
    (select expected_cash_cents from public.cash_session_overview where id = v_cash),
    v_expected - 5000, 'sangria reduz o saldo esperado da gaveta');

  -- saída maior do que a gaveta
  perform tests.expect_error(
    format($sql$select public.add_cash_movement(%L::uuid, 'out', 'expense', 999999, 'Compra', 'Teste')$sql$, v_cash),
    'INSUFFICIENT_CASH', 'não se retira mais dinheiro do que existe na gaveta');

  -- categoria com tipo errado
  perform tests.expect_error(
    format($sql$select public.add_cash_movement(%L::uuid, 'out', 'change_fund', 1000)$sql$, v_cash),
    'INVALID_CATEGORY_KIND', 'reforço de troco só pode ser entrada');

  -- valor inválido
  perform tests.expect_error(
    format($sql$select public.add_cash_movement(%L::uuid, 'in', 'change_fund', 0)$sql$, v_cash),
    'INVALID_AMOUNT', 'movimentação com valor zero é recusada');

  perform tests.logout();
end
$$;

-- --------------------------------------------------- 7) fechamento do caixa
do $$
declare
  v_cash uuid;
  v_expected integer;
  v_closed public.cash_sessions;
begin
  select id, expected_cash_cents into v_cash, v_expected
    from public.cash_session_overview where status = 'open';

  perform tests.login('carlos.caixa');

  -- divergência sem justificativa é recusada
  perform tests.expect_error(
    format($sql$select public.close_cash_session(%L::uuid, %s, 'Fechamento do turno')$sql$, v_cash, v_expected - 1000),
    'VARIANCE_REASON_REQUIRED', 'divergência de caixa exige justificativa');

  -- fechamento com divergência justificada
  v_closed := public.close_cash_session(v_cash, v_expected - 1000, 'Fechamento do turno',
                                        'Faltou R$ 10,00 — troco entregue a mais');
  perform tests.eq_text(v_closed.status, 'closed', 'caixa fechado');
  perform tests.eq_int(v_closed.expected_cash_cents, v_expected, 'valor esperado registrado no fechamento');
  perform tests.eq_int(v_closed.difference_cents, -1000, 'divergência registrada no fechamento');
  perform tests.eq_text(v_closed.variance_reason, 'Faltou R$ 10,00 — troco entregue a mais',
    'justificativa da divergência guardada');

  -- depois de fechado, um NOVO turno pode ser aberto (o fechamento não trava a loja)
  declare
    v_novo public.cash_sessions;
  begin
    v_novo := public.start_cash_session(5000, 'Turno seguinte', '00000000-0000-0000-0000-0000000000c7'::uuid);
    perform tests.eq_text(v_novo.status, 'open', 'novo turno de caixa é aberto após o fechamento');
    perform tests.ok(v_novo.id <> v_cash, 'o novo turno é uma sessão diferente da anterior');
    perform tests.eq_int((select expected_cash_cents from public.cash_session_overview where id = v_novo.id), 5000,
      'novo turno começa com o fundo informado');
  end;

  perform tests.expect_error(
    format($sql$select public.add_cash_movement(%L::uuid, 'in', 'change_fund', 1000)$sql$, v_cash),
    'CASH_SESSION_CLOSED', 'caixa fechado não aceita movimentação');

  perform tests.expect_error(
    format($sql$select public.close_cash_session(%L::uuid, 1000)$sql$, v_cash),
    'CASH_SESSION_CLOSED', 'não se fecha o mesmo caixa duas vezes');

  perform tests.logout();

  -- auditoria do fechamento
  perform tests.login('ana.admin');
  perform tests.ok(
    (select count(*) from public.audit_logs
      where action = 'cash_session.close' and reason = 'Faltou R$ 10,00 — troco entregue a mais') = 1,
    'fechamento de caixa fica na auditoria com a justificativa');
  perform tests.logout();
end
$$;
