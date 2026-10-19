-- =============================================================================
-- 18_execute_somente_autenticado.sql — anon não executa RPC (A15)
-- =============================================================================

do $$
declare
  v_publicas integer;
begin
  -- Nenhuma função do schema public pode ser executada por anon.
  select count(*) into v_publicas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute');
  perform tests.eq_int(v_publicas, 0, 'nenhuma função pública com EXECUTE para anon');

  -- A equipe continua podendo (não houve regressão de acesso).
  perform tests.ok(
    has_function_privilege('authenticated', 'public.create_order(jsonb,uuid)', 'execute'),
    'authenticated continua podendo criar pedido');
  perform tests.ok(
    has_function_privilege('authenticated', 'public.register_payment(uuid,text,integer,integer,boolean,text,uuid)', 'execute'),
    'authenticated continua podendo registrar recebimento');

  -- Chamada anônima real: o PostgreSQL barra antes de qualquer regra de negócio.
  perform tests.login_anon();
  perform tests.expect_error(
    $sql$select public.register_payment('00000000-0000-0000-0000-000000000000'::uuid, 'pix', 100)$sql$,
    'permission denied', 'anon não chama register_payment');
  perform tests.expect_error(
    $sql$select public.create_order('{}'::jsonb, null)$sql$,
    'permission denied', 'anon não chama create_order');
  perform tests.logout();
end
$$;
