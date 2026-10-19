-- =============================================================================
-- 0020 — A troca obrigatória de senha passa a valer no servidor
--
-- Achado de auditoria A16: `must_change_password` era só um portão de tela.
-- Quem entrasse com a senha temporária podia chamar as RPCs direto (PostgREST)
-- e operar o sistema inteiro sem trocar a senha.
--
-- Agora `app_private.require_role` — usada por TODA função de negócio — recusa
-- com PASSWORD_CHANGE_REQUIRED enquanto a flag estiver ligada.
--
-- Exceções conscientes:
--   * `complete_password_change()` (migração 0009) não usa require_role, então
--     continua funcionando e é o único caminho para baixar a flag;
--   * `touch_last_login()` não usa require_role e continua registrando acesso;
--   * chamadas com service_role (Edge Functions) não passam por este ramo.
-- =============================================================================

create or replace function app_private.require_role(variadic p_roles text[])
returns public.profiles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
begin
  if app_private.jwt_role() = 'service_role' then
    -- Operações server-side privilegiadas (Edge Functions). Não há perfil humano;
    -- devolve o primeiro admin ativo como referência de auditoria.
    select p.* into v_profile from public.profiles p
      where p.role = 'admin' and p.is_active order by p.created_at limit 1;
    if v_profile.id is null then
      raise exception 'AUTH_REQUIRED: nenhum administrador ativo cadastrado' using errcode = '42501';
    end if;
    return v_profile;
  end if;

  v_profile := app_private.current_profile();

  if v_profile.id is null then
    raise exception 'AUTH_REQUIRED: usuário sem perfil ativo. Contate o administrador.'
      using errcode = '42501';
  end if;

  -- Senha temporária: a tela já força a troca, mas a regra precisa valer no
  -- servidor. Sem isto, uma sessão antiga podia operar por RPC direta sem
  -- nunca trocar a senha que o administrador conhece (achado A16).
  if coalesce(v_profile.must_change_password, false) then
    raise exception 'PASSWORD_CHANGE_REQUIRED: troque a senha temporária antes de usar o sistema'
      using errcode = '42501';
  end if;

  if not (v_profile.role = any (p_roles)) then
    raise exception 'FORBIDDEN: perfil % não autorizado nesta operação (requer: %)',
      v_profile.role, array_to_string(p_roles, ', ') using errcode = '42501';
  end if;

  return v_profile;
end
$$;
