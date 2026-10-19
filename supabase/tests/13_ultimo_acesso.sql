-- =============================================================================
-- 13_ultimo_acesso.sql — todo perfil registra o próprio último acesso (A5)
-- =============================================================================

do $$
declare
  v_caixa  uuid;
  v_garcom uuid;
  v_admin  timestamptz;
  v_antes  timestamptz;
begin
  -- Estado de partida: ninguém registrou acesso ainda.
  update public.profiles set last_login_at = null
   where login in ('carlos.caixa', 'gisele.garcom', 'ana.admin');
  select last_login_at into v_admin from public.profiles where login = 'ana.admin';

  -- Caixa registra o próprio acesso.
  v_caixa := tests.login('carlos.caixa');
  perform public.touch_last_login();
  perform tests.logout();
  perform tests.ok(
    (select last_login_at is not null from public.profiles where login = 'carlos.caixa'),
    'caixa consegue registrar o próprio último acesso');

  -- Garçom também.
  v_garcom := tests.login('gisele.garcom');
  perform public.touch_last_login();
  perform tests.logout();
  perform tests.ok(
    (select last_login_at is not null from public.profiles where login = 'gisele.garcom'),
    'garçom consegue registrar o próprio último acesso');

  -- Ninguém altera o último acesso de OUTRA pessoa: a função só toca no próprio.
  select last_login_at into v_antes from public.profiles where login = 'ana.admin';
  perform tests.eq_text(v_antes::text, v_admin::text,
    'acesso do caixa/garçom não mexe no perfil do administrador');

  -- A função não serve para mudar papel nem situação.
  perform tests.login('carlos.caixa');
  -- Sem política de UPDATE para o caixa, o PostgreSQL não lança erro: filtra
  -- as linhas e atualiza zero. O teste confere exatamente isso.
  perform tests.assert_blocked_write(
    $sql$update public.profiles set role = 'admin' where login = 'carlos.caixa'$sql$,
    'caixa não altera o próprio papel por UPDATE direto');
  perform tests.logout();

  -- Visitante anônimo não executa.
  perform tests.login_anon();
  perform tests.expect_error('select public.touch_last_login()', 'permission denied',
    'anônimo não registra acesso');
  perform tests.logout();
end
$$;
