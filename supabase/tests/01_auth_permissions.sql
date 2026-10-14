-- =============================================================================
-- 01_auth_permissions.sql — autenticação, perfis e RLS
-- =============================================================================
-- Critério de aceitação (seção 17): "há três perfis funcionais e cada um só
-- consegue fazer o que lhe cabe; o controle é do banco, não do frontend".
-- =============================================================================

-- ---------------------------------------------------------------- 1) anônimo
do $$
begin
  perform tests.login_anon();

  perform tests.eq_int((select count(*) from public.products), 0,
    'anon não enxerga o cardápio');

  perform tests.eq_int((select count(*) from public.table_overview), 0,
    'anon não enxerga o mapa de mesas');

  perform tests.eq_int((select count(*) from public.orders), 0,
    'anon não enxerga pedidos');

  perform tests.expect_denied(
    $sql$insert into public.products (category_id, name, kind)
         select id, 'Invasão', 'simple' from public.categories limit 1$sql$,
    'anon não cadastra produtos');

  perform tests.logout();
end
$$;

-- ---------------------------------------------------------------- 2) inativo
do $$
declare
  v_table uuid;
begin
  -- o id é lido ANTES de trocar de identidade: o inativo não vê as tabelas
  select id into v_table from public.restaurant_tables order by number limit 1;

  perform tests.login('inacio.inativo');

  perform tests.eq_int((select count(*) from public.products), 0,
    'funcionário INATIVO não acessa o sistema (nenhum dado do cardápio)');

  perform tests.eq_int((select count(*) from public.table_overview), 0,
    'funcionário INATIVO não enxerga mesas');

  perform tests.expect_error(
    format($sql$select public.open_table_session(%L::uuid, 2::smallint)$sql$, v_table),
    'AUTH_REQUIRED', 'funcionário inativo não abre atendimento');

  perform tests.logout();
end
$$;

-- ---------------------------------------------------------------- 3) garçom
do $$
declare
  v_table uuid;
  v_session uuid;
begin
  perform tests.login('gisele.garcom');

  perform tests.ok((select count(*) from public.products) > 0,
    'garçom enxerga o cardápio');

  perform tests.ok((select count(*) from public.payment_methods) > 0,
    'garçom enxerga as formas de pagamento (para informar o cliente)');

  perform tests.eq_int((select count(*) from public.payments), 0,
    'garçom NÃO enxerga recebimentos');

  perform tests.eq_int((select count(*) from public.cash_sessions), 0,
    'garçom NÃO enxerga sessões de caixa');

  perform tests.eq_int((select count(*) from public.audit_logs), 0,
    'garçom NÃO enxerga a auditoria');

  perform tests.expect_denied(
    $sql$insert into public.categories (name) values ('Categoria do garçom')$sql$,
    'garçom não cadastra no cardápio');

  perform tests.expect_error(
    $sql$select public.create_order(
      jsonb_build_object('service_mode', 'delivery',
                         'customer', jsonb_build_object('name', 'Teste', 'phone', '86999990000'),
                         'items', '[]'::jsonb))$sql$,
    'FORBIDDEN', 'garçom não lança pedido de delivery');

  perform tests.assert_blocked_write(
    $sql$update public.business_settings set trade_name = 'Invadido'$sql$,
    'garçom não altera as configurações da loja');

  -- O garçom PODE abrir uma mesa (atribuição do salão)
  select id into v_table from public.restaurant_tables where number = 5;
  v_session := (select id from public.open_table_session(v_table, 3::smallint, 'Família do teste 01'));

  perform tests.ok(v_session is not null,
    'garçom abre um atendimento de mesa');

  perform tests.logout();
end
$$;

-- ---------------------------------------------------------------- 4) caixa
do $$
begin
  perform tests.login('carlos.caixa');

  perform tests.ok((select count(*) from public.products) > 0,
    'caixa enxerga o cardápio');

  perform tests.ok((select count(*) from public.table_overview) > 0,
    'caixa enxerga o mapa de mesas');

  perform tests.eq_int((select count(*) from public.audit_logs), 0,
    'caixa NÃO enxerga a auditoria (somente administrador)');

  perform tests.expect_denied(
    $sql$insert into public.products (category_id, name, kind)
         select id, 'Produto do caixa', 'simple' from public.categories limit 1$sql$,
    'caixa não cadastra produto no cardápio');

  perform tests.assert_blocked_write(
    $sql$update public.business_settings set trade_name = 'Invadido'$sql$,
    'caixa não altera as configurações da loja');

  perform tests.assert_blocked_write(
    $sql$delete from public.payment_methods where id = 'pix'$sql$,
    'caixa não apaga formas de pagamento');

  perform tests.logout();
end
$$;

-- ------------------------------------------------------- 5) administrador
do $$
declare
  v_ana uuid;
  v_gabriel uuid;
begin
  select id into v_ana from public.profiles where login = 'ana.admin';
  select id into v_gabriel from public.profiles where login = 'gabriel.garcom';

  perform tests.login('ana.admin');

  perform tests.ok((select count(*) from public.products) > 0, 'admin enxerga o cardápio');
  perform tests.ok((select count(*) from public.profiles) >= 5, 'admin enxerga todos os funcionários');
  perform tests.ok((select count(*) from public.audit_logs) > 0, 'admin enxerga a auditoria');

  -- Guardas de segurança do perfil
  perform tests.expect_error(
    format($sql$update public.profiles set is_active = false where id = %L::uuid$sql$, v_ana),
    'LAST_ADMIN', 'o último administrador ativo não pode ser desativado');

  perform tests.expect_error(
    format($sql$update public.profiles set role = 'waiter' where id = %L::uuid$sql$, v_ana),
    'SELF_ROLE_CHANGE', 'ninguém altera a própria função');

  -- O admin pode desativar outro funcionário...
  update public.profiles set is_active = false where id = v_gabriel;
  perform tests.eq_bool((select is_active from public.profiles where id = v_gabriel), false,
    'admin desativa o acesso de um funcionário');
  perform tests.logout();

  -- ...e o funcionário desativado perde o acesso imediatamente
  perform tests.login('gabriel.garcom');
  perform tests.eq_int((select count(*) from public.products), 0,
    'acesso desativado vale no mesmo instante (RLS)');
  perform tests.logout();

  perform tests.login('ana.admin');
  update public.profiles set is_active = true where id = v_gabriel;
  perform tests.eq_bool((select is_active from public.profiles where id = v_gabriel), true,
    'admin reativa o acesso do funcionário');

  -- Auditoria append-only com duas camadas: o GRANT de escrita foi retirado do
  -- cliente autenticado e a RLS também não concede nada — nem o admin altera.
  perform tests.expect_denied(
    $sql$delete from public.audit_logs$sql$,
    'nem o admin apaga a auditoria');

  perform tests.expect_denied(
    $sql$update public.audit_logs set action = 'falsificado'$sql$,
    'nem o admin altera a auditoria');

  -- Tabelas de dinheiro e de operação: escrita só por RPC (o GRANT foi retirado,
  -- então o próprio PostgreSQL recusa antes de avaliar a RLS).
  perform tests.expect_denied(
    $sql$insert into public.payments (order_id, method_id, amount_cents)
         values (null, 'cash', 100)$sql$,
    'ninguém insere recebimento direto na tabela');

  perform tests.expect_denied(
    $sql$update public.orders set total_cents = 0$sql$,
    'ninguém altera o total de um pedido por fora da RPC');

  perform tests.expect_denied(
    $sql$delete from public.order_items$sql$,
    'ninguém apaga item de pedido por fora da RPC');

  perform tests.expect_denied(
    $sql$insert into public.cash_movements (cash_session_id, kind, category, amount_cents)
         values (gen_random_uuid(), 'in', 'sale', 100)$sql$,
    'ninguém mexe na gaveta por fora da RPC');

  perform tests.logout();
end
$$;

-- ------------------------------------------- 6) RLS ligada em todas as tabelas
do $$
declare
  v_sem_rls text;
begin
  select string_agg(c.relname, ', ') into v_sem_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;

  perform tests.ok(v_sem_rls is null,
    coalesce('toda tabela de public tem RLS ligada (sem RLS: ' || v_sem_rls || ')',
             'toda tabela de public tem RLS ligada'));

  -- as views de leitura precisam respeitar a RLS das tabelas base
  perform tests.eq_int(
    (select count(*) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and not exists (
          select 1 from pg_options_to_table(c.reloptions) o
          where o.option_name = 'security_invoker' and o.option_value = 'true'
        )),
    0, 'todas as views usam security_invoker (respeitam a RLS)');
end
$$;
