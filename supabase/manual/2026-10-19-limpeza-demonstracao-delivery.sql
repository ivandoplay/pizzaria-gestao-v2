-- =============================================================================
-- Limpeza dos pedidos de DEMONSTRAÇÃO criados em 19/10 para a revisão visual
-- das telas Caixa e Delivery (pedidos #56, #57, #58, sem pagamento).
--
-- Mesmo critério do outro script: não apagar — cancelar com motivo e autoria,
-- preservando itens, horários e histórico. Nada é pago, então ninguém fica
-- devendo nem sobra dinheiro fora do caixa.
-- =============================================================================

begin;

with alvo as (
  select o.id, o.order_number, o.table_session_id, o.cash_session_id, o.total_cents
    from public.orders o
   where o.service_mode = 'delivery'
     and o.status = 'received'
     and o.paid_cents = 0
     and o.account_closed_at is null
     and o.created_at >= '2026-10-19'::date
), admin as (
  select p.id from public.profiles p where p.role = 'admin' and p.is_active order by p.created_at limit 1
)
update public.orders o
   set status = 'cancelled',
       cancelled_at = now(),
       cancelled_by = (select id from admin),
       cancel_reason = 'Pedido de demonstração criado para revisão visual das telas; sem consumo real'
  from alvo
 where o.id = alvo.id;

insert into public.audit_logs (
  actor_profile_id, actor_name, actor_role, action, entity_table, entity_id,
  order_id, table_session_id, cash_session_id, amount_cents, reason, details
)
select (select p.id from public.profiles p where p.role = 'admin' and p.is_active order by p.created_at limit 1),
       'Limpeza de dados de demonstração (SQL controlado)',
       'admin',
       'order.cleanup_cancel',
       'orders',
       o.id::text,
       o.order_number,
       o.table_session_id,
       o.cash_session_id,
       o.total_cents,
       'Pedido de demonstração sem consumo real',
       jsonb_build_object('origem', 'supabase/manual/2026-10-19-limpeza-demonstracao-delivery.sql')
  from public.orders o
 where o.cancel_reason = 'Pedido de demonstração criado para revisão visual das telas; sem consumo real'
   and o.cancelled_at >= now() - interval '5 minutes';

select count(*) as pedidos_de_demonstracao_abertos
  from public.orders
 where service_mode = 'delivery' and status = 'received' and account_closed_at is null;

commit;
