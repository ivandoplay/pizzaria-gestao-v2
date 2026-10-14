-- =============================================================================
-- 06_reports.sql — relatórios conferidos contra os registros + auditoria
-- =============================================================================
-- Critério (seção 17): "os números do painel saem dos dados reais". Aqui cada
-- indicador é comparado com uma consulta independente feita sobre as tabelas.
-- =============================================================================

-- --------------------------------- 1) relatórios são restritos ao administrador
do $$
begin
  perform tests.login('gisele.garcom');
  perform tests.expect_error(
    $sql$select public.get_financial_summary(now() - interval '1 day', now() + interval '1 day')$sql$,
    'FORBIDDEN', 'garçom não acessa o resumo financeiro');
  perform tests.expect_error(
    $sql$select public.get_sales_series(now() - interval '7 days', now())$sql$,
    'FORBIDDEN', 'garçom não acessa a série de vendas');
  perform tests.expect_error(
    $sql$select public.get_cash_sessions_report(now() - interval '1 day', now() + interval '1 day')$sql$,
    'FORBIDDEN', 'garçom não acessa relatório de caixa');
  perform tests.logout();

  perform tests.login('carlos.caixa');
  perform tests.expect_error(
    $sql$select public.get_financial_summary(now() - interval '1 day', now() + interval '1 day')$sql$,
    'FORBIDDEN', 'caixa não acessa o resumo financeiro (visão administrativa)');
  perform tests.ok(
    (public.get_operational_summary(now()) ->> 'day') is not null,
    'caixa usa o painel operacional do turno normalmente');
  perform tests.ok(
    (select count(*) from public.get_orders_page(now() - interval '1 day', now() + interval '1 day')) > 0,
    'caixa consulta o histórico de pedidos');
  perform tests.logout();
end
$$;

-- ------------------------- 2) resumo financeiro confere com as tabelas de origem
do $$
declare
  v_fx record;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_resumo jsonb;
  v_validos record;
  v_cancelados record;
  v_recebido integer;
begin
  select * into v_fx from tests.fx;
  v_inicio := now() - interval '1 day';
  v_fim := now() + interval '1 day';

  perform tests.login('ana.admin');

  v_resumo := public.get_financial_summary(v_inicio, v_fim);

  -- valores de referência calculados direto das tabelas
  select
    count(*)                          as qtd,
    coalesce(sum(subtotal_cents), 0)  as bruto,
    coalesce(sum(discount_cents), 0)  as descontos,
    coalesce(sum(delivery_fee_cents), 0) as taxas,
    coalesce(sum(total_cents), 0)     as liquido,
    coalesce(sum(total_cents - paid_cents), 0) as pendente
  into v_validos
  from public.orders
  where status <> 'cancelled' and created_at between v_inicio and v_fim;

  select count(*) as qtd, coalesce(sum(total_cents), 0) as valor
  into v_cancelados
  from public.orders
  where status = 'cancelled' and created_at between v_inicio and v_fim;

  select coalesce(sum(amount_cents), 0) into v_recebido
  from public.payments
  where status = 'confirmed' and created_at between v_inicio and v_fim;

  perform tests.eq_int((v_resumo ->> 'orders_valid_count')::bigint, v_validos.qtd,
    'resumo: pedidos válidos conferem');
  perform tests.eq_int((v_resumo ->> 'gross_items_cents')::bigint, v_validos.bruto,
    'resumo: faturamento bruto dos itens confere');
  perform tests.eq_int((v_resumo ->> 'discounts_cents')::bigint, v_validos.descontos,
    'resumo: descontos concedidos conferem');
  perform tests.eq_int((v_resumo ->> 'delivery_fees_cents')::bigint, v_validos.taxas,
    'resumo: taxas de entrega conferem');
  perform tests.eq_int((v_resumo ->> 'net_valid_cents')::bigint, v_validos.liquido,
    'resumo: vendas líquidas conferem');
  perform tests.eq_int((v_resumo ->> 'pending_cents')::bigint, v_validos.pendente,
    'resumo: saldo pendente confere');
  perform tests.eq_int((v_resumo ->> 'received_cents')::bigint, v_recebido,
    'resumo: recebidos conferem (somente pagamentos confirmados)');
  perform tests.eq_int((v_resumo ->> 'orders_cancelled_count')::bigint, v_cancelados.qtd,
    'resumo: pedidos cancelados conferem');
  perform tests.eq_int((v_resumo ->> 'cancelled_cents')::bigint, v_cancelados.valor,
    'resumo: valor cancelado conferido à parte (não entra como venda)');

  perform tests.eq_int(
    (v_resumo ->> 'ticket_average_cents')::bigint,
    case when v_validos.qtd > 0 then round(v_validos.liquido::numeric / v_validos.qtd)::bigint else 0 end,
    'resumo: ticket médio = líquido ÷ pedidos válidos');

  perform tests.eq_int(
    (v_resumo -> 'dine_in' ->> 'orders_count')::bigint
      + (v_resumo -> 'delivery' ->> 'orders_count')::bigint,
    v_validos.qtd, 'resumo: salão + delivery = total de pedidos válidos');

  perform tests.eq_int(
    (v_resumo -> 'delivery' ->> 'fees_cents')::bigint,
    (v_resumo ->> 'delivery_fees_cents')::bigint,
    'resumo: taxas de entrega vêm apenas do delivery');

  perform tests.eq_text(v_resumo -> 'period' ->> 'timezone', 'America/Fortaleza',
    'resumo informa o fuso horário usado nos agrupamentos');

  -- filtro por modalidade
  v_resumo := public.get_financial_summary(v_inicio, v_fim, 'delivery');
  perform tests.eq_int((v_resumo ->> 'orders_valid_count')::bigint,
    (select count(*) from public.orders
      where status <> 'cancelled' and service_mode = 'delivery' and created_at between v_inicio and v_fim),
    'filtro por modalidade (delivery) confere');

  v_resumo := public.get_financial_summary(v_inicio, v_fim, 'dine_in');
  perform tests.eq_int((v_resumo ->> 'orders_valid_count')::bigint,
    (select count(*) from public.orders
      where status <> 'cancelled' and service_mode = 'dine_in' and created_at between v_inicio and v_fim),
    'filtro por modalidade (salão) confere');

  -- filtro por funcionário
  v_resumo := public.get_financial_summary(v_inicio, v_fim, null, v_fx.p_caixa);
  perform tests.eq_int((v_resumo ->> 'orders_valid_count')::bigint,
    (select count(*) from public.orders
      where status <> 'cancelled' and created_by = v_fx.p_caixa and created_at between v_inicio and v_fim),
    'filtro por funcionário confere');

  perform tests.logout();
end
$$;

-- ----------------------------------------------- 3) série, produtos e recebimentos
do $$
declare
  v_inicio timestamptz;
  v_fim timestamptz;
  v_soma_serie integer;
  v_liquido integer;
  v_linha record;
  v_produto record;
  v_metodo record;
begin
  v_inicio := now() - interval '1 day';
  v_fim := now() + interval '1 day';

  perform tests.login('ana.admin');

  select coalesce(sum(net_cents), 0) into v_soma_serie
  from public.get_sales_series(v_inicio, v_fim, 'day');
  select coalesce(sum(total_cents), 0) into v_liquido
  from public.orders where status <> 'cancelled' and created_at between v_inicio and v_fim;
  perform tests.eq_int(v_soma_serie, v_liquido, 'série por dia soma o mesmo líquido do resumo');

  declare
    v_por_mes integer;
  begin
    select coalesce(sum(net_cents), 0)::bigint into v_por_mes
    from public.get_sales_series(v_inicio, v_fim, 'month');
    perform tests.eq_int(v_por_mes, v_liquido,
      'agrupamento por mês soma o mesmo líquido do agrupamento por dia');
  end;

  -- top produtos x itens realmente lançados
  select * into v_linha from public.get_top_products(v_inicio, v_fim, 50)
   order by quantity desc, total_cents desc, product_name limit 1;
  select
    sum(oi.quantity) as qtd,
    sum(oi.total_cents) as total
  into v_produto
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.product_id = v_linha.product_id and oi.is_cancelled = false
    and o.status <> 'cancelled' and o.created_at between v_inicio and v_fim;

  perform tests.eq_int(v_linha.quantity::bigint, v_produto.qtd,
    'produto mais vendido: quantidade confere com os itens');
  perform tests.eq_int(v_linha.total_cents::bigint, v_produto.total,
    'produto mais vendido: valor confere com os itens');

  -- recebimentos por forma de pagamento
  select * into v_linha from public.get_payment_method_report(v_inicio, v_fim) where method_id = 'cash';

  select count(*) as pagamentos, coalesce(sum(amount_cents), 0) as total,
         coalesce(sum(change_cents), 0) as troco
  into v_metodo
  from public.payments
  where status = 'confirmed' and method_id = v_linha.method_id
    and created_at between v_inicio and v_fim;

  perform tests.eq_int(v_linha.payments_count::bigint, v_metodo.pagamentos,
    'recebimentos por forma: quantidade confere');
  perform tests.eq_int(v_linha.received_cents::bigint, v_metodo.total,
    'recebimentos por forma: valor confere');
  perform tests.eq_int(v_linha.change_cents::bigint, v_metodo.troco,
    'recebimentos por forma: troco conferido');

  -- troco não entra na gaveta: só dinheiro afeta a gaveta, e pelo valor líquido
  perform tests.eq_int(
    (select coalesce(sum(in_drawer_cents), 0)::bigint from public.get_payment_method_report(v_inicio, v_fim)
      where method_id <> 'cash'),
    0, 'somente dinheiro entra na gaveta');

  perform tests.eq_int(
    (select sum(in_drawer_cents)::bigint from public.get_payment_method_report(v_inicio, v_fim) where method_id = 'cash'),
    (select coalesce(sum(p.amount_cents), 0) from public.payments p
      where p.status = 'confirmed' and p.method_id = 'cash'
        and p.created_at between v_inicio and v_fim),
    'a gaveta recebe o valor líquido do dinheiro, sem o troco');

  -- vendas por funcionário
  select * into v_linha from public.get_sales_by_employee(v_inicio, v_fim)
   order by orders_count desc, full_name limit 1;
  perform tests.eq_int(v_linha.orders_count::bigint,
    (select count(*) from public.orders
      where created_by = v_linha.profile_id and status <> 'cancelled'
        and created_at between v_inicio and v_fim),
    'vendas por funcionário: pedidos conferem');

  perform tests.logout();
end
$$;

-- --------------------------------------------- 4) relatório de caixa e fechamento
do $$
declare
  v_inicio timestamptz;
  v_fim timestamptz;
  v_linha record;
begin
  v_inicio := now() - interval '1 day';
  v_fim := now() + interval '1 day';

  perform tests.login('ana.admin');

  select * into v_linha from public.get_cash_sessions_report(v_inicio, v_fim)
   where counted_cents is not null limit 1;

  perform tests.eq_int(v_linha.expected_cents::bigint,
    (select expected_cash_cents from public.cash_sessions where id = v_linha.session_id),
    'relatório de caixa: valor esperado confere com a sessão fechada');
  perform tests.eq_int(v_linha.counted_cents::bigint,
    (select counted_cash_cents from public.cash_sessions where id = v_linha.session_id),
    'relatório de caixa: valor contado confere');
  perform tests.eq_int(v_linha.difference_cents::bigint,
    v_linha.counted_cents::bigint - v_linha.expected_cents::bigint,
    'relatório de caixa: divergência = contado - esperado');
  perform tests.ok(v_linha.variance_reason is not null,
    'relatório de caixa mostra a justificativa da divergência');

  -- painel operacional
  declare
    v_painel jsonb;
  begin
    v_painel := public.get_operational_summary(now());
    perform tests.ok((v_painel ->> 'tables_available') is not null, 'painel operacional: mesas disponíveis');
    perform tests.ok((v_painel ->> 'open_accounts_balance_cents') is not null,
      'painel operacional: saldo das contas abertas');
    perform tests.eq_int((v_painel ->> 'open_orders_count')::bigint,
      (select count(*) from public.orders where status <> 'cancelled' and account_closed_at is null),
      'painel operacional: pedidos abertos conferem');
  end;

  perform tests.logout();

  -- o caixa também usa o painel, mas não vê o resto
  perform tests.login('carlos.caixa');
  perform tests.ok((public.get_operational_summary(now()) ->> 'day') is not null,
    'caixa acessa o painel operacional do turno');
  perform tests.logout();
end
$$;

-- ----------------------------------------- 5) histórico de pedidos com paginação
do $$
declare
  v_pagina record;
  v_total integer;
begin
  perform tests.login('carlos.caixa');

  select count(*) into v_total from public.get_orders_page(now() - interval '1 day', now() + interval '1 day');
  perform tests.ok(v_total >= 8, 'histórico lista todos os pedidos do período');

  select * into v_pagina from public.get_orders_page(now() - interval '1 day', now() + interval '1 day', null, null, null, null, 3, 0);
  perform tests.eq_int((select count(*) from public.get_orders_page(now() - interval '1 day', now() + interval '1 day', null, null, null, null, 3, 0)), 3,
    'paginação respeita o limite pedido');
  perform tests.eq_int(v_pagina.total_count, v_total, 'paginação informa o total de registros');

  -- busca por telefone do cliente de delivery (o caixa digita só os dígitos)
  select * into v_pagina from public.get_orders_page(now() - interval '1 day', now() + interval '1 day',
                                                     null, null, null, '988887777', 50, 0);
  perform tests.ok(v_pagina.total_count >= 1,
    'busca por telefone (só dígitos) encontra o pedido de delivery');

  select * into v_pagina from public.get_orders_page(now() - interval '1 day', now() + interval '1 day',
                                                     null, null, null, '9888', 50, 0);
  perform tests.ok(v_pagina.total_count >= 1, 'busca por telefone aceita trecho parcial');

  select * into v_pagina from public.get_orders_page(now() - interval '1 day', now() + interval '1 day',
                                                     null, null, null, 'João Zona', 50, 0);
  perform tests.ok(v_pagina.total_count >= 1, 'busca por nome do cliente funciona');

  -- filtro por situação
  select * into v_pagina from public.get_orders_page(now() - interval '1 day', now() + interval '1 day',
                                                     'cancelled', null, null, null, 50, 0);
  perform tests.eq_int(v_pagina.total_count,
    (select count(*) from public.orders where status = 'cancelled' and created_at between now() - interval '1 day' and now() + interval '1 day'),
    'filtro por situação confere com os pedidos cancelados');

  perform tests.logout();
end
$$;

-- ------------------------------------------------------ 6) trilha de auditoria
do $$
declare
  v_eventos text[] := array[
    'order.create', 'order.status.confirmed', 'order.status.cancelled',
    'order_item.cancel', 'order.discount', 'payment.register', 'payment.reverse',
    'table_session.open', 'table_account.close', 'cash_session.close',
    'cash_movement.out', 'delivery_account.close', 'order.delivery_fee'
  ];
  v_evento text;
begin
  perform tests.login('ana.admin');

  foreach v_evento in array v_eventos loop
    perform tests.ok(
      (select count(*) from public.audit_logs where action = v_evento) > 0,
      format('auditoria registra o evento "%s"', v_evento));
  end loop;

  -- nada de senha/token/segredo na trilha
  perform tests.eq_int(
    (select count(*) from public.audit_logs
      where details::text ilike '%password%' or details::text ilike '%token%'
         or details::text ilike '%secret%'),
    0, 'a auditoria não guarda senhas, tokens ou segredos');

  -- quem fez, quando e o que mudou
  perform tests.ok(
    (select count(*) from public.audit_logs where actor_name is null) = 0,
    'todo evento audita o autor');
  perform tests.ok(
    (select count(*) from public.audit_logs where occurred_at is null) = 0,
    'todo evento audita a data/hora');

  -- eventos financeiros guardam valor e/ou motivo
  perform tests.ok(
    (select count(*) from public.audit_logs
      where action in ('payment.register', 'payment.reverse', 'cash_session.close')
        and amount_cents is not null) > 0,
    'eventos financeiros são auditados com valor');

  perform tests.ok(
    (select count(*) from public.audit_logs
      where action = 'order.discount' and reason is not null) > 0,
    'descontos são auditados com justificativa');

  -- a trilha é somente-adição: nem o admin consegue apagar
  perform tests.expect_denied(
    $sql$delete from public.audit_logs$sql$,
    'auditoria é somente-adição (nem o admin apaga)');

  perform tests.logout();
end
$$;
