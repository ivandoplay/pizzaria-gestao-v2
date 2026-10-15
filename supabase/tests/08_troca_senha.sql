-- =============================================================================
-- 08_troca_senha.sql — troca obrigatória de senha (migração 0009)
-- =============================================================================
-- O que precisa ficar provado:
--   1. visitante (anon) não consegue baixar flag nenhuma;
--   2. o funcionário baixa a PRÓPRIA flag e mais nada;
--   3. a operação é idempotente (chamar de novo não muda nada);
--   4. fica registrada na auditoria;
--   5. funcionário inativo não usa o caminho para se "liberar".
--
-- Roda no banco de TESTE (tools/run-sql-tests.sh), que recria tudo a partir das
-- migrações. NÃO rode contra o projeto em produção: ele mexe na flag dos perfis
-- reais (mesmo restaurando o estado no fim).
-- =============================================================================

do $$
declare
  -- Atenção: `profiles.id` NÃO é o id do auth.users (o vínculo é auth_user_id);
  -- a flag fica no perfil, então as contas são localizadas pelo login.
  v_admin  uuid := (select id from public.profiles where login = 'ana.admin');
  v_caixa  uuid := (select id from public.profiles where login = 'carlos.caixa');
  v_garcom uuid := (select id from public.profiles where login = 'gisele.garcom');
  v_inativo uuid := (select id from public.profiles where login = 'inacio.inativo');
  v_antes  integer;
  -- Estado original das flags, para devolver o banco como estava.
  v_orig_admin   boolean := (select must_change_password from public.profiles where login = 'ana.admin');
  v_orig_caixa   boolean := (select must_change_password from public.profiles where login = 'carlos.caixa');
  v_orig_garcom  boolean := (select must_change_password from public.profiles where login = 'gisele.garcom');
  v_orig_inativo boolean := (select must_change_password from public.profiles where login = 'inacio.inativo');
begin
  -- ---------------------------------------------------------------- 1) anônimo
  perform tests.login_anon();
  perform tests.expect_denied(
    $sql$select public.complete_password_change()$sql$,
    'visitante sem sessão não baixa flag de senha');
  perform tests.logout();

  -- Preparação: as duas contas entram com senha temporária pendente.
  -- (feito como postgres, fora de qualquer RLS)
  update public.profiles set must_change_password = true where id in (v_caixa, v_garcom);
  perform tests.eq_int(
    (select count(*) from public.profiles where id in (v_caixa, v_garcom) and must_change_password),
    2, 'as duas contas de teste começam com troca pendente');

  -- ------------------------------------------------------- 2) o próprio caixa
  perform tests.login('carlos.caixa');
  perform public.complete_password_change();

  perform tests.ok(
    (select not must_change_password from public.profiles where id = v_caixa),
    'o caixa baixou a própria flag de troca de senha');

  perform tests.logout();

  perform tests.ok(
    (select must_change_password from public.profiles where id = v_garcom),
    'a flag do garçom não foi tocada por outra pessoa');

  -- ------------------------------------------------------ 3) idempotência
  select count(*) into v_antes from public.audit_logs where action = 'profile.password_changed';

  perform tests.login('carlos.caixa');
  perform public.complete_password_change();
  perform tests.logout();

  perform tests.eq_int(
    (select count(*) from public.audit_logs where action = 'profile.password_changed'),
    v_antes, 'chamar de novo não gera evento repetido de auditoria');

  -- ---------------------------------------------------------- 4) auditoria
  perform tests.ok(
    exists (
      select 1 from public.audit_logs
       where action = 'profile.password_changed'
         and actor_profile_id = v_caixa
         and entity_id = v_caixa::text
    ),
    'a troca de senha ficou registrada com autor e alvo');

  -- -------------------------------------------------------- 5) inativo
  -- Conta desativada: a função exige um perfil ATIVO na sessão, então a recusa
  -- vem como AUTH_REQUIRED (regra de negócio) e não como erro de permissão.
  update public.profiles set must_change_password = true where id = v_inativo;

  perform tests.login('inacio.inativo');
  perform tests.expect_error(
    $sql$select public.complete_password_change()$sql$,
    'AUTH_REQUIRED',
    'funcionário desativado não usa a troca de senha para voltar ao sistema');
  perform tests.logout();

  perform tests.ok(
    (select must_change_password from public.profiles where id = v_inativo),
    'a flag do funcionário desativado continua de pé (ele não se liberou sozinho)');

  -- Devolve cada flag ao valor que tinha quando o arquivo começou.
  update public.profiles
     set must_change_password = case id
       when v_admin then v_orig_admin
       when v_caixa then v_orig_caixa
       when v_garcom then v_orig_garcom
       when v_inativo then v_orig_inativo
     end
   where id in (v_admin, v_caixa, v_garcom, v_inativo);
end
$$;
