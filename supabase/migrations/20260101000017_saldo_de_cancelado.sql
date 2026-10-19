-- =============================================================================
-- 0017 — Pedido cancelado não tem saldo a receber
--
-- Achado de auditoria A9: `order_overview` calculava `balance_cents` para todo
-- pedido, inclusive cancelado, e a consulta “contas em aberto” filtrava apenas
-- `account_closed_at is null`. O painel somava pedidos cancelados (R$ 55,50
-- exibidos contra R$ 35,00 reais) e contava “3 contas em aberto” onde havia 1.
--
-- Correção em duas camadas:
--   1. esta visão devolve saldo 0 para pedido cancelado (ninguém deve nada num
--      pedido que não existe mais comercialmente);
--   2. o cliente passou a excluir cancelados de `openOnly` (src/lib/api.ts).
--
-- `table_overview` já excluía cancelados — nada muda lá. As colunas `ready_at`
-- e `session_status` (migração 0010) continuam na visão.
-- =============================================================================

drop view if exists public.order_overview;
create view public.order_overview
with (security_invoker = true) as
select
  o.id,
  o.order_number,
  o.service_mode,
  o.status,
  o.table_session_id,
  s.table_id,
  t.number                       as table_number,
  o.customer_id,
  o.customer_name_snapshot,
  o.customer_phone_snapshot,
  o.delivery_neighborhood,
  o.delivery_fee_cents,
  o.delivery_notes,
  o.subtotal_cents,
  o.discount_cents,
  o.discount_pct,
  o.total_cents,
  o.paid_cents,
  case when o.status = 'cancelled' then 0
       else greatest(o.total_cents - o.paid_cents, 0) end
                                 as balance_cents,
  o.change_given_cents,
  o.status = 'cancelled'         as is_cancelled,
  o.cancel_reason,
  o.notes,
  o.created_by,
  creator.full_name              as created_by_name,
  s.status                       as session_status,
  o.ready_at,
  o.created_at,
  o.account_closed_at,
  o.cash_session_id
from public.orders o
left join public.table_sessions s on s.id = o.table_session_id
left join public.restaurant_tables t on t.id = s.table_id
left join public.profiles creator on creator.id = o.created_by;

comment on view public.order_overview is
  'Pedidos com mesa/cliente e saldo pendente (cancelado = 0). Herda a RLS de orders (garçom vê apenas salão). Traz ready_at e session_status para a fila de pedidos prontos.';

-- O DROP VIEW leva embora os privilégios: eles voltam aqui.
grant select on public.order_overview to anon, authenticated, service_role;
