-- =============================================================================
-- 24_mesa_com_conta_aberta.sql — regra da seção 4.7 aplicada no banco
--
-- A tela já bloqueava, mas a API aceitava: um UPDATE em `restaurant_tables`
-- feito fora da tela desativava a mesa com a conta aberta. Este arquivo prova
-- que a regra agora vale no PostgreSQL e que ela é específica (não atrapalha
-- renomear, corrigir lugares, reativar nem excluir mesa nunca usada).
-- =============================================================================

do $$
declare
  v_mesa    uuid;
  v_session uuid;
  v_nova    uuid;
  v_ativa   boolean;
  v_restou  integer;
begin
  perform tests.login('ana.admin');

  select t.id into v_mesa
    from public.restaurant_tables t
   where t.number <> 12
     and t.is_active
     and not exists (select 1 from public.table_sessions s
                      where s.table_id = t.id and s.status = 'open')
   order by t.number
   limit 1;

  if v_mesa is null then
    raise exception 'ASSERT FALHOU: não há mesa livre para o teste 24';
  end if;

  v_session := (select id from public.open_table_session(v_mesa, 2::smallint, 'Teste 24'));

  -- 1) Desativar com conta aberta: recusado no banco.
  perform tests.expect_error(
    format('update public.restaurant_tables set is_active = false where id = %L', v_mesa),
    'TABLE_HAS_OPEN_ACCOUNT',
    'desativar mesa com conta aberta é recusado pelo banco');

  select is_active into v_ativa from public.restaurant_tables where id = v_mesa;
  perform tests.eq_bool(v_ativa, true, 'a mesa continua ativa após a tentativa recusada');

  -- 2) Editar dados da mesa com conta aberta: continua permitido.
  update public.restaurant_tables set seats = 4 where id = v_mesa;
  perform tests.eq_int(
    (select seats from public.restaurant_tables where id = v_mesa),
    4, 'corrigir lugares com conta aberta continua permitido');

  -- 3) Excluir mesa com atendimento registrado: recusado (histórico preservado).
  perform tests.expect_error(
    format('delete from public.restaurant_tables where id = %L', v_mesa),
    'TABLE_HAS_HISTORY',
    'excluir mesa com histórico é recusado pelo banco');

  perform tests.eq_int(
    (select count(*) from public.restaurant_tables where id = v_mesa),
    1, 'a mesa continua existindo depois da tentativa de exclusão');

  -- 4) Sem conta aberta, desativar volta a funcionar.
  perform public.close_table_account(v_session);
  perform tests.eq_int(
    (select count(*) from public.table_sessions
      where table_id = v_mesa and status = 'open'),
    0, 'a conta do teste foi encerrada');

  update public.restaurant_tables set is_active = false where id = v_mesa;
  perform tests.eq_bool(
    (select is_active from public.restaurant_tables where id = v_mesa),
    false, 'sem conta aberta a mesa pode ser desativada');

  update public.restaurant_tables set is_active = true where id = v_mesa;
  perform tests.eq_bool(
    (select is_active from public.restaurant_tables where id = v_mesa),
    true, 'a mesa pode ser reativada');

  -- 5) Mesa nunca usada pode ser excluída (a trava não é um bloqueio geral).
  insert into public.restaurant_tables (number, name, seats)
  values (97, 'Mesa de teste 24', 4)
  returning id into v_nova;

  delete from public.restaurant_tables where id = v_nova;
  select count(*) into v_restou from public.restaurant_tables where id = v_nova;
  perform tests.eq_int(v_restou, 0, 'mesa sem atendimento pode ser excluída');
end
$$;
