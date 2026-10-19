-- =============================================================================
-- 0014 — Registrar o último acesso de QUALQUER perfil (não só do admin)
--
-- Achado de auditoria A5: `markLogin` fazia UPDATE direto em `profiles`. A única
-- política de UPDATE da tabela é `profiles_update_admin`, então o RLS filtrava
-- as linhas de caixa e garçom sem erro (0 linhas atualizadas) e `last_login_at`
-- ficava nulo para eles.
--
-- A correção não abre a tabela: cria uma função estreita que atualiza APENAS
-- `last_login_at` do próprio perfil autenticado. Nem o próprio usuário ganha
-- permissão para mexer em papel, nome ou situação.
-- =============================================================================

create or replace function public.touch_last_login()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_agora   timestamptz := now();
begin
  v_profile := app_private.current_profile();

  if v_profile.id is null then
    raise exception 'AUTH_REQUIRED: usuário sem perfil ativo. Contate o administrador.'
      using errcode = '42501';
  end if;

  update public.profiles
     set last_login_at = v_agora
   where id = v_profile.id;

  return v_agora;
end
$$;

revoke all on function public.touch_last_login() from public, anon;
grant execute on function public.touch_last_login() to authenticated, service_role;
