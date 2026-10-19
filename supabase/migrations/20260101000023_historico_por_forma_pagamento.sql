-- =============================================================================
-- 0023 — Histórico filtrável por forma de pagamento
--
-- Seção 5.5 do prompt mestre: a consulta de contas e pedidos anteriores precisa
-- de filtros por data, número do pedido, mesa, modalidade **e forma de
-- pagamento**. Os quatro primeiros já existiam em `get_orders_page`; faltava a
-- forma de pagamento — e o caixa não tinha como responder "quanto entrou em
-- Pix hoje?" olhando a lista.
--
-- O filtro considera pagamentos CONFIRMADOS do pedido (estorno não conta, porque
-- o registro do estorno muda o status do pagamento). Pedido cancelado continua
-- aparecendo quando teve recebimento naquela forma: é histórico, não venda.
--
-- A assinatura ganhou um parâmetro no fim, com valor padrão: chamadas antigas
-- continuam funcionando sem alteração.
--
-- A versão anterior é REMOVIDA antes: `create or replace` não substitui uma
-- função de assinatura diferente, e manter as duas deixaria o Postgres sem
-- saber qual escolher quando a chamada omite o parâmetro novo ("function is
-- not unique"). O bloco de permissões no fim repete o que a migração 0019 fez
-- com todas as funções: criar uma função nova devolve o EXECUTE padrão ao
-- `anon`, e isso é justamente o que a 0019 tirou.
-- =============================================================================

drop function if exists public.get_orders_page(
  timestamptz, timestamptz, text, text, integer, text, integer, integer
);

create or replace function public.get_orders_page(
  p_from       timestamptz,
  p_to         timestamptz,
  p_status     text default null,
  p_service_mode text default null,
  p_table_number integer default null,
  p_search     text default null,     -- nº do pedido, nome ou telefone do cliente
  p_limit      integer default 50,
  p_offset     integer default 0,
  p_method_id  text default null      -- filtra por forma de pagamento já confirmada
)
returns table (
  id                uuid,
  order_number      bigint,
  service_mode      text,
  status            text,
  table_number      integer,
  customer_name     text,
  customer_phone    text,
  total_cents       integer,
  paid_cents        integer,
  balance_cents     integer,
  created_by_name   text,
  created_at        timestamptz,
  account_closed_at timestamptz,
  cancel_reason     text,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_private.require_role('admin', 'manager');

  return query
  with f as (
    select
      o.id, o.order_number, o.service_mode, o.status, t.number as table_number,
      o.customer_name_snapshot as customer_name, o.customer_phone_snapshot as customer_phone,
      o.total_cents, o.paid_cents, o.created_by, o.created_at,
      o.account_closed_at, o.cancel_reason
    from public.orders o
    left join public.table_sessions s on s.id = o.table_session_id
    left join public.restaurant_tables t on t.id = s.table_id
    where o.created_at >= p_from and o.created_at < p_to
      and (p_status is null or o.status = p_status)
      and (p_service_mode is null or o.service_mode = p_service_mode)
      and (p_table_number is null or t.number = p_table_number)
      and (
        p_method_id is null
        or exists (
          select 1 from public.payments pay
           where pay.order_id = o.id
             and pay.status = 'confirmed'
             and pay.method_id = p_method_id
        )
      )
      and (
        p_search is null or btrim(p_search) = ''
        or o.order_number::text = regexp_replace(coalesce(p_search, ''), '\D', '', 'g')
        or o.customer_name_snapshot ilike '%' || btrim(p_search) || '%'
        -- telefone: compara só os dígitos dos dois lados (o caixa digita "988887777")
        or regexp_replace(coalesce(o.customer_phone_snapshot, ''), '\D', '', 'g')
             like '%' || regexp_replace(coalesce(p_search, ''), '\D', '', 'g') || '%'
      )
  )
  select
    f.id, f.order_number, f.service_mode, f.status, f.table_number,
    f.customer_name, f.customer_phone, f.total_cents, f.paid_cents,
    f.total_cents - f.paid_cents, p.full_name, f.created_at,
    f.account_closed_at, f.cancel_reason,
    count(*) over ()::bigint
  from f
  join public.profiles p on p.id = f.created_by
  order by f.created_at desc
  limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end
$$;

revoke all on function public.get_orders_page(
  timestamptz, timestamptz, text, text, integer, text, integer, integer, text
) from public, anon;
grant execute on function public.get_orders_page(
  timestamptz, timestamptz, text, text, integer, text, integer, integer, text
) to authenticated, service_role;
