-- =============================================================================
-- SHIM DE AMBIENTE LOCAL — NÃO aplicar no Supabase.
--
-- Este arquivo recria, em um PostgreSQL comum, os elementos que o Supabase já
-- fornece prontos, para permitir testar as migrações e políticas RLS
-- localmente:
--   * roles anon / authenticated / service_role
--   * schema auth + tabela auth.users + funções auth.uid(), auth.role(), auth.jwt()
--   * publicação supabase_realtime
--
-- Uso:
--   psql -v ON_ERROR_STOP=1 -f tools/local_pg_shim.sql
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  last_sign_in_at    timestamptz
);

-- Equivalente local de auth.uid(): lê o claim 'sub' do JWT (request.jwt.claims),
-- igual ao padrão do Supabase.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  -- Cópia fiel da definição do Supabase: o claim vazio ('') passa pelo nullif
  -- ANTES da conversão para jsonb. Sem isso, uma sessão sem claim (ou com claim
  -- vazio, como faz tests.logout()) quebrava com "invalid input syntax for type json"
  -- num ponto onde o Supabase real simplesmente devolveria NULL.
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  )
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- Publicação de realtime (no Supabase já existe; localmente criamos vazia).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

-- Grant default do Supabase para o schema public.
grant usage on schema public to anon, authenticated, service_role;
