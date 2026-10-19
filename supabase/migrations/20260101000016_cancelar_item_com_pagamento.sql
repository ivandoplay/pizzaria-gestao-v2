-- =============================================================================
-- 0016 — Cancelar item com valor já recebido devolve erro de negócio
--
-- Achado de auditoria A8: cancelar (ou reduzir) item de pedido com pagamento
-- parcial deixava o trigger de recálculo violar `orders_paid_within_total` e o
-- operador recebia “new row for relation orders violates check constraint”.
--
-- Agora a própria função calcula o novo total e recusa com
-- PAYMENT_REFUND_REQUIRED + valores, antes de gravar qualquer coisa.
-- O corpo é o da migração 0007 com o bloco de verificação inserido antes do
-- UPDATE do item.
-- =============================================================================

create or replace function public.cancel_order_item(
  p_item_id uuid,
  p_reason  text,
  p_quantity integer default null
)
returns public.order_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_item    public.order_items;
  v_order   public.orders;
  v_reason  text;
  v_qty     integer;
  v_removido integer;
  v_novo_subtotal integer;
  v_novo_desconto integer;
  v_novo_total integer;
begin
  v_profile := app_private.require_role('admin', 'manager');

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED: informe o motivo do cancelamento' using errcode = '22023';
  end if;

  select oi.* into v_item from public.order_items oi where oi.id = p_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = v_item.order_id for update;

  if v_item.is_cancelled then
    raise exception 'ITEM_ALREADY_CANCELLED' using errcode = '22023';
  end if;
  if v_order.account_closed_at is not null then
    raise exception 'ORDER_ACCOUNT_CLOSED: conta fechada; ajustes exigem procedimento administrativo'
      using errcode = '55006';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED' using errcode = '55006';
  end if;

  v_qty := coalesce(p_quantity, v_item.quantity);
  if v_qty < 1 or v_qty > v_item.quantity then
    raise exception 'INVALID_QUANTITY: quantidade a cancelar inválida' using errcode = '22023';
  end if;

  -- Cancelar item reduz o total. Se o pedido já recebeu mais do que o novo
  -- total, a operação precisa ser recusada ANTES de o trigger de recálculo
  -- violar `orders_paid_within_total` e devolver um erro cru (achado A8).
  v_removido := case
    when v_qty = v_item.quantity then v_item.total_cents
    else v_qty * v_item.unit_price_cents
  end;
  v_novo_subtotal := greatest(v_order.subtotal_cents - v_removido, 0);
  v_novo_desconto := least(coalesce(v_order.discount_cents, 0), v_novo_subtotal);
  v_novo_total := greatest(v_novo_subtotal - v_novo_desconto, 0) + coalesce(v_order.delivery_fee_cents, 0);

  if v_order.paid_cents > v_novo_total then
    raise exception
      'PAYMENT_REFUND_REQUIRED: este pedido tem R$ % recebidos e o novo total seria R$ %; estorne o excedente antes de cancelar o item',
      to_char(v_order.paid_cents::numeric / 100, 'FM999990.00'),
      to_char(v_novo_total::numeric / 100, 'FM999990.00')
      using errcode = '55006';
  end if;

  if v_qty = v_item.quantity then
    update public.order_items oi
       set is_cancelled  = true,
           cancelled_at  = now(),
           cancelled_by  = v_profile.id,
           cancel_reason = v_reason
     where oi.id = v_item.id
    returning * into v_item;
  else
    update public.order_items oi
       set quantity             = oi.quantity - v_qty,
           total_cents          = oi.unit_price_cents * (oi.quantity - v_qty),
           modifiers_total_cents = oi.modifiers_unit_cents * (oi.quantity - v_qty)
     where oi.id = v_item.id
    returning * into v_item;
  end if;

  perform app_private.log_audit(
    'order_item.cancel', 'order_items', v_item.id::text, v_order.order_number,
    v_order.table_session_id, v_order.cash_session_id, v_qty * v_item.unit_price_cents,
    v_reason, jsonb_build_object('quantity_cancelled', v_qty, 'product', v_item.product_name)
  );

  return v_item;
end
$$;
