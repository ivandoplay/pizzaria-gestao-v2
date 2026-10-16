-- =============================================================================
-- 0010 — Fila de pedidos prontos para o garçom
-- =============================================================================
-- A fila não cria tabela, status nem fluxo novo: é uma visão operacional dos
-- pedidos que JÁ existem. Duas mudanças mínimas, ambas incrementais (a 0006 e a
-- 0007 continuam como foram aplicadas):
--
--   1. `order_overview` passa a expor `ready_at` e `session_status`.
--      A coluna `orders.ready_at` existe desde a 0005 (a RPC de transição grava
--      nela quando o pedido fica pronto) — a view é que não mostrava o campo.
--      Sem ele não há como ordenar a fila pelo tempo de espera real: usar
--      `created_at` faria um pedido criado cedo e pronto tarde aparecer na
--      frente, contando um tempo que não é o da cozinha.
--      `session_status` permite esconder pedidos de atendimento já encerrado.
--
--   2. `advance_order_status` ganha, na entrega à mesa, a conferência do
--      atendimento DENTRO da transação: pedido de sessão encerrada (ou de conta
--      já fechada) é recusado. Sem isso, a mesa poderia ser fechada entre a
--      leitura da tela e a confirmação do garçom, e o pedido seria marcado como
--      entregue numa conta que já foi liberada.
--
-- A ORDEM DOS LOCKS segue a de `close_table_account` (sessão → pedidos). É o que
-- evita impasse: quem fecha a conta trava a sessão primeiro; quem entrega um
-- pedido agora também trava a sessão antes do pedido. Os dois nunca ficam
-- esperando um pelo outro em ordem invertida.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. VIEW: ready_at e session_status
-- -----------------------------------------------------------------------------
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
  o.total_cents - o.paid_cents   as balance_cents,
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
  'Pedidos com mesa/cliente e saldo pendente. Herda a RLS de orders (garçom vê apenas salão). Traz ready_at (quando o pedido ficou pronto) e session_status (situação do atendimento) para a fila de pedidos prontos.';

-- O DROP VIEW levou embora os privilégios dados na 0006: eles voltam aqui.
grant select on public.order_overview to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. RPC: entrega à mesa confere o atendimento
-- -----------------------------------------------------------------------------
create or replace function public.advance_order_status(
  p_order_id uuid,
  p_to_status text,
  p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile          public.profiles;
  v_order            public.orders;
  v_session          public.table_sessions;
  v_session_id       uuid;
  v_prev             record;
  v_conferiu_sessao  boolean := false;
  v_from             text;
  v_allowed          boolean := false;
begin
  if p_to_status = 'delivered_to_table' then
    v_profile := app_private.require_role('admin', 'manager', 'waiter');
  else
    v_profile := app_private.require_role('admin', 'manager');
  end if;

  -- ---------------------------------------------------------------------------
  -- Entrega à mesa: confere o atendimento DENTRO da transação.
  --
  -- A leitura abaixo é sem lock e serve só para decidir se vale travar a sessão
  -- já aqui (é o caminho normal: pedido pronto de salão). Ela não decide nada
  -- sozinha — quem decide é a validação da transição, feita depois, com o
  -- pedido travado.
  --
  -- Por que não conferir a sessão em TODOS os casos, sempre no começo: um
  -- pedido de delivery não tem atendimento de mesa, e a recusa correta dele é
  -- "mudança de situação não permitida", não "sem atendimento". A checagem
  -- ainda acontece (mais abaixo) em qualquer tentativa real de entrega, então
  -- nenhuma entrega passa sem a sessão conferida.
  -- ---------------------------------------------------------------------------
  if p_to_status = 'delivered_to_table' then
    select o.status, o.service_mode, o.table_session_id into v_prev
      from public.orders o where o.id = p_order_id;

    if found and v_prev.service_mode = 'dine_in' and v_prev.status = 'ready' then
      if v_prev.table_session_id is null then
        raise exception 'SESSION_NOT_OPEN: este pedido não está vinculado a um atendimento de mesa'
          using errcode = '55006';
      end if;

      select s.* into v_session
      from public.table_sessions s
      where s.id = v_prev.table_session_id
      for update;

      if not found then
        raise exception 'SESSION_NOT_OPEN: atendimento não encontrado'
          using errcode = '55006';
      end if;

      if v_session.status <> 'open' then
        raise exception 'SESSION_NOT_OPEN: o atendimento desta mesa já foi encerrado'
          using errcode = '55006';
      end if;

      v_conferiu_sessao := true;
    end if;
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = '22023';
  end if;

  v_from := v_order.status;

  if v_from = p_to_status then
    raise exception 'NO_STATUS_CHANGE: o pedido já está em "%"', p_to_status using errcode = '22023';
  end if;

  v_allowed := case
    when v_from = 'received'  and p_to_status in ('confirmed', 'preparing', 'cancelled') then true
    when v_from = 'confirmed' and p_to_status in ('preparing', 'cancelled') then true
    when v_from = 'preparing' and p_to_status in ('ready', 'cancelled') then true
    when v_from = 'ready' and p_to_status = 'cancelled' then true
    when v_from = 'ready' and p_to_status = 'delivered_to_table' and v_order.service_mode = 'dine_in' then true
    when v_from = 'ready' and p_to_status = 'out_for_delivery' and v_order.service_mode = 'delivery' then true
    when v_from = 'out_for_delivery' and p_to_status in ('delivered', 'cancelled') then true
    else false
  end;

  if not v_allowed then
    raise exception 'INVALID_TRANSITION: não é possível mudar de "%" para "%" (modalidade %)',
      v_from, p_to_status, v_order.service_mode using errcode = '22023';
  end if;

  -- Cancelamento exige justificativa registrada (auditoria da venda).
  if p_to_status = 'cancelled'
     and length(btrim(coalesce(p_notes, ''))) < 3 then
    raise exception 'REASON_REQUIRED: informe o motivo do cancelamento'
      using errcode = '22023';
  end if;

  if p_to_status = 'delivered_to_table' and v_profile.role = 'waiter'
     and v_order.service_mode <> 'dine_in' then
    raise exception 'FORBIDDEN: entrega à mesa só se aplica a pedidos de salão' using errcode = '42501';
  end if;

  -- Se a leitura inicial não pôde conferir a sessão (o pedido ainda não estava
  -- pronto) e agora a transição passou pela matriz, confere aqui — nenhuma
  -- entrega segue sem a sessão conferida. Neste caminho raro a ordem dos locks
  -- é a inversa (pedido → sessão): um impasse eventual é resolvido pelo
  -- PostgreSQL abortando uma das transações, e o operador recebe erro claro.
  if p_to_status = 'delivered_to_table' and not v_conferiu_sessao then
    if v_order.table_session_id is null then
      raise exception 'SESSION_NOT_OPEN: este pedido não está vinculado a um atendimento de mesa'
        using errcode = '55006';
    end if;

    select s.* into v_session
    from public.table_sessions s
    where s.id = v_order.table_session_id
    for update;

    if not found then
      raise exception 'SESSION_NOT_OPEN: atendimento não encontrado' using errcode = '55006';
    end if;

    if v_session.status <> 'open' then
      raise exception 'SESSION_NOT_OPEN: o atendimento desta mesa já foi encerrado'
        using errcode = '55006';
    end if;
  end if;

  -- Conta encerrada: cinto e suspensório em cima da checagem de sessão.
  if p_to_status = 'delivered_to_table' and v_order.account_closed_at is not null then
    raise exception 'ORDER_ACCOUNT_CLOSED: a conta desta mesa já foi fechada' using errcode = '55006';
  end if;

  if p_to_status = 'cancelled' and v_order.paid_cents > 0 then
    raise exception 'PAYMENT_REFUND_REQUIRED: este pedido tem R$ % recebidos; estorne os pagamentos antes de cancelar',
      to_char(v_order.paid_cents::numeric / 100, 'FM999990.00') using errcode = '55006';
  end if;

  update public.orders o
     set status       = p_to_status,
         cancelled_at = case when p_to_status = 'cancelled' then now() else o.cancelled_at end,
         cancelled_by = case when p_to_status = 'cancelled' then v_profile.id else o.cancelled_by end,
         cancel_reason = case when p_to_status = 'cancelled'
                              then coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Cancelado pelo operador')
                              else o.cancel_reason end,
         confirmed_at = case when p_to_status = 'confirmed' then now() else o.confirmed_at end,
         preparing_at = case when p_to_status = 'preparing' then now() else o.preparing_at end,
         ready_at     = case when p_to_status = 'ready' then now() else o.ready_at end,
         delivered_at = case when p_to_status in ('delivered_to_table', 'delivered') then now() else o.delivered_at end
   where o.id = v_order.id
  returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, notes)
  values (v_order.id, v_from, p_to_status, v_profile.id,
          nullif(btrim(coalesce(p_notes, '')), ''));

  perform app_private.log_audit(
    'order.status.' || p_to_status, 'orders', v_order.id::text, v_order.order_number,
    v_order.table_session_id, v_order.cash_session_id, v_order.total_cents,
    nullif(btrim(coalesce(p_notes, '')), ''),
    jsonb_build_object('from', v_from, 'to', p_to_status)
  );

  return v_order;
end
$$;

comment on function public.advance_order_status(uuid, text, text) is
  'Avança a situação do pedido. Garçom só entrega pedido de salão já pronto, em atendimento aberto; as demais transições são do caixa/admin.';
