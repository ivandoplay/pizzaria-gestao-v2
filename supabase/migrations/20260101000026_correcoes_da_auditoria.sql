-- =============================================================================
-- 0026 — Correções da auditoria de 19/10/2026 (achados B3, B7, B8 e B12)
--
-- B3 (P2) — O garçom registra recebimentos na mesa desde a 0011, mas a política
--   de `payments` só permitia leitura para caixa/admin. Resultado: ele recebia,
--   o total da conta ficava certo (vem de `orders.paid_cents`), mas a linha
--   "Recebimentos" do pedido não aparecia e o recibo impresso por ele saía sem
--   as formas de pagamento e sem o troco. A política nova abre SOMENTE os
--   recebimentos de pedidos do salão (`dine_in`); delivery continua restrito ao
--   caixa/administrador, como manda a matriz de permissões.
--
-- B8 (P3) — `create_order` já impede o garçom de abrir pedido de delivery, mas
--   `register_payment` não tinha a mesma checagem: uma chamada direta à API
--   permitia registrar recebimento de delivery com perfil de garçom. A regra
--   entra como gatilho na tabela (vale para qualquer caminho de escrita), sem
--   duplicar o corpo da função de pagamento.
--
-- B7 (P3) — `anon` tinha privilégios de tabela em todas as 25 tabelas e nas 4
--   views (herança dos privilégios padrão do Supabase). A RLS já devolvia zero
--   linhas — conferido em produção —, mas o menor privilégio manda fechar a
--   porta: revogado agora, inclusive para objetos futuros.
--
-- B12 (P3) — quatro funções auxiliares de `app_private` estavam com
--   `search_path` mutável (aviso do advisor do Supabase). Fixado em
--   `public, pg_temp`, como já acontece nas demais funções.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B3 — leitura dos recebimentos do salão pelo garçom
-- -----------------------------------------------------------------------------
drop policy if exists payments_select_waiter on public.payments;
create policy payments_select_waiter on public.payments
  for select to authenticated
  using (
    app_private.has_role(array['waiter'::text])
    and exists (
      select 1
        from public.orders o
       where o.id = payments.order_id
         and o.service_mode = 'dine_in'
    )
  );

comment on policy payments_select_waiter on public.payments is
  'Garçom lê os recebimentos dos pedidos do salão (decisão de 16/10, achado B3 da auditoria de 19/10).';

-- -----------------------------------------------------------------------------
-- B8 — garçom não registra recebimento fora do salão
-- -----------------------------------------------------------------------------
create or replace function app_private.guard_payment_by_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_mode    text;
begin
  -- Sem perfil (migração, backfill, service_role) não há o que restringir.
  v_profile := app_private.current_profile();
  if v_profile.id is null or v_profile.role <> 'waiter' then
    return new;
  end if;

  select o.service_mode into v_mode from public.orders o where o.id = new.order_id;
  if v_mode is distinct from 'dine_in' then
    raise exception 'FORBIDDEN: o garçom registra recebimentos apenas de pedidos do salão'
      using errcode = '42501';
  end if;

  return new;
end
$$;

comment on function app_private.guard_payment_by_role() is
  'Recusa recebimento de delivery lançado por garçom (achado B8 da auditoria de 19/10).';

revoke all on function app_private.guard_payment_by_role() from public, anon, authenticated;

drop trigger if exists payments_guard_role on public.payments;
create trigger payments_guard_role
  before insert on public.payments
  for each row execute function app_private.guard_payment_by_role();

-- -----------------------------------------------------------------------------
-- B7 — anon sem privilégio em tabelas, views e sequências
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Objetos criados depois desta migração também nascem fechados para anon.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- -----------------------------------------------------------------------------
-- B12 — search_path fixo nos auxiliares
-- -----------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as argumentos
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_private'
       and p.proname in ('set_updated_at', 'jwt_role', 'is_service', 'redact_jsonb')
  loop
    execute format('alter function app_private.%I(%s) set search_path = public, pg_temp',
                   f.proname, f.argumentos);
  end loop;
end
$$;
