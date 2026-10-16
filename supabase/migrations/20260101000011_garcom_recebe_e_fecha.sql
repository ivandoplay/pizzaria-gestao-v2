-- =============================================================================
-- 0011 — O GARÇOM recebe na mesa e fecha a conta
--
-- Pedido do administrador em 16/10/2026: o garçom precisa ver o total de cada
-- conta, receber o pagamento na mesa e fechar a conta. Antes disso, receber e
-- fechar eram exclusivos de caixa e administrador.
--
-- O que muda (só isto):
--   * `register_payment`  — passa a aceitar o perfil `waiter`;
--   * `close_table_account` — passa a aceitar `waiter` no fechamento NORMAL.
--
-- O que NÃO muda:
--   * fechamento FORÇADO (com saldo pendente) continua só do administrador;
--   * estorno de pagamento (`reverse_payment`) e desconto (`set_order_discount`)
--     continuam de caixa/administrador;
--   * `register_payment` continua exigindo CAIXA ABERTO — o recebimento do
--     garçom entra na gaveta do turno em curso, como qualquer outro;
--   * nenhuma política de RLS, nenhum grant e nenhuma tabela foram tocados:
--     quem decide o perfil continua sendo `app_private.require_role`, dentro da
--     própria função.
--
-- Estas duas funções foram recriadas a partir do texto da migração 0007, com
-- apenas a linha de perfil alterada — nada mais foi reescrito.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- register_payment — caixa e administrador (0007) + garçom (0011)
-- -----------------------------------------------------------------------------
create or replace function public.register_payment(
  p_order_id      uuid,
  p_method_id     text,
  p_amount_cents  integer,
  p_tendered_cents integer default null,
  p_is_prepaid    boolean default false,
  p_note          text default null,
  p_client_uuid   uuid default null
)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_order   public.orders;
  v_method  public.payment_methods;
  v_cash    public.cash_sessions;
  v_payment public.payments;
  v_change  integer := 0;
begin
  -- 16/10/2026: o GARÇOM também recebe na mesa (pedido do administrador).
  -- O caixa precisa estar aberto (a regra abaixo não mudou): dinheiro de
  -- recebimento entra na gaveta do turno em curso.
  v_profile := app_private.require_role('admin', 'manager', 'waiter');

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT: informe um valor de pagamento maior que zero' using errcode = '22023';
  end if;

  -- Idempotência: requisição repetida devolve o mesmo recebimento.
  if p_client_uuid is not null then
    select p.* into v_payment from public.payments p where p.client_uuid = p_client_uuid;
    if found then
      return v_payment;
    end if;
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = '22023';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED: pedido cancelado não aceita pagamento' using errcode = '55006';
  end if;
  if v_order.account_closed_at is not null then
    raise exception 'ORDER_ACCOUNT_CLOSED: conta já fechada' using errcode = '55006';
  end if;

  if p_amount_cents > (v_order.total_cents - v_order.paid_cents) then
    raise exception 'AMOUNT_EXCEEDS_BALANCE: o valor informado excede o saldo pendente de R$ %',
      to_char((v_order.total_cents - v_order.paid_cents)::numeric / 100, 'FM999990.00')
      using errcode = '22023';
  end if;

  select m.* into v_method from public.payment_methods m where m.id = p_method_id;
  if not found or not v_method.is_active then
    raise exception 'PAYMENT_METHOD_INVALID: forma de pagamento inativa ou inexistente'
      using errcode = '22023';
  end if;

  -- Recebimentos acontecem dentro de uma sessão de caixa aberta.
  select cs.* into v_cash from public.cash_sessions cs where cs.status = 'open' for update;
  if not found then
    raise exception 'CASH_SESSION_REQUIRED: abra o caixa antes de registrar recebimentos'
      using errcode = '22023';
  end if;

  if v_method.requires_change then
    if p_tendered_cents is null then
      raise exception 'TENDERED_REQUIRED: informe o valor recebido em dinheiro' using errcode = '22023';
    end if;
    if p_tendered_cents < p_amount_cents then
      raise exception 'TENDERED_BELOW_AMOUNT: o valor recebido é menor que o valor do pagamento'
        using errcode = '22023';
    end if;
    v_change := p_tendered_cents - p_amount_cents;
  end if;

  begin
    insert into public.payments (
      order_id, cash_session_id, method_id, amount_cents, tendered_cents,
      change_cents, is_prepaid, note, created_by, client_uuid
    ) values (
      v_order.id, v_cash.id, v_method.id, p_amount_cents, p_tendered_cents,
      case when v_method.requires_change then v_change else 0 end,
      coalesce(p_is_prepaid, false), nullif(btrim(coalesce(p_note, '')), ''),
      v_profile.id, p_client_uuid
    )
    returning * into v_payment;
  exception
    when unique_violation then
      -- Clique duplo / reenvio simultâneo: devolve o MESMO recebimento.
      if p_client_uuid is not null then
        select p.* into v_payment from public.payments p where p.client_uuid = p_client_uuid;
        if found then
          return v_payment;
        end if;
      end if;
      raise;
  end;

  -- Dinheiro físico entra na gaveta (valor líquido; troco não é receita).
  if v_method.affects_cash_drawer then
    insert into public.cash_movements (
      cash_session_id, kind, category, source, amount_cents, description, order_id, payment_id,
      created_by, client_uuid
    ) values (
      v_cash.id, 'in', 'sale', 'automatic', p_amount_cents,
      'Recebimento em dinheiro do pedido #' || v_order.order_number,
      v_order.id, v_payment.id, v_profile.id, p_client_uuid
    );
  end if;

  perform app_private.recalc_order_totals(v_order.id);

  perform app_private.log_audit(
    'payment.register', 'payments', v_payment.id::text, v_order.order_number,
    v_order.table_session_id, v_cash.id, p_amount_cents, null,
    jsonb_build_object(
      'method', v_method.id,
      'tendered_cents', p_tendered_cents,
      'change_cents', case when v_method.requires_change then v_change else 0 end,
      'prepaid', coalesce(p_is_prepaid, false)
    )
  );

  return v_payment;
end
$$;

-- -----------------------------------------------------------------------------
-- close_table_account — fechamento normal também pelo garçom (0011)
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
  v_profile public.profiles;
  v_session public.table_sessions;
  v_total   integer := 0;
  v_paid    integer := 0;
  v_open    integer := 0;
  v_reason  text;
  v_balance integer;
begin
  if p_force then
    -- Fechar com saldo pendente continua sendo só do administrador: é a
    -- exceção que fica registrada na auditoria.
    v_profile := app_private.require_role('admin');
  else
    -- 16/10/2026: o garçom fecha a conta quando ela já está quitada.
    v_profile := app_private.require_role('admin', 'manager', 'waiter');
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

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

  -- Lock nos pedidos da sessão e recálculo oficial dos totais.
  perform 1 from public.orders o
  where o.table_session_id = p_session_id
  for update;

  perform app_private.recalc_order_totals(o.id)
  from public.orders o
  where o.table_session_id = p_session_id and o.status <> 'cancelled';

  select
    coalesce(sum(o.total_cents), 0),
    coalesce(sum(o.paid_cents), 0),
    count(*) filter (where o.status in ('received', 'confirmed', 'preparing', 'ready'))::int
  into v_total, v_paid, v_open
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
      'orders_in_production', v_open
    )
  );

  return jsonb_build_object(
    'session_id', v_session.id,
    'total_cents', v_total,
    'paid_cents', v_paid,
    'balance_cents', v_balance,
    'closed_with_balance', v_balance > 0,
    'orders_in_production', v_open,
    'closed_at', v_session.closed_at
  );
end
$$;
