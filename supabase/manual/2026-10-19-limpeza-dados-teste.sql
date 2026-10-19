-- =============================================================================
-- Limpeza de dados de teste em produção — 19/10/2026
--
-- Contexto: os primeiros robôs de aceitação (16/10, madrugada) abriram contas e
-- fecharam mesas ANTES de existir a regra de fechamento seguro (migração 0012).
-- Resultado: nove pedidos ficaram com `account_closed_at` preenchido e
-- `paid_cents < total_cents` — R$ 121,00 de "pendente" que nunca existiu,
-- aparecendo no painel e nos relatórios.
--
-- Por que cancelar (e não apagar): a regra do projeto é não excluir entidade com
-- histórico. Cancelar preserva itens, status, horário e autoria; a visão
-- `order_overview` já devolve saldo 0 para cancelado (migração 0017) e os
-- relatórios deixam de contar o valor como pendente.
--
-- Critério estrito (para não tocar em nada legítimo):
--   * status <> 'cancelled'
--   * account_closed_at is not null
--   * paid_cents < total_cents
--   * criado em 16/10/2026 (antes da migração 0012, aplicada no fim daquele dia)
--   * nenhum pagamento registrado (paid_cents = 0)
--
-- Rodar em transação; o SELECT de conferência vem antes e depois.
-- =============================================================================

begin;

-- 1) Fotografia antes
select o.order_number, o.status, o.total_cents, o.paid_cents, o.account_closed_at
  from public.orders o
 where o.status <> 'cancelled'
   and o.account_closed_at is not null
   and o.paid_cents < o.total_cents
   and o.created_at < '2026-10-17'::date
 order by o.order_number;

-- 2) Cancelamento com motivo e autoria do admin
with alvo as (
  select o.id, o.order_number, o.table_session_id, o.cash_session_id, o.total_cents
    from public.orders o
   where o.status <> 'cancelled'
     and o.account_closed_at is not null
     and o.paid_cents < o.total_cents
     and o.created_at < '2026-10-17'::date
     and o.paid_cents = 0
), admin as (
  select p.id from public.profiles p where p.role = 'admin' and p.is_active order by p.created_at limit 1
)
update public.orders o
   set status = 'cancelled',
       cancelled_at = now(),
       cancelled_by = (select id from admin),
       cancel_reason = 'Baixa de dados de teste anteriores à regra de fechamento seguro (migração 0012)'
  from alvo
 where o.id = alvo.id;

-- 3) Trilha de auditoria explícita (o trigger de tabela continua valendo; esta
--    linha explica o motivo operacional para quem ler a auditoria depois)
insert into public.audit_logs (
  actor_profile_id, actor_name, actor_role, action, entity_table, entity_id,
  order_id, table_session_id, cash_session_id, amount_cents, reason, details
)
select (select p.id from public.profiles p where p.role = 'admin' and p.is_active order by p.created_at limit 1),
       'Limpeza de dados de teste (SQL controlado)',
       'admin',
       'order.cleanup_cancel',
       'orders',
       o.id::text,
       o.order_number,
       o.table_session_id,
       o.cash_session_id,
       o.total_cents,
       'Pedido fechado sem pagamento antes da migração 0012',
       jsonb_build_object('origem', 'supabase/manual/2026-10-19-limpeza-dados-teste.sql')
  from public.orders o
 where o.cancel_reason = 'Baixa de dados de teste anteriores à regra de fechamento seguro (migração 0012)'
   and o.cancelled_at >= now() - interval '5 minutes';

-- 4) Fotografia depois: nenhum pedido fechado com saldo deve sobrar
select count(*) as pedidos_fechados_com_saldo
  from public.orders o
 where o.status <> 'cancelled'
   and o.account_closed_at is not null
   and o.paid_cents < o.total_cents;

commit;
