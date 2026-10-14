-- =============================================================================
-- 0001 — FUNDAÇÃO: perfis, configurações do negócio, auditoria e helpers
-- Sistema de Gestão para Pizzaria — Supabase PostgreSQL
--
-- Convenções:
--   * Valores monetários SEMPRE em centavos (integer) — nunca float.
--   * Fonte oficial dos dados: PostgreSQL (Supabase). Nada de estado em browser.
--   * Toda autorização é verificada no banco (RLS) e/ou em funções SECURITY
--     DEFINER que checam o perfil do usuário autenticado (ver app_private.*).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema interno de helpers. NÃO deve ser exposto por APIs públicas de escrita;
-- apenas funções de leitura/checagem do próprio usuário ficam aqui.
-- -----------------------------------------------------------------------------
create schema if not exists app_private;
comment on schema app_private is
  'Helpers internos de autorização e regras. Funções aqui NÃO substituem RLS; são usadas por políticas e RPCs.';

-- -----------------------------------------------------------------------------
-- PROFILES — vínculo entre Supabase Auth e o funcionário do sistema.
-- Funções: admin (administrador), manager (caixa), waiter (garçom).
-- Nenhum cadastro público: usuários auth são criados pelo admin (Edge Function)
-- e nascem SEMPRE inativos (is_active=false) até o admin ativá-los.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid not null unique references auth.users (id) on delete restrict,
  full_name       text not null check (length(btrim(full_name)) >= 2),
  login           text not null unique check (login ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  role            text not null check (role in ('admin', 'manager', 'waiter')),
  is_active       boolean not null default false,
  phone           text,
  must_change_password boolean not null default false,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id) on delete set null
);

comment on table public.profiles is
  'Funcionários do sistema. role: admin=administrador, manager=caixa, waiter=garçom.';

create index if not exists profiles_role_active_idx on public.profiles (role) where is_active;

-- -----------------------------------------------------------------------------
-- Utilitários genéricos
-- -----------------------------------------------------------------------------
create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- BUSINESS_SETTINGS — linha única (singleton) com configurações da pizzaria.
-- -----------------------------------------------------------------------------
create table if not exists public.business_settings (
  id                              boolean primary key default true check (id),
  trade_name                      text not null default 'Minha Pizzaria',
  legal_name                      text,
  phone                           text,
  address_line                    text,
  logo_url                        text,
  timezone                        text not null default 'America/Fortaleza',
  pix_key                         text,
  accept_delivery                 boolean not null default true,
  accept_dine_in                  boolean not null default true,
  default_delivery_fee_cents      integer not null default 0 check (default_delivery_fee_cents >= 0),
  min_delivery_order_cents        integer not null default 0 check (min_delivery_order_cents >= 0),
  -- Regra de preço da pizza meio a meio: 'highest' = sabor mais caro, 'average' = média.
  half_and_half_price_rule        text not null default 'highest'
                                  check (half_and_half_price_rule in ('highest', 'average')),
  -- Limites de desconto (% sobre subtotal dos itens).
  -- manager não pode passar de max_discount_pct_without_auth;
  -- admin pode ir até max_discount_pct_hard (com registro de auditoria).
  max_discount_pct_without_auth   numeric(5, 2) not null default 10
                                  check (max_discount_pct_without_auth between 0 and 100),
  max_discount_pct_hard           numeric(5, 2) not null default 20
                                  check (max_discount_pct_hard between 0 and 100),
  -- Divergência de caixa tolerada sem justificativa (em centavos).
  cash_variance_tolerance_cents   integer not null default 0 check (cash_variance_tolerance_cents >= 0),
  split_payment_enabled           boolean not null default true,
  receipt_footer_text             text,
  updated_at                      timestamptz not null default now(),
  updated_by                      uuid references public.profiles (id) on delete set null,
  constraint business_settings_discount_order
    check (max_discount_pct_without_auth <= max_discount_pct_hard)
);

comment on table public.business_settings is
  'Configurações da operação (singleton). Alterações são auditadas.';

insert into public.business_settings (id) values (true) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- BUSINESS_HOURS — horários de atendimento por dia da semana (0=domingo).
-- -----------------------------------------------------------------------------
create table if not exists public.business_hours (
  id          uuid primary key default gen_random_uuid(),
  weekday     smallint not null unique check (weekday between 0 and 6),
  is_open     boolean not null default false,
  opens_at    time,
  closes_at   time,
  updated_at  timestamptz not null default now(),
  constraint business_hours_times_required
    check (is_open = false or (opens_at is not null and closes_at is not null))
);

insert into public.business_hours (weekday)
select g from generate_series(0, 6) g
on conflict (weekday) do nothing;

-- -----------------------------------------------------------------------------
-- PAYMENT_METHODS — formas de pagamento configuráveis.
--   affects_cash_drawer: true somente para dinheiro (entra na gaveta).
--   requires_change: obriga informar valor recebido e calcular troco.
--   allows_prepaid: permite registrar pagamento antecipado (delivery).
-- -----------------------------------------------------------------------------
create table if not exists public.payment_methods (
  id                    text primary key check (id ~ '^[a-z][a-z0-9_]{1,29}$'),
  label                 text not null,
  kind                  text not null check (kind in ('cash', 'pix', 'debit_card', 'credit_card', 'other')),
  affects_cash_drawer   boolean not null default false,
  requires_change       boolean not null default false,
  allows_prepaid        boolean not null default false,
  is_active             boolean not null default true,
  is_default            boolean not null default false,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Somente métodos de dinheiro podem afetar a gaveta / exigir troco.
  constraint payment_methods_cash_consistency
    check ((kind = 'cash') = affects_cash_drawer),
  constraint payment_methods_change_only_cash
    check (not requires_change or kind = 'cash')
);

-- No máximo uma forma de pagamento padrão.
create unique index if not exists payment_methods_single_default_idx
  on public.payment_methods ((is_default)) where is_default;

insert into public.payment_methods (id, label, kind, affects_cash_drawer, requires_change, allows_prepaid, sort_order, is_default)
values
  ('cash',        'Dinheiro',           'cash',        true,  true,  false, 10, true),
  ('pix',         'Pix',                'pix',         false, false, true,  20, false),
  ('debit_card',  'Cartão de débito',   'debit_card',  false, false, true,  30, false),
  ('credit_card', 'Cartão de crédito',  'credit_card', false, false, true,  40, false),
  ('other',       'Outro',              'other',       false, false, false, 90, false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- AUDIT_LOGS — trilha de auditoria (append-only para usuários comuns).
-- Não armazena senhas, tokens ou chaves.
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id                bigint generated by default as identity primary key,
  occurred_at       timestamptz not null default now(),
  actor_profile_id  uuid references public.profiles (id) on delete set null,
  actor_name        text,
  actor_role        text,
  action            text not null,
  entity_table      text not null,
  entity_id         text,
  -- Referências "soltas" (sem FK) para não acoplar a auditoria ao ciclo de vida
  -- das entidades — a auditoria deve sobreviver a qualquer operação.
  order_id          bigint,
  table_session_id  uuid,
  cash_session_id   uuid,
  amount_cents      integer,
  reason            text,
  details           jsonb not null default '{}'::jsonb,
  check (jsonb_typeof(details) = 'object')
);

create index if not exists audit_logs_occurred_idx on public.audit_logs (occurred_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_table, occurred_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_profile_id, occurred_at desc);
create index if not exists audit_logs_order_idx on public.audit_logs (order_id) where order_id is not null;

-- -----------------------------------------------------------------------------
-- HELPERS DE AUTORIZAÇÃO
-- Todos usam auth.uid() (Supabase Auth). Retornam apenas dados do próprio
-- usuário ou booleanos — seguros para uso em políticas RLS.
-- -----------------------------------------------------------------------------

-- Papel do JWT/conexão: 'anon', 'authenticated' ou 'service_role'.
create or replace function app_private.jwt_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_user
  )
$$;

create or replace function app_private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.is_active
  limit 1
$$;

-- Perfil completo do usuário autenticado (NULL se inexistente/inativo).
create or replace function app_private.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.*
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.is_active
  limit 1
$$;

create or replace function app_private.is_service()
returns boolean
language sql
stable
as $$
  select app_private.jwt_role() = 'service_role'
$$;

-- Usuário autenticado com perfil ativo (qualquer função).
create or replace function app_private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app_private.current_profile_id() is not null
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
      where p.auth_user_id = auth.uid() and p.is_active limit 1),
    false
  )
$$;

-- admin OU caixa
create or replace function app_private.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role in ('admin', 'manager') from public.profiles p
      where p.auth_user_id = auth.uid() and p.is_active limit 1),
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
      where p.auth_user_id = auth.uid() and p.is_active limit 1),
    false
  )
$$;

-- Exige um dos perfis; lança 42501 (permission denied) caso contrário.
-- Usada no início de TODA função RPC de negócio.
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

  if not (v_profile.role = any (p_roles)) then
    raise exception 'FORBIDDEN: perfil % não autorizado nesta operação (requer: %)',
      v_profile.role, array_to_string(p_roles, ', ') using errcode = '42501';
  end if;

  return v_profile;
end
$$;

-- -----------------------------------------------------------------------------
-- REDAÇÃO DE DADOS SENSÍVEIS NA AUDITORIA (seção 11.4)
-- Remove recursivamente qualquer chave relacionada a credenciais antes de
-- gravar em audit_logs. Nenhum valor sensível é persistido na trilha.
-- -----------------------------------------------------------------------------
create or replace function app_private.redact_jsonb(p_value jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_key    text;
  v_result jsonb;
begin
  if p_value is null then
    return null;
  end if;

  case jsonb_typeof(p_value)
    when 'object' then
      v_result := '{}'::jsonb;
      for v_key in select jsonb_object_keys(p_value) loop
        if v_key ~* '(password|senha|token|secret|segredo|authorization|api[_-]?key|service[_-]?role|credential)' then
          continue;  -- a chave e o valor não são registrados
        end if;
        v_result := v_result
          || jsonb_build_object(v_key, app_private.redact_jsonb(p_value -> v_key));
      end loop;
      return v_result;
    when 'array' then
      select coalesce(jsonb_agg(app_private.redact_jsonb(elem)), '[]'::jsonb)
        into v_result
        from jsonb_array_elements(p_value) elem;
      return v_result;
    else
      return p_value;
  end case;
end
$$;

-- -----------------------------------------------------------------------------
-- AUDITORIA: gravador genérico via trigger
-- -----------------------------------------------------------------------------
create or replace function app_private.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_entity_id text;
  v_details jsonb;
begin
  -- Ignora updates que só mexeram em updated_at (ruído).
  if tg_op = 'UPDATE' and (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then
    return new;
  end if;

  v_profile := app_private.current_profile();

  v_entity_id := coalesce(
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
    '?'
  );

  v_details := app_private.redact_jsonb(case tg_op
    when 'INSERT' then jsonb_build_object('new', to_jsonb(new))
    when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
    else jsonb_build_object('old', to_jsonb(old))
  end);

  insert into public.audit_logs (
    actor_profile_id, actor_name, actor_role, action,
    entity_table, entity_id, details
  ) values (
    v_profile.id,
    coalesce(v_profile.full_name, app_private.jwt_role() || ' (sem perfil)'),
    v_profile.role,
    lower(tg_table_name) || '.' || lower(tg_op),
    tg_table_name,
    v_entity_id,
    v_details
  );

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

-- Gravador explícito de auditoria para RPCs de negócio.
-- SECURITY DEFINER: registra mesmo que o usuário não tenha acesso a audit_logs.
create or replace function app_private.log_audit(
  p_action        text,
  p_entity_table  text,
  p_entity_id     text default null,
  p_order_id      bigint default null,
  p_session_id    uuid default null,
  p_cash_session  uuid default null,
  p_amount_cents  integer default null,
  p_reason        text default null,
  p_details       jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
begin
  v_profile := app_private.current_profile();

  insert into public.audit_logs (
    actor_profile_id, actor_name, actor_role, action, entity_table, entity_id,
    order_id, table_session_id, cash_session_id, amount_cents, reason, details
  ) values (
    v_profile.id,
    coalesce(v_profile.full_name, app_private.jwt_role() || ' (sem perfil)'),
    v_profile.role,
    p_action,
    p_entity_table,
    p_entity_id,
    p_order_id,
    p_session_id,
    p_cash_session,
    p_amount_cents,
    p_reason,
    app_private.redact_jsonb(coalesce(p_details, '{}'::jsonb))
  );
end
$$;

-- -----------------------------------------------------------------------------
-- CRIAÇÃO DE USUÁRIO (Supabase Auth -> profiles)
-- O trigger roda com destino a auth.users; o perfil nasce INATIVO.
-- O admin ativa depois (RPC/Edge Function). Assim, criar um usuário no Auth
-- por qualquer caminho não concede acesso operacional automaticamente.
-- -----------------------------------------------------------------------------
create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_login text;
  v_name  text;
  v_role  text;
  v_actor public.profiles;
begin
  v_name := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'usuario'), '@', 1));
  v_login := lower(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'login'), ''), split_part(coalesce(new.email, 'usuario'), '@', 1)));
  v_login := regexp_replace(v_login, '[^a-z0-9._-]', '', 'g');
  if v_login !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then
    v_login := 'user' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  if exists (select 1 from public.profiles where login = v_login) then
    v_login := substr(v_login, 1, 30) || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  v_role := new.raw_user_meta_data ->> 'role';
  if v_role is null or v_role not in ('admin', 'manager', 'waiter') then
    v_role := 'waiter';
  end if;

  -- Quem está executando a criação (admin autenticado), se houver.
  v_actor := app_private.current_profile();

  insert into public.profiles (auth_user_id, full_name, login, role, is_active, created_by)
  values (new.id, v_name, v_login, v_role, false, v_actor.id)
  on conflict (auth_user_id) do nothing;

  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- TRIGGERS: updated_at e auditoria das tabelas de configuração
-- -----------------------------------------------------------------------------
drop trigger if exists set_updated_at_profiles on public.profiles;
create trigger set_updated_at_profiles
  before update on public.profiles
  for each row execute function app_private.set_updated_at();

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function app_private.audit_trigger();

drop trigger if exists set_updated_at_business_settings on public.business_settings;
create trigger set_updated_at_business_settings
  before update on public.business_settings
  for each row execute function app_private.set_updated_at();

drop trigger if exists audit_business_settings on public.business_settings;
create trigger audit_business_settings
  after insert or update or delete on public.business_settings
  for each row execute function app_private.audit_trigger();

drop trigger if exists set_updated_at_business_hours on public.business_hours;
create trigger set_updated_at_business_hours
  before update on public.business_hours
  for each row execute function app_private.set_updated_at();

drop trigger if exists audit_business_hours on public.business_hours;
create trigger audit_business_hours
  after insert or update or delete on public.business_hours
  for each row execute function app_private.audit_trigger();

drop trigger if exists set_updated_at_payment_methods on public.payment_methods;
create trigger set_updated_at_payment_methods
  before update on public.payment_methods
  for each row execute function app_private.set_updated_at();

drop trigger if exists audit_payment_methods on public.payment_methods;
create trigger audit_payment_methods
  after insert or update or delete on public.payment_methods
  for each row execute function app_private.audit_trigger();
