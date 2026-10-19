-- =============================================================================
-- 0015 — Configurações que passam a ter efeito no servidor
--
-- Achados de auditoria A6: dois campos eram editáveis em Configurações e não
-- eram lidos por ninguém.
--
--   * `min_delivery_order_cents` — agora `create_order` recusa pedido de
--     delivery cujo valor dos ITENS (sem a taxa de entrega) fique abaixo do
--     mínimo configurado. Código: DELIVERY_MINIMUM_NOT_MET.
--     O mínimo em 0 (padrão) desliga a exigência — comportamento antigo.
--
--   * `split_payment_enabled` — desligado, o pedido aceita recebimentos em UMA
--     única forma de pagamento (ainda pode haver parcelas na mesma forma).
--     Código: SPLIT_PAYMENT_DISABLED. Ligado (padrão), nada muda.
--
-- O corpo de `create_order` é o da migração 0007 com UM bloco novo, inserido
-- depois do recálculo oficial (antes da auditoria e do retorno).
-- =============================================================================

create or replace function public.create_order(p_payload jsonb, p_client_uuid uuid default null)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile   public.profiles;
  v_mode      text;
  v_settings  public.business_settings;
  v_order     public.orders;
  v_session   public.table_sessions;
  v_customer  public.customers;
  v_address   public.customer_addresses;
  v_zone      public.delivery_fee_zones;
  v_res       record;
  v_cash      public.cash_sessions;

  v_items     jsonb;
  v_item      jsonb;
  v_idx       integer := 0;
  v_qty       integer;

  v_product   public.products;
  v_variant   public.product_variants;
  v_size      public.product_sizes;
  v_flavor    public.products;
  v_flavor_id uuid;
  v_flavor_ids uuid[] := '{}';
  v_prices    integer[] := '{}';
  v_price     integer;
  v_base      integer;
  v_pricing   text;
  v_mod_unit  integer := 0;
  v_item_id   uuid;
  v_grp       record;
  v_opt       record;
  v_pos       integer;
  v_opt_ids   uuid[];
  v_fee       integer := 0;
  v_zone_id   uuid;
begin
  -- ---------- permissões ----------
  v_profile := app_private.require_role('admin', 'manager', 'waiter');

  v_mode := p_payload ->> 'service_mode';
  if v_mode not in ('dine_in', 'delivery') then
    raise exception 'INVALID_SERVICE_MODE: informe service_mode = dine_in ou delivery'
      using errcode = '22023';
  end if;

  if v_mode = 'delivery' and v_profile.role = 'waiter' then
    raise exception 'FORBIDDEN: delivery é registrado pelo caixa ou administrador'
      using errcode = '42501';
  end if;

  select * into v_settings from public.business_settings where id;

  -- ---------- idempotência ----------
  if p_client_uuid is not null then
    select o.* into v_order from public.orders o where o.client_uuid = p_client_uuid;
    if found then
      return v_order;  -- mesma requisição repetida: devolve o pedido já criado
    end if;
  end if;

  -- ---------- sessão de mesa (salão) ----------
  if v_mode = 'dine_in' then
    if v_settings.accept_dine_in is false then
      raise exception 'DINE_IN_DISABLED: atendimento no salão desativado nas configurações'
        using errcode = '22023';
    end if;

    select s.* into v_session
    from public.table_sessions s
    where s.id = nullif(p_payload ->> 'table_session_id', '')::uuid
    for update;

    if not found then
      raise exception 'TABLE_SESSION_NOT_FOUND: atendimento de mesa inexistente' using errcode = '22023';
    end if;
    if v_session.status <> 'open' then
      raise exception 'TABLE_SESSION_CLOSED: este atendimento já foi encerrado' using errcode = '55006';
    end if;
  end if;

  -- ---------- cliente/endereço (delivery) ----------
  if v_mode = 'delivery' then
    if v_settings.accept_delivery is false then
      raise exception 'DELIVERY_DISABLED: delivery desativado nas configurações' using errcode = '22023';
    end if;

    if nullif(p_payload ->> 'customer_id', '')::uuid is not null then
      select c.* into v_customer
      from public.customers c
      where c.id = (p_payload ->> 'customer_id')::uuid;
      if not found then
        raise exception 'CUSTOMER_NOT_FOUND' using errcode = '22023';
      end if;
    else
      v_res := app_private.upsert_customer_internal(
        p_payload -> 'customer', p_payload -> 'address', v_profile.id
      );
      select c.* into v_customer from public.customers c where c.id = v_res.customer_id;
    end if;

    if nullif(p_payload ->> 'address_id', '')::uuid is not null then
      select a.* into v_address
      from public.customer_addresses a
      where a.id = (p_payload ->> 'address_id')::uuid and a.customer_id = v_customer.id;
    else
      select a.* into v_address
      from public.customer_addresses a
      where a.customer_id = v_customer.id
      order by a.is_default desc, a.created_at asc
      limit 1;
    end if;

    if v_address.id is null then
      raise exception 'ADDRESS_REQUIRED: informe o endereço de entrega do cliente'
        using errcode = '22023';
    end if;

    -- Taxa de entrega: zona explícita > zona do bairro > taxa padrão.
    v_zone_id := nullif(p_payload ->> 'delivery_fee_zone_id', '')::uuid;
    if v_zone_id is not null then
      select z.* into v_zone from public.delivery_fee_zones z where z.id = v_zone_id and z.is_active;
      if not found then
        raise exception 'DELIVERY_ZONE_INVALID: zona de entrega inexistente ou inativa'
          using errcode = '22023';
      end if;
    else
      select z.* into v_zone
      from public.delivery_fee_zones z
      where z.is_active and lower(btrim(z.neighborhood)) = lower(btrim(v_address.neighborhood))
      limit 1;
    end if;

    v_fee := coalesce(v_zone.fee_cents, v_settings.default_delivery_fee_cents);
  end if;

  -- ---------- sessão de caixa aberta (para relatórios por turno) ----------
  select cs.* into v_cash from public.cash_sessions cs where cs.status = 'open';

  -- ---------- pedido ----------
  begin
  insert into public.orders (
    service_mode, status, table_session_id, created_by,
    customer_id, delivery_address_id, delivery_fee_zone_id,
    customer_name_snapshot, customer_phone_snapshot, delivery_address_snapshot,
    delivery_neighborhood, delivery_fee_cents, delivery_notes,
    notes, cash_session_id, client_uuid
  ) values (
    v_mode, 'received',
    case when v_mode = 'dine_in' then v_session.id end,
    v_profile.id,
    case when v_mode = 'delivery' then v_customer.id end,
    case when v_mode = 'delivery' then v_address.id end,
    case when v_mode = 'delivery' then v_zone.id end,
    case when v_mode = 'delivery' then v_customer.name end,
    case when v_mode = 'delivery' then v_customer.phone end,
    case when v_mode = 'delivery' then to_jsonb(v_address) - 'id' - 'customer_id' end,
    case when v_mode = 'delivery' then v_address.neighborhood end,
    case when v_mode = 'delivery' then v_fee else 0 end,
    case when v_mode = 'delivery' then nullif(btrim(coalesce(p_payload ->> 'delivery_notes', '')), '') end,
    nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
    v_cash.id,
    p_client_uuid
  )
  returning * into v_order;
  exception
    when unique_violation then
      -- Reenvio simultâneo da mesma criação: devolve o pedido já gravado.
      if p_client_uuid is not null then
        select o.* into v_order from public.orders o where o.client_uuid = p_client_uuid;
        if found then
          return v_order;
        end if;
      end if;
      raise;
  end;

  -- Primeiro marco do histórico: a criação do pedido.
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, notes)
  values (v_order.id, null, 'received', v_profile.id, 'Pedido registrado');

  -- ---------- itens ----------
  v_items := coalesce(p_payload -> 'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'ITEMS_REQUIRED: o pedido precisa de ao menos um item' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 100 then
    raise exception 'TOO_MANY_ITEMS: máximo de 100 itens por pedido' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_idx := v_idx + 1;

    v_qty := coalesce((v_item ->> 'quantity')::integer, 1);
    if v_qty < 1 or v_qty > 50 then
      raise exception 'INVALID_QUANTITY: quantidade deve estar entre 1 e 50' using errcode = '22023';
    end if;

    select p.* into v_product from public.products p
    where p.id = nullif(v_item ->> 'product_id', '')::uuid;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND: produto inexistente' using errcode = '22023';
    end if;
    if not v_product.is_active or not v_product.is_available then
      raise exception 'PRODUCT_UNAVAILABLE: o produto "%" não está disponível', v_product.name
        using errcode = '22023';
    end if;

    select pv.* into v_variant from public.product_variants pv
    where pv.id = nullif(v_item ->> 'variant_id', '')::uuid and pv.product_id = v_product.id;
    if not found or not v_variant.is_available then
      raise exception 'VARIANT_UNAVAILABLE: tamanho indisponível para o produto "%"', v_product.name
        using errcode = '22023';
    end if;

    select ps.* into v_size from public.product_sizes ps where ps.id = v_variant.size_id;
    if not v_size.is_active then
      raise exception 'SIZE_INACTIVE: tamanho inativo' using errcode = '22023';
    end if;

    -- ---- sabores ----
    v_flavor_ids := '{}';
    v_prices := '{}';

    if v_product.kind = 'pizza' then
      v_flavor_ids := array[v_product.id];

      for v_flavor_id in
        select (jsonb_array_elements_text(coalesce(v_item -> 'flavor_product_ids', '[]'::jsonb)))::uuid
      loop
        if v_flavor_id <> v_product.id then
          if v_flavor_id = any (v_flavor_ids) then
            raise exception 'DUPLICATE_FLAVOR: o mesmo sabor foi informado duas vezes'
              using errcode = '22023';
          end if;
          v_flavor_ids := v_flavor_ids || v_flavor_id;
        end if;
      end loop;

      if array_length(v_flavor_ids, 1) > v_size.max_flavors then
        raise exception 'TOO_MANY_FLAVORS: o tamanho "%" aceita no máximo % sabor(es)',
          v_size.name, v_size.max_flavors using errcode = '22023';
      end if;

      foreach v_flavor_id in array v_flavor_ids loop
        select p.* into v_flavor from public.products p where p.id = v_flavor_id;
        if not found or not v_flavor.is_active or not v_flavor.is_available
           or v_flavor.kind <> 'pizza' then
          raise exception 'FLAVOR_UNAVAILABLE: sabor indisponível' using errcode = '22023';
        end if;

        select pv.price_cents into v_price
        from public.product_variants pv
        where pv.product_id = v_flavor_id and pv.size_id = v_size.id and pv.is_available;
        if not found then
          raise exception 'FLAVOR_SIZE_UNAVAILABLE: o sabor "%" não é vendido no tamanho "%"',
            v_flavor.name, v_size.name using errcode = '22023';
        end if;

        v_prices := v_prices || v_price;
      end loop;

      if array_length(v_flavor_ids, 1) = 1 then
        v_base := v_prices[1];
        v_pricing := 'single';
      elsif v_settings.half_and_half_price_rule = 'highest' then
        -- Regra configurável (business_settings.half_and_half_price_rule):
        v_base := greatest(v_prices[1], v_prices[2]);
        v_pricing := 'highest';
      else
        v_base := round((v_prices[1] + v_prices[2])::numeric / 2)::integer;
        v_pricing := 'average';
      end if;
    else
      if jsonb_array_length(coalesce(v_item -> 'flavor_product_ids', '[]'::jsonb)) > 0 then
        raise exception 'FLAVORS_NOT_ALLOWED: o produto "%" não aceita sabores', v_product.name
          using errcode = '22023';
      end if;
      v_base := v_variant.price_cents;
      v_pricing := 'single';
    end if;

    -- ---- adicionais (validação de grupos permitidos, limites e disponibilidade) ----
    v_opt_ids := array(
      select (jsonb_array_elements_text(coalesce(v_item -> 'modifier_option_ids', '[]'::jsonb)))::uuid
    );

    -- Grupos obrigatórios / limites máximos — validados SEMPRE, mesmo quando o
    -- item não tem nenhum adicional (se não houver WHERE opcional... o grupo é exigido).
    for v_grp in
      select g.id, g.name, g.min_select, g.max_select,
             (select count(*)::int from unnest(v_opt_ids) oid
               join public.modifier_options mo on mo.id = oid
              where mo.group_id = g.id) as chosen
      from public.product_modifier_groups pmg
      join public.modifier_groups g on g.id = pmg.group_id and g.is_active
      where pmg.product_id = v_product.id
    loop
      if coalesce(v_grp.chosen, 0) < v_grp.min_select then
        raise exception 'MODIFIER_REQUIRED: escolha ao menos % opção(ões) do grupo "%"',
          v_grp.min_select, v_grp.name using errcode = '22023';
      end if;
      if coalesce(v_grp.chosen, 0) > v_grp.max_select then
        raise exception 'MODIFIER_LIMIT_EXCEEDED: o grupo "%" aceita no máximo % opção(ões)',
          v_grp.name, v_grp.max_select using errcode = '22023';
      end if;
    end loop;

    if array_length(v_opt_ids, 1) is not null then
      if array_length(v_opt_ids, 1) <> (select count(distinct x) from unnest(v_opt_ids) x) then
        raise exception 'DUPLICATE_MODIFIER: adicional informado mais de uma vez' using errcode = '22023';
      end if;

      -- Opções válidas e permitidas para o produto
      if exists (
        select 1
        from unnest(v_opt_ids) oid
        left join public.modifier_options mo on mo.id = oid
        left join public.product_modifier_groups pmg
               on pmg.group_id = mo.group_id and pmg.product_id = v_product.id
        where mo.id is null or not mo.is_available or pmg.product_id is null
      ) then
        raise exception 'MODIFIER_INVALID: adicional inexistente, indisponível ou não permitido para "%"',
          v_product.name using errcode = '22023';
      end if;
    end if;

    select coalesce(sum(mo.price_cents), 0) into v_mod_unit
    from unnest(v_opt_ids) oid
    join public.modifier_options mo on mo.id = oid;

    -- ---- gravação do item (com SNAPSHOT de nomes e preços) ----
    insert into public.order_items (
      order_id, line_number, product_id, variant_id,
      product_name, category_name, size_name, quantity,
      unit_base_price_cents, modifiers_unit_cents, unit_price_cents,
      modifiers_total_cents, total_cents, pricing_rule, notes, created_by
    ) values (
      v_order.id, v_idx, v_product.id, v_variant.id,
      v_product.name,
      (select c.name from public.categories c where c.id = v_product.category_id),
      v_size.name, v_qty,
      v_base, v_mod_unit, v_base + v_mod_unit,
      v_mod_unit * v_qty, (v_base + v_mod_unit) * v_qty,
      v_pricing,
      nullif(btrim(coalesce(v_item ->> 'notes', '')), ''),
      v_profile.id
    )
    returning id into v_item_id;

    -- sabores (pizza)
    if array_length(v_flavor_ids, 1) is not null then
      for v_pos in 1 .. array_length(v_flavor_ids, 1) loop
        select p.* into v_flavor from public.products p where p.id = v_flavor_ids[v_pos];
        insert into public.order_item_flavors (order_item_id, product_id, flavor_name, position)
        values (v_item_id, v_flavor_ids[v_pos], v_flavor.name, v_pos);
      end loop;
    end if;

    -- adicionais
    for v_opt in
      select mo.id, mo.name, mo.price_cents, mg.id as group_id, mg.name as group_name
      from unnest(v_opt_ids) oid
      join public.modifier_options mo on mo.id = oid
      join public.modifier_groups mg on mg.id = mo.group_id
    loop
      insert into public.order_item_modifiers (
        order_item_id, group_id, group_name, option_id, option_name, price_cents
      ) values (
        v_item_id, v_opt.group_id, v_opt.group_name, v_opt.id, v_opt.name, v_opt.price_cents
      );
    end loop;
  end loop;

  -- valores oficiais recalculados no servidor
  perform app_private.recalc_order_totals(v_order.id);
  select o.* into v_order from public.orders o where o.id = v_order.id;

  -- ---------- pedido mínimo de delivery (configuração com efeito real) ----------
  -- A regra compara o valor dos ITENS (subtotal), sem a taxa de entrega: a taxa
  -- é logística, não mercadoria. Configuração em 0 desliga a exigência.
  if v_mode = 'delivery'
     and v_settings.min_delivery_order_cents > 0
     and v_order.subtotal_cents < v_settings.min_delivery_order_cents then
    raise exception 'DELIVERY_MINIMUM_NOT_MET: o pedido mínimo para delivery é R$ % (os itens somam R$ %)',
      to_char(v_settings.min_delivery_order_cents::numeric / 100, 'FM999990.00'),
      to_char(v_order.subtotal_cents::numeric / 100, 'FM999990.00')
      using errcode = '22023';
  end if;

  perform app_private.log_audit(
    'order.create', 'orders', v_order.id::text, v_order.order_number, v_order.table_session_id,
    v_cash.id, v_order.total_cents, null,
    jsonb_build_object(
      'service_mode', v_mode,
      'subtotal_cents', v_order.subtotal_cents,
      'delivery_fee_cents', v_order.delivery_fee_cents,
      'items', jsonb_array_length(v_items)
    )
  );

  return v_order;
end
$$;

-- -----------------------------------------------------------------------------
-- Guarda do pagamento dividido: vale para qualquer caminho que insira
-- recebimento (RPC, correção manual, integração futura).
-- -----------------------------------------------------------------------------
create or replace function app_private.guard_split_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
begin
  select s.split_payment_enabled into v_enabled
    from public.business_settings s where s.id;

  -- Sem configuração lida (linha ausente), não interfere.
  if coalesce(v_enabled, true) is false then
    if exists (
      select 1
        from public.payments p
       where p.order_id = new.order_id
         and p.status = 'confirmed'
         and p.method_id <> new.method_id
    ) then
      raise exception 'SPLIT_PAYMENT_DISABLED: o pagamento dividido está desativado; use uma única forma de pagamento neste pedido'
        using errcode = '22023';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists guard_split_payment on public.payments;
create trigger guard_split_payment
  before insert on public.payments
  for each row execute function app_private.guard_split_payment();
