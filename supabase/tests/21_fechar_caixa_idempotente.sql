-- =============================================================================
-- 21_fechar_caixa_idempotente.sql — fechamento repetido não duplica nada (A2)
-- =============================================================================

do $$
declare
  v_cash     uuid;
  v_esperado integer;
  v_primeiro public.cash_sessions;
  v_segundo  public.cash_sessions;
  v_auditorias integer;
begin
  select id, expected_cash_cents into v_cash, v_esperado
    from public.cash_session_overview where status = 'open';

  perform tests.ok(v_cash is not null, 'há um turno de caixa aberto para fechar no teste');

  perform tests.login('carlos.caixa');

  -- 1) fechamento normal
  v_primeiro := public.close_cash_session(v_cash, v_esperado, 'Fechamento do teste 21');
  perform tests.eq_text(v_primeiro.status, 'closed', 'caixa fechado');
  perform tests.eq_int(v_primeiro.difference_cents, 0, 'sem divergência no fechamento do teste');

  -- 2) a MESMA requisição repetida devolve o mesmo fechamento, sem erro
  v_segundo := public.close_cash_session(v_cash, v_esperado, 'Fechamento do teste 21');
  perform tests.ok(v_segundo.id = v_primeiro.id, 'repetir o fechamento devolve a mesma sessão (não é erro)');
  perform tests.eq_int(v_segundo.counted_cash_cents, v_primeiro.counted_cash_cents,
    'o valor contado não muda na repetição');
  perform tests.eq_int(v_segundo.difference_cents, v_primeiro.difference_cents,
    'a divergência não muda na repetição');

  -- 3) auditoria registrada UMA vez só (o caixa não lê audit_logs: quem confere é o admin)
  perform tests.logout();
  perform tests.login('ana.admin');
  select count(*) into v_auditorias
    from public.audit_logs
   where action = 'cash_session.close'
     and cash_session_id = v_cash;
  perform tests.eq_int(v_auditorias, 1, 'a auditoria do fechamento não é duplicada');
  perform tests.logout();
  perform tests.login('carlos.caixa');

  -- 4) conteúdo diferente no mesmo caixa já fechado continua sendo erro de negócio
  perform tests.expect_error(
    format($sql$select public.close_cash_session(%L::uuid, %s, 'Outra contagem')$sql$, v_cash, v_esperado + 500),
    'CASH_SESSION_CLOSED', 'fechamento com contagem diferente em caixa já fechado é recusado');

  -- 5) devolve o turno aberto para os testes seguintes (concorrência usa o caixa)
  perform public.start_cash_session(10000, 'Turno reaberto após o teste 21',
    '00000000-0000-0000-0000-0000000005a3'::uuid);
  perform tests.eq_bool(public.cash_session_is_open(), true, 'o turno é reaberto para os testes seguintes');

  perform tests.logout();
end
$$;
