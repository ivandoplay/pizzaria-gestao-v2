-- =============================================================================
-- 10_garcom_recebe_e_fecha.sql — o garçom recebe na mesa e fecha a conta
-- =============================================================================
-- Regra de 16/10/2026 (pedido do administrador, migração 0011): o garçom vê o
-- total de cada conta, registra o recebimento e fecha a conta quitada.
--
-- O que este arquivo prova:
--   1. o garçom RECEBE na mesa (com o caixa aberto pelo gerente);
--   2. o saldo da conta baixa de verdade (o valor não é só visual);
--   3. o garçom FECHA a conta quitada;
--   4. o garçom NÃO fecha com saldo pendente nem força o fechamento;
--   5. o garçom NÃO estorna recebimento nem dá desconto;
--   6. o recebimento entra no turno de caixa em curso (a gaveta fecha certa);
--   7. o caixa continua recebendo e fechando como antes (sem regressão).
-- =============================================================================

-- ------------------------------------------------ 1) garçom recebe e fecha
do $$
declare
  v_fx record;
  v_mesa uuid;
  v_session uuid;
  v_order public.orders;
  v_pagamento public.payments;
  v_saldo integer;
  v_fechamento jsonb;
begin
  select * into v_fx from tests.fx;
  select id into v_mesa from public.restaurant_tables where number = 4;

  -- O caixa do turno é aberto pelo gerente (o garçom não abre gaveta).
  -- Os arquivos anteriores da suíte já deixam um turno aberto; se por algum
  -- motivo não houver, este bloco abre — a intenção é testar o recebimento
  -- DENTRO do turno em curso, não abrir um segundo.
  perform tests.login('carlos.caixa');
  if not exists (select 1 from public.cash_sessions where status = 'open') then
    perform public.start_cash_session(20000, 'Turno do teste 10',
      '00000000-0000-0000-0000-000000000101'::uuid);
  end if;
  perform tests.ok((select count(*) from public.cash_sessions where status = 'open') = 1,
    '10.0b existe um único turno de caixa aberto para receber');

  -- Trocar de usuário exige sair antes: `tests.login` lê `auth.users`, e a RLS
  -- não deixa o perfil autenticado enxergar essa tabela (é o comportamento
  -- correto — o teste é que precisa respeitar a ordem).
  perform tests.logout();

  -- O garçom abre a mesa 4 e lança o pedido (atribuição do salão).
  perform tests.login('gisele.garcom');
  v_session := (select id from public.open_table_session(v_mesa, 3::smallint, 'Família do teste 10',
                                                        '00000000-0000-0000-0000-000000000102'::uuid));
  perform tests.ok(v_session is not null, '10.0 garçom abre o atendimento da mesa 4');

  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-000000000103'::uuid);
  perform tests.eq_int(v_order.total_cents, 5300, '10.1 pedido do garçom: pizza G 5000 + extra 300');

  -- O garçom vê o valor da conta dele (a leitura do salão continua aberta).
  perform tests.eq_int(
    (select total_cents from public.order_overview where id = v_order.id),
    5300, '10.2 garçom lê o total da conta que atende');

  -- 0012: com pedido em andamento, nem o garçom fecha a conta (o pedido é
  -- entregue ou cancelado antes — a mesa não é liberada com pedido na cozinha).
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid)$sql$, v_session),
    'ORDERS_IN_PROGRESS', '10.2b pedido em andamento impede o fechamento da conta');

  -- O pedido segue o fluxo real: produção conduzida pelo caixa, entrega pelo
  -- garçom. Só depois disso a conta pode ser fechada.
  perform tests.logout();
  perform tests.login('carlos.caixa');
  perform public.advance_order_status(v_order.id, 'confirmed');
  perform public.advance_order_status(v_order.id, 'preparing');
  perform public.advance_order_status(v_order.id, 'ready');
  perform tests.logout();
  perform tests.login('gisele.garcom');
  perform public.advance_order_status(v_order.id, 'delivered_to_table');

  -- 1) garçom RECEBE (dinheiro, com troco) no pedido dele
  v_pagamento := public.register_payment(v_order.id, 'cash', 3000, 5000, false, null,
    '00000000-0000-0000-0000-000000000104'::uuid);
  perform tests.eq_text(v_pagamento.status, 'confirmed', '10.3 garçom registra recebimento em dinheiro');
  perform tests.eq_int(v_pagamento.amount_cents, 3000, '10.4 recebeu 3000');
  perform tests.eq_int(v_pagamento.change_cents, 2000, '10.5 troco calculado sobre o valor entregue');

  -- O recebimento do garçom entra no TURNO DE CAIXA aberto (gaveta fecha certo)
  perform tests.ok(v_pagamento.cash_session_id is not null,
    '10.6 recebimento do garçom entra no turno de caixa em curso');

  -- 2) o saldo baixa de verdade
  select balance_cents into v_saldo from public.order_overview where id = v_order.id;
  perform tests.eq_int(v_saldo, 2300, '10.7 saldo do pedido baixou para 2300');

  -- 3) o garçom completa e FECHA a conta quitada
  perform public.register_payment(v_order.id, 'pix', 2300, null, false, null,
    '00000000-0000-0000-0000-000000000105'::uuid);
  v_fechamento := public.close_table_account(v_session);
  perform tests.eq_int((v_fechamento ->> 'total_cents')::bigint, 5300,
    '10.8 garçom fecha a conta quitada (total do fechamento)');
  perform tests.eq_int((v_fechamento ->> 'balance_cents')::bigint, 0,
    '10.8b fechou com saldo zerado');
  perform tests.eq_bool((v_fechamento ->> 'closed_with_balance')::boolean, false,
    '10.8c não foi fechamento forçado com saldo');

  perform tests.eq_int(
    (select count(*) from public.table_sessions where id = v_session and status = 'open'),
    0, '10.9 não sobrou atendimento aberto na mesa 4');

  -- O fechamento ficou registrado na auditoria, com autor e valor
  perform tests.logout();

  -- A auditoria é lida pelo administrador: o garçom não enxerga `audit_logs`
  -- (regra que já existia e continua valendo) — quem prova o registro é quem
  -- tem permissão para lê-lo.
  perform tests.login('ana.admin');
  perform tests.ok(
    (select count(*) from public.audit_logs
      where action = 'table_account.close' and entity_id = v_session::text
        and actor_role = 'waiter') = 1,
    '10.10 fechamento do garçom fica na auditoria com o perfil de garçom, uma vez só');
  perform tests.ok(
    (select count(*) from public.audit_logs
      where action = 'payment.register' and actor_role = 'waiter') >= 2,
    '10.10b os recebimentos do garçom ficam na auditoria com autor');

  perform tests.logout();
end
$$;

-- ------------------------------------------------ 2) limites do garçom
do $$
declare
  v_fx record;
  v_mesa uuid;
  v_session uuid;
  v_order public.orders;
  v_pagamento public.payments;
begin
  select * into v_fx from tests.fx;
  select id into v_mesa from public.restaurant_tables where number = 3;

  perform tests.login('gisele.garcom');
  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Limites do garçom',
                                                        '00000000-0000-0000-0000-000000000106'::uuid));
  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-000000000107'::uuid);
  perform tests.eq_int(v_order.total_cents, 5300, '10.15 pedido do bloco de limites: 5300');

  -- Pedido entregue primeiro: o que este bloco testa é o bloqueio pelo SALDO
  -- (a regra do pedido em andamento foi provada em 10.2b).
  perform tests.logout();
  perform tests.login('carlos.caixa');
  perform public.advance_order_status(v_order.id, 'confirmed');
  perform public.advance_order_status(v_order.id, 'preparing');
  perform public.advance_order_status(v_order.id, 'ready');
  perform public.advance_order_status(v_order.id, 'delivered_to_table');
  perform tests.logout();
  perform tests.login('gisele.garcom');

  -- NÃO fecha conta com saldo pendente
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid)$sql$, v_session),
    'BALANCE_PENDING', 'garçom não fecha conta com saldo pendente');

  -- NÃO força o fechamento (exceção que exige justificativa e é só do admin)
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid, true, 'Forçado pelo garçom')$sql$, v_session),
    'FORBIDDEN', 'garçom não força o fechamento de conta');

  -- NÃO estorna recebimento
  v_pagamento := public.register_payment(v_order.id, 'pix', 1000, null, false, null,
    '00000000-0000-0000-0000-000000000108'::uuid);
  perform tests.expect_error(
    format($sql$select public.reverse_payment(%L::uuid, 'Estorno do garçom')$sql$, v_pagamento.id),
    'FORBIDDEN', 'garçom não estorna recebimento');

  -- NÃO dá desconto
  perform tests.expect_error(
    format($sql$select public.set_order_discount(%L::uuid, 'Desconto do garçom', 10)$sql$, v_order.id),
    'FORBIDDEN', 'garçom não aplica desconto');

  -- NÃO abre nem fecha o caixa
  perform tests.expect_error(
    $sql$select public.close_cash_session('00000000-0000-0000-0000-000000000115'::uuid, 0, 'Fechado pelo garçom')$sql$,
    'FORBIDDEN', 'garçom não fecha o caixa');

  -- NÃO lança pedido de delivery (regra que já existia, continua valendo)
  perform tests.expect_error(
    $sql$select public.create_order(
      jsonb_build_object('service_mode', 'delivery',
                         'customer', jsonb_build_object('name', 'Teste 10', 'phone', '86999990000'),
                         'items', '[]'::jsonb))$sql$,
    'FORBIDDEN', 'garçom não lança pedido de delivery');

  -- Limpa o que este bloco criou: recebe o saldo e fecha (permitido a ele)
  perform public.register_payment(v_order.id, 'pix', 5300 - 1000, null, false, null,
    '00000000-0000-0000-0000-000000000109'::uuid);
  perform public.close_table_account(v_session);

  perform tests.logout();
end
$$;

-- ------------------------------------------------ 3) caixa continua igual
do $$
declare
  v_fx record;
  v_mesa uuid;
  v_session uuid;
  v_order public.orders;
  v_pagamento public.payments;
begin
  select * into v_fx from tests.fx;
  select id into v_mesa from public.restaurant_tables where number = 2;

  perform tests.login('carlos.caixa');
  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Regressão 10',
                                                        '00000000-0000-0000-0000-000000000110'::uuid));
  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-000000000111'::uuid);

  -- caixa recebe e fecha como sempre fez
  v_pagamento := public.register_payment(v_order.id, 'pix', 5300, null, false, null,
    '00000000-0000-0000-0000-000000000112'::uuid);
  perform tests.eq_text(v_pagamento.status, 'confirmed', '10.11 caixa continua recebendo');

  -- caixa também pode estornar (não perdeu nada)
  perform public.reverse_payment(v_pagamento.id, 'Estorno do caixa (regressão 10)');
  perform tests.eq_text(
    (select status from public.payments where id = v_pagamento.id),
    'reversed', '10.12 caixa continua estornando');

  -- caixa fecha com saldo pendente FORÇANDO (não é admin, então é bloqueado)
  perform tests.expect_error(
    format($sql$select public.close_table_account(%L::uuid, true, 'Forçado pelo caixa')$sql$, v_session),
    'FORBIDDEN', '10.13 só o administrador força fechamento com saldo');

  perform public.register_payment(v_order.id, 'pix', 5300, null, false, null,
    '00000000-0000-0000-0000-000000000113'::uuid);
  -- Pedido entregue antes de fechar (migração 0012): a mesa não é liberada com
  -- pedido em andamento.
  perform public.advance_order_status(v_order.id, 'confirmed');
  perform public.advance_order_status(v_order.id, 'preparing');
  perform public.advance_order_status(v_order.id, 'ready');
  perform public.advance_order_status(v_order.id, 'delivered_to_table');
  perform public.close_table_account(v_session);
  perform tests.eq_int(
    (select count(*) from public.table_sessions where id = v_session and status = 'open'),
    0, '10.14 caixa fecha normalmente (sem regressão)');

  perform tests.logout();
end
$$;
