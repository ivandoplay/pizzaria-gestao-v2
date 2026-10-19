-- =============================================================================
-- 0027 — Senha temporária bloqueia também a leitura/escrita direta (RLS)
--
-- Revisão técnica externa de 19/10/2026 (achado R1, prioridade alta).
--
-- A migração 0020 fechou as RPCs: enquanto `must_change_password` está ligada,
-- `app_private.require_role()` recusa qualquer função de negócio. O que ficou
-- de fora foram as **tabelas**: as políticas de RLS usam `is_active_staff()`,
-- `is_manager()`, `is_admin()` e `has_role()`, e nenhuma delas olhava para a
-- flag. Resultado medido no banco de testes, com um gerente marcado:
--
--   produtos = 5 · categorias = 6 · pedidos = 38     (leitura liberada)
--   UPDATE em restaurant_tables                      (escrita liberada)
--
-- Ou seja: quem tinha uma sessão aberta e recebeu senha nova do administrador
-- continuava lendo e escrevendo pelas tabelas até o token expirar — só as RPCs
-- estavam barradas.
--
-- A correção fecha o portão nos quatro auxiliares usados pelas políticas. O que
-- continua funcionando com a flag ligada (de propósito):
--
--   * ler o PRÓPRIO perfil (`profiles_select` tem `id = current_profile_id()`)
--     — é o que permite a tela de troca de senha mostrar o nome do operador;
--   * `complete_password_change()` — o único caminho para baixar a flag;
--   * `touch_last_login()` e `current_profile()` — não usam os auxiliares.
--
-- Nada muda para quem não está com a flag ligada: as funções só ganham
-- `and not coalesce(p.must_change_password, false)` na mesma consulta que já
-- faziam. Para reverter: reaplicar os corpos da migração 0001.
-- =============================================================================

-- Leitura simples da flag, reutilizável em políticas e conferências.
create or replace function app_private.senha_pendente()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.must_change_password from public.profiles p
      where p.auth_user_id = auth.uid() and p.is_active limit 1),
    false
  )
$$;

comment on function app_private.senha_pendente() is
  'Verdadeiro enquanto o operador está com senha temporária (achado R1 da revisão de 20/10).';

-- -----------------------------------------------------------------------------
-- Auxiliares das políticas: exigem perfil ativo E sem senha pendente
-- -----------------------------------------------------------------------------
create or replace function app_private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select true from public.profiles p
      where p.auth_user_id = auth.uid()
        and p.is_active
        and not coalesce(p.must_change_password, false)
      limit 1),
    false
  )
$$;

create or replace function app_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role = 'admin' from public.profiles p
      where p.auth_user_id = auth.uid()
        and p.is_active
        and not coalesce(p.must_change_password, false)
      limit 1),
    false
  )
$$;

create or replace function app_private.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role in ('admin', 'manager') from public.profiles p
      where p.auth_user_id = auth.uid()
        and p.is_active
        and not coalesce(p.must_change_password, false)
      limit 1),
    false
  )
$$;

create or replace function app_private.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role = any (p_roles) from public.profiles p
      where p.auth_user_id = auth.uid()
        and p.is_active
        and not coalesce(p.must_change_password, false)
      limit 1),
    false
  )
$$;

revoke all on function app_private.senha_pendente() from public, anon, authenticated;
