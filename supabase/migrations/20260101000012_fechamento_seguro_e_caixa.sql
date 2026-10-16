-- =============================================================================
-- 0012 — Fechamento seguro da conta e estado do caixa sem vazar valores
--
-- Achado de auditoria (16/10/2026, revisão estática do código publicado):
-- `close_table_account` calculava os pedidos ainda em andamento e gravava esse
-- número na auditoria, mas **não impedia** o fechamento. Dava para liberar a
-- mesa com um pedido em `preparing` ou `ready` — e aí a confirmação de entrega
-- (`SESSION_NOT_OPEN` / `ORDER_ACCOUNT_CLOSED`) ficava impossível: pedido preso,
-- cozinha produzindo para uma mesa que o sistema já liberou.
--
-- O que esta migração muda (e o que continua igual):
--
--   1. Fechamento NORMAL (admin, caixa, garçom) passa a exigir que não haja
--      pedido aguardando ação: `received`, `confirmed`, `preparing`, `ready` ou
--      `out_for_delivery` bloqueiam com o código ORDERS_IN_PROGRESS. Pedido
--      entregue, cancelado ou já quitado não bloqueia (mas saldo pendente
--      continua bloqueando, como antes).
--   2. Fechamento EXCEPCIONAL (só administrador, com justificativa) assume a
--      decisão sobre os pendentes: eles são **cancelados com a justificativa
--      informada** — com histórico de status e auditoria por pedido — em vez de
--      a sessão ser encerrada deixando pedido impossível de entregar.
--      A justificativa passa a ser exigida sempre que houver pendente ou saldo
--      (antes só no caso de saldo).
--   3. `cash_session_is_open()`: devolve apenas se existe turno de caixa aberto,
--      para quem opera o salão (garçom incluído) saber de antemão se o
--      recebimento está disponível — sem revelar valores, saldos ou movimentos.
--
-- Regras que NÃO mudam: papéis autorizados, cálculo de totais, ordem dos locks,
-- RLS, GRANTs de tabela e a exigência de saldo zero no fechamento normal.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. close_table_account — fecha sem deixar pedido preso
-- -----------------------------------------------------------------------------
create or replace function public.close_table_account(
  p_session_id uuid,
  p_force      boolean default false,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile   public.profiles;
  v_session   public.table_sessions;
  v_pedido    public.orders;
  v_total     integer := 0;
  v_paid      integer := 0;
  v_pendentes integer := 0;
  v_cancelados integer := 0;
  v_reason    text;
  v_balance   integer;
begin
  if p_force then
    -- Fechar com saldo pendente e/ou pedido em andamento continua sendo só do
    -- administrador: é a exceção que fica registrada na auditoria.
    v_profile := app_private.require_role('admin');
  else
    -- 16/10/2026: o garçom fecha a conta quando ela já está quitada.
    v_profile := app_private.require_role('admin', 'manager', 'waiter');
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  -- Justificativa curta não vale: mesma régua do cancelamento de pedido.
  if v_reason is not null and length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED: a justificativa precisa de pelo menos 3 caracteres'
      using errcode = '22023';
  end if;

  -- Lock da sessão: duas requisições simultâneas não fecham a mesma conta.
  select s.* into v_session
  from public.table_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = '22023';
  end if;
  if v_session.status <> 'open' then
    raise exception 'SESSION_NOT_OPEN: este atendimento já foi encerrado' using errcode = '55006';
  end if;

  -- Lock nos pedidos da sessão: nenhum pedido muda de estado durante o fechamento.
  perform 1 from public.orders o
  where o.table_session_id = p_session_id
  for update;

  -- 1º) Quem ainda exige ação da equipe (produção ou pronto aguardando entrega).
  select count(*)::int into v_pendentes
  from public.orders o
  where o.table_session_id = p_session_id
    and o.status in ('received', 'confirmed', 'preparing', 'ready', 'out_for_delivery');

  if v_pendentes > 0 and not coalesce(p_force, false) then
    raise exception 'ORDERS_IN_PROGRESS: ainda há % pedido(s) em andamento neste atendimento — entregue ou cancele antes de fechar a conta',
      v_pendentes using errcode = '55006';
  end if;

  -- 2º) Fechamento excepcional resolve os pendentes ANTES de calcular totais:
  --     o pedido é cancelado com a justificativa do administrador, entra no
  --     histórico de status e fica auditado. Nada fica impossível de entregar.
  if v_pendentes > 0 and coalesce(p_force, false) then
    if v_reason is null then
      raise exception 'REASON_REQUIRED: fechar com pedido em andamento exige justificativa do administrador'
        using errcode = '22023';
    end if;

    for v_pedido in
      select o.* from public.orders o
      where o.table_session_id = p_session_id
        and o.status in ('received', 'confirmed', 'preparing', 'ready', 'out_for_delivery')
      for update
    loop
      -- Mesma regra do cancelamento avulso (advance_order_status): pedido com
      -- dinheiro recebido não é cancelado em silêncio — estorne antes.
      if v_pedido.paid_cents > 0 then
        raise exception 'PAYMENT_REFUND_REQUIRED: o pedido #% tem R$ % recebidos; estorne os recebimentos antes de fechar a conta',
          v_pedido.order_number, to_char(v_pedido.paid_cents::numeric / 100, 'FM999990.00')
          using errcode = '55006';
      end if;

      update public.orders o
         set status        = 'cancelled',
             cancelled_at  = now(),
             cancelled_by  = v_profile.id,
             cancel_reason = v_reason
       where o.id = v_pedido.id;

      insert into public.order_status_history (order_id, from_status, to_status, changed_by, notes)
      values (v_pedido.id, v_pedido.status, 'cancelled', v_profile.id,
              'Cancelado no fechamento excepcional da conta: ' || v_reason);

      perform app_private.log_audit(
        'order.status.cancelled', 'orders', v_pedido.id::text, v_pedido.order_number,
        p_session_id, v_pedido.cash_session_id, v_pedido.total_cents, v_reason,
        jsonb_build_object('from_status', v_pedido.status, 'on_session_close', true, 'forced', true)
      );

      v_cancelados := v_cancelados + 1;
    end loop;
  end if;

  -- 3º) Recalcula os totais oficiais (já sem os pedidos cancelados acima).
  perform app_private.recalc_order_totals(o.id)
  from public.orders o
  where o.table_session_id = p_session_id and o.status <> 'cancelled';

  select
    coalesce(sum(o.total_cents), 0),
    coalesce(sum(o.paid_cents), 0)
  into v_total, v_paid
  from public.orders o
  where o.table_session_id = p_session_id and o.status <> 'cancelled';

  v_balance := v_total - v_paid;

  if v_balance > 0 and not coalesce(p_force, false) then
    raise exception 'BALANCE_PENDING: a conta ainda tem saldo pendente de R$ %',
      to_char(v_balance::numeric / 100, 'FM999990.00') using errcode = '22023';
  end if;
  if v_balance > 0 and v_reason is null then
    raise exception 'REASON_REQUIRED: fechamento com saldo pendente exige justificativa do administrador'
      using errcode = '22023';
  end if;

  update public.orders o
     set account_closed_at = now(),
         closed_by = v_profile.id
   where o.table_session_id = p_session_id
     and o.status <> 'cancelled'
     and o.account_closed_at is null;

  update public.table_sessions s
     set status               = 'closed',
         closed_at            = now(),
         closed_by            = v_profile.id,
         closed_total_cents   = v_total,
         closed_paid_cents    = v_paid,
         closed_with_balance  = v_balance > 0,
         close_reason         = v_reason
   where s.id = v_session.id
  returning * into v_session;

  perform app_private.log_audit(
    'table_account.close', 'table_sessions', v_session.id::text, null, v_session.id,
    v_session.id, v_total, v_reason,
    jsonb_build_object(
      'total_cents', v_total,
      'paid_cents', v_paid,
      'balance_cents', v_balance,
      'forced', coalesce(p_force, false),
      'orders_in_production', v_pendentes,
      'orders_cancelled_on_close', v_cancelados
    )
  );

  return jsonb_build_object(
    'session_id', v_session.id,
    'total_cents', v_total,
    'paid_cents', v_paid,
    'balance_cents', v_balance,
    'closed_with_balance', v_balance > 0,
    'orders_in_production', v_pendentes,
    'orders_cancelled_on_close', v_cancelados,
    'closed_at', v_session.closed_at
  );
end
$$;

-- -----------------------------------------------------------------------------
-- 2. cash_session_is_open — o salão sabe se dá para receber, sem ver a gaveta
-- -----------------------------------------------------------------------------
create or replace function public.cash_session_is_open()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Só quem opera o salão pergunta; visitante anônimo não.
  perform app_private.require_role('admin', 'manager', 'waiter');
  return exists (select 1 from public.cash_sessions c where c.status = 'open');
end
$$;

revoke all on function public.cash_session_is_open() from public, anon;
grant execute on function public.cash_session_is_open() to authenticated, service_role;
