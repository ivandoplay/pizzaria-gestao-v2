-- =============================================================================
-- 19_senha_obrigatoria.sql — senha temporária bloqueia RPC no servidor (A16)
-- =============================================================================

do $$
declare
  v_caixa uuid;
  v_fx    record;
begin
  select * into v_fx from tests.fx;

  perform tests.login('ana.admin');
  update public.profiles set must_change_password = true where login = 'carlos.caixa';
  perform tests.logout();

  perform tests.login('carlos.caixa');

  -- Qualquer RPC de negócio é recusada enquanto a flag estiver ligada.
  perform tests.expect_error(
    format($sql$select public.start_cash_session(0, 'tentativa com senha temporária')$sql$),
    'PASSWORD_CHANGE_REQUIRED', 'abrir caixa com senha temporária é recusado');
  perform tests.expect_error(
    format($sql$select public.create_order(%L::jsonb, null)$sql$,
      jsonb_build_object('service_mode', 'dine_in', 'table_session_id', gen_random_uuid(),
        'items', '[]'::jsonb)::text),
    'PASSWORD_CHANGE_REQUIRED', 'criar pedido com senha temporária é recusado');

  -- O caminho de saída continua aberto: a função da 0009 não usa require_role.
  perform public.complete_password_change();
  perform tests.eq_bool(
    (select must_change_password from public.profiles where login = 'carlos.caixa'),
    false, 'a própria pessoa baixa a flag pela função de troca');

  -- Depois da troca, a operação volta a funcionar (RPC barata, sem depender do
  -- estado do caixa deixado por outros arquivos).
  perform tests.eq_bool(public.cash_session_is_open(), true,
    'RPC volta a funcionar depois da troca');
  perform tests.logout();

  -- Administrador sem senha temporária não é afetado.
  perform tests.login('ana.admin');
  perform tests.ok(
    (select not must_change_password from public.profiles where login = 'ana.admin'),
    'administrador segue operando normalmente');
  perform tests.logout();
end
$$;
