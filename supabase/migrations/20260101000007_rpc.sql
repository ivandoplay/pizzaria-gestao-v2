-- =============================================================================
-- 0007 — REGRAS DE NEGÓCIO (RPCs) — todo o acesso de escrita crítico
--
-- Por que RPC e não escrita direta pelo cliente?
--   * O perfil é validado NO BANCO a cada chamada (app_private.require_role).
--   * Preços, descontos, taxas e totais são CALCULADOS aqui — o que o navegador
--     envia são apenas IDs e quantidades, jamais valores monetários confiados.
--   * Idempotência (client_uuid) e locks (FOR UPDATE) impedem duplicidade por
--     clique repetido, reenvio após falha de rede ou ações concorrentes.
--   * Toda operação relevante é registrada em audit_logs.
-- =============================================================================

-- =============================================================================
-- A) CLIENTES
-- =============================================================================
create or replace function app_private.upsert_customer_internal(
  p_customer   jsonb,
  p_address    jsonb,
  p_profile_id uuid
)
returns table (customer_id uuid, address_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone    text;
  v_digits   text;
  v_customer public.customers;
  v_address  public.customer_addresses;
begin
  if p_customer is null then
    raise exception 'CUSTOMER_REQUIRED: informe os dados do cliente' using errcode = '22023';
  end if;

  v_phone  := btrim(coalesce(p_customer ->> 'phone', ''));
  v_digits := regexp_replace(v_phone, '\D', '', 'g');

  if length(v_digits) not between 10 and 13 then
    raise exception 'CUSTOMER_PHONE_INVALID: informe o telefone com DDD (ex.: 86999990000)'
      using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_customer ->> 'name', ''))) < 2 then
    raise exception 'CUSTOMER_NAME_INVALID: informe o nome do cliente' using errcode = '22023';
  end if;

  select c.* into v_customer from public.customers c where c.phone_digits = v_digits limit 1;

  if found then
    update public.customers c
       set name  = btrim(p_customer ->> 'name'),
           email = coalesce(nullif(btrim(coalesce(p_customer ->> 'email', '')), ''), c.email),
           notes = coalesce(nullif(btrim(coalesce(p_customer ->> 'notes', '')), ''), c.notes)
     where c.id = v_customer.id
    returning * into v_customer;
  else
    insert into public.customers (name, phone, email, notes, created_by)
    values (
      btrim(p_customer ->> 'name'),
      v_phone,
      nullif(btrim(coalesce(p_customer ->> 'email', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'notes', '')), ''),
      p_profile_id
    )
    returning * into v_customer;
  end if;

  customer_id := v_customer.id;

  if p_address is not null then
    if length(btrim(coalesce(p_address ->> 'street', ''))) < 2
       or length(btrim(coalesce(p_address ->> 'number', ''))) < 1
       or length(btrim(coalesce(p_address ->> 'neighborhood', ''))) < 2 then
      raise exception 'ADDRESS_INVALID: informe rua, número e bairro do endereço de entrega'
        using errcode = '22023';
    end if;

    select a.* into v_address
    from public.customer_addresses a
    where a.customer_id = v_customer.id
      and lower(btrim(a.street)) = lower(btrim(p_address ->> 'street'))
      and btrim(a.number) = btrim(p_address ->> 'number')
      and lower(btrim(a.neighborhood)) = lower(btrim(p_address ->> 'neighborhood'))
    limit 1;

    if found then
      update public.customer_addresses a
         set complement     = coalesce(nullif(btrim(coalesce(p_address ->> 'complement', '')), ''), a.complement),
             reference      = coalesce(nullif(btrim(coalesce(p_address ->> 'reference', '')), ''), a.reference),
             delivery_notes = coalesce(nullif(btrim(coalesce(p_address ->> 'delivery_notes', '')), ''), a.delivery_notes),
             city           = coalesce(nullif(btrim(coalesce(p_address ->> 'city', '')), ''), a.city),
             state          = coalesce(nullif(upper(btrim(coalesce(p_address ->> 'state', ''))), ''), a.state),
             postal_code    = coalesce(nullif(btrim(coalesce(p_address ->> 'postal_code', '')), ''), a.postal_code)
       where a.id = v_address.id
      returning * into v_address;
    else
      insert into public.customer_addresses (
        customer_id, label, street, number, complement, neighborhood,
        city, state, postal_code, reference, delivery_notes, is_default
      ) values (
        v_customer.id,
        nullif(btrim(coalesce(p_address ->> 'label', '')), ''),
        btrim(p_address ->> 'street'),
        btrim(p_address ->> 'number'),
        nullif(btrim(coalesce(p_address ->> 'complement', '')), ''),
        btrim(p_address ->> 'neighborhood'),
        coalesce(nullif(btrim(coalesce(p_address ->> 'city', '')), ''), 'Teresina'),
        coalesce(nullif(upper(btrim(coalesce(p_address ->> 'state', ''))), ''), 'PI'),
        nullif(btrim(coalesce(p_address ->> 'postal_code', '')), ''),
        nullif(btrim(coalesce(p_address ->> 'reference', '')), ''),
        nullif(btrim(coalesce(p_address ->> 'delivery_notes', '')), ''),
        not exists (
          select 1 from public.customer_addresses ca
          where ca.customer_id = v_customer.id and ca.is_default
        )
      )
      returning * into v_address;
    end if;

    address_id := v_address.id;
  end if;

  return next;
end
$$;

create or replace function public.upsert_customer(p_customer jsonb, p_address jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_res     record;
begin
  v_profile := app_private.require_role('admin', 'manager');
  v_res := app_private.upsert_customer_internal(p_customer, p_address, v_profile.id);

  perform app_private.log_audit(
    'customer.upsert', 'customers', v_res.customer_id::text, null, null, null, null,
    null, jsonb_build_object('phone', p_customer ->> 'phone')
  );

  return jsonb_build_object('customer_id', v_res.customer_id, 'address_id', v_res.address_id);
end
$$;

-- =============================================================================
-- B) MESAS — abertura de sessão
-- =============================================================================
create or replace function public.open_table_session(
  p_table_id     uuid,
  p_guest_count  smallint default null,
  p_notes        text default null,
  p_client_uuid  uuid default null
)
returns public.table_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_table   public.restaurant_tables;
  v_session public.table_sessions;
begin
  v_profile := app_private.require_role('admin', 'manager', 'waiter');

  -- Idempotência: mesma requisição repetida devolve a mesma sessão.
  if p_client_uuid is not null then
    select s.* into v_session from public.table_sessions s where s.client_uuid = p_client_uuid;
    if found then
      return v_session;
    end if;
  end if;

  select t.* into v_table from public.restaurant_tables t where t.id = p_table_id;
  if not found then
    raise exception 'TABLE_NOT_FOUND: mesa inexistente' using errcode = '22023';
  end if;
  if not v_table.is_active then
    raise exception 'TABLE_INACTIVE: mesa desativada para uso' using errcode = '22023';
  end if;

  begin
    insert into public.table_sessions (table_id, opened_by, guest_count, notes, client_uuid)
    values (p_table_id, v_profile.id, p_guest_count, nullif(btrim(coalesce(p_notes, '')), ''), p_client_uuid)
    returning * into v_session;
  exception
    when unique_violation then
      -- Duas requisições ao mesmo tempo: uma criou a sessão; a outra devolve a
      -- MESMA sessão (idempotência) em vez de criar uma duplicada.
      if p_client_uuid is not null then
        select s.* into v_session from public.table_sessions s where s.client_uuid = p_client_uuid;
        if found then
          return v_session;
        end if;
      end if;
      raise exception 'TABLE_ALREADY_OPEN: esta mesa já possui um atendimento aberto por outro usuário'
        using errcode = '23505';
  end;

  perform app_private.log_audit(
    'table_session.open', 'table_sessions', v_session.id::text, null, v_session.id,
    null, null, null, jsonb_build_object('table_id', p_table_id, 'number', v_table.number)
  );

  return v_session;
end
$$;

-- =============================================================================
-- C) CRIAÇÃO DE PEDIDO (salão e delivery)
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

-- =============================================================================
-- D) MUDANÇAS DE ESTADO DO PEDIDO
-- =============================================================================
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
  v_profile public.profiles;
  v_order   public.orders;
  v_from    text;
  v_allowed boolean := false;
begin
  if p_to_status = 'delivered_to_table' then
    v_profile := app_private.require_role('admin', 'manager', 'waiter');
  else
    v_profile := app_private.require_role('admin', 'manager');
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

-- =============================================================================
-- E) CANCELAMENTO DE ITEM (com redução de quantidade)
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

-- =============================================================================
-- F) DESCONTO DO PEDIDO (com limites por perfil)
-- =============================================================================
create or replace function public.set_order_discount(
  p_order_id      uuid,
  p_reason        text,
  p_discount_pct  numeric default null,
  p_discount_cents integer default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile  public.profiles;
  v_order    public.orders;
  v_settings public.business_settings;
  v_reason   text;
  v_pct      numeric(5, 2);
  v_cents    integer;
  v_limit    numeric(5, 2);
begin
  v_profile := app_private.require_role('admin', 'manager');

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED: informe o motivo do desconto' using errcode = '22023';
  end if;
  if p_discount_pct is null and p_discount_cents is null then
    raise exception 'DISCOUNT_REQUIRED: informe percentual ou valor do desconto' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = '22023';
  end if;
  if v_order.account_closed_at is not null then
    raise exception 'ORDER_ACCOUNT_CLOSED: conta fechada; descontos exigem procedimento administrativo'
      using errcode = '55006';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED' using errcode = '55006';
  end if;
  if v_order.subtotal_cents <= 0 then
    raise exception 'EMPTY_ORDER: pedido sem itens válidos' using errcode = '22023';
  end if;

  select * into v_settings from public.business_settings where id;

  if p_discount_pct is not null then
    v_pct := round(p_discount_pct, 2);
    v_cents := round(v_order.subtotal_cents::numeric * v_pct / 100)::integer;
  else
    v_cents := greatest(p_discount_cents, 0);
    v_pct := round((v_cents::numeric / v_order.subtotal_cents::numeric) * 100, 2);
  end if;

  if v_cents > v_order.subtotal_cents then
    raise exception 'DISCOUNT_TOO_HIGH: desconto maior que o subtotal do pedido' using errcode = '22023';
  end if;

  -- Limite por perfil: caixa até max_discount_pct_without_auth; admin até o teto.
  v_limit := case when v_profile.role = 'admin'
                  then v_settings.max_discount_pct_hard
                  else v_settings.max_discount_pct_without_auth end;

  if v_pct > v_limit then
    raise exception 'DISCOUNT_LIMIT_EXCEEDED: desconto de %%% acima do limite de %%% para o perfil %; solicite autorização do administrador',
      v_pct, v_limit, v_profile.role using errcode = '42501';
  end if;

  update public.orders o
     set discount_cents        = v_cents,
         discount_pct          = v_pct,
         discount_reason       = v_reason,
         discount_authorized_by = v_profile.id
   where o.id = v_order.id;

  perform app_private.recalc_order_totals(v_order.id);
  select o.* into v_order from public.orders o where o.id = v_order.id;

  perform app_private.log_audit(
    'order.discount', 'orders', v_order.id::text, v_order.order_number, v_order.table_session_id,
    v_order.cash_session_id, v_cents, v_reason,
    jsonb_build_object('discount_pct', v_pct, 'limit_pct', v_limit, 'role', v_profile.role)
  );

  return v_order;
end
$$;

-- =============================================================================
-- G) PAGAMENTOS
-- =============================================================================
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
  v_profile := app_private.require_role('admin', 'manager');

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

create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_payment public.payments;
  v_order   public.orders;
  v_method  public.payment_methods;
  v_cash    public.cash_sessions;
  v_reason  text;
begin
  v_profile := app_private.require_role('admin', 'manager');

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED: informe o motivo do estorno' using errcode = '22023';
  end if;

  select p.* into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = '22023';
  end if;
  if v_payment.status = 'reversed' then
    raise exception 'PAYMENT_ALREADY_REVERSED' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = v_payment.order_id for update;
  select m.* into v_method from public.payment_methods m where m.id = v_payment.method_id;

  -- Estorno de dinheiro: exige caixa aberto e gera saída (ajuste) auditada.
  if v_method.affects_cash_drawer then
    select cs.* into v_cash from public.cash_sessions cs where cs.status = 'open' for update;
    if not found then
      raise exception 'CASH_SESSION_REQUIRED: abra o caixa para estornar recebimentos em dinheiro'
        using errcode = '22023';
    end if;

    insert into public.cash_movements (
      cash_session_id, kind, category, source, amount_cents, description, reason,
      order_id, payment_id, created_by
    ) values (
      v_cash.id, 'out', 'adjustment', 'automatic', v_payment.amount_cents,
      'Estorno de recebimento do pedido #' || v_order.order_number, v_reason,
      v_order.id, v_payment.id, v_profile.id
    );
  end if;

  update public.payments p
     set status         = 'reversed',
         reversed_at    = now(),
         reversed_by    = v_profile.id,
         reverse_reason = v_reason
   where p.id = v_payment.id
  returning * into v_payment;

  perform app_private.recalc_order_totals(v_order.id);

  perform app_private.log_audit(
    'payment.reverse', 'payments', v_payment.id::text, v_order.order_number,
    v_order.table_session_id, v_payment.cash_session_id, v_payment.amount_cents, v_reason,
    jsonb_build_object('method', v_payment.method_id)
  );

  return v_payment;
end
$$;

-- =============================================================================
-- H) TAXA DE ENTREGA (somente administrador)
-- =============================================================================
create or replace function public.set_delivery_fee(p_order_id uuid, p_fee_cents integer, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_order   public.orders;
  v_reason  text;
begin
  v_profile := app_private.require_role('admin');

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED: informe o motivo do ajuste da taxa' using errcode = '22023';
  end if;
  if p_fee_cents is null or p_fee_cents < 0 then
    raise exception 'INVALID_FEE' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = '22023';
  end if;
  if v_order.service_mode <> 'delivery' then
    raise exception 'NOT_DELIVERY_ORDER' using errcode = '22023';
  end if;
  if v_order.account_closed_at is not null or v_order.status = 'cancelled' then
    raise exception 'ORDER_CLOSED_OR_CANCELLED' using errcode = '55006';
  end if;

  update public.orders o set delivery_fee_cents = p_fee_cents where o.id = v_order.id;
  perform app_private.recalc_order_totals(v_order.id);
  select o.* into v_order from public.orders o where o.id = v_order.id;

  perform app_private.log_audit(
    'order.delivery_fee', 'orders', v_order.id::text, v_order.order_number, null,
    v_order.cash_session_id, p_fee_cents, v_reason, jsonb_build_object('admin', v_profile.full_name)
  );

  return v_order;
end
$$;

-- =============================================================================
-- I) FECHAMENTO DE CONTAS
-- =============================================================================
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
    v_profile := app_private.require_role('admin');
  else
    v_profile := app_private.require_role('admin', 'manager');
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

create or replace function public.close_delivery_account(
  p_order_id uuid,
  p_force    boolean default false,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_order   public.orders;
  v_reason  text;
  v_balance integer;
begin
  if p_force then
    v_profile := app_private.require_role('admin');
  else
    v_profile := app_private.require_role('admin', 'manager');
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = '22023';
  end if;
  if v_order.service_mode <> 'delivery' then
    raise exception 'NOT_DELIVERY_ORDER' using errcode = '22023';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED' using errcode = '55006';
  end if;
  if v_order.account_closed_at is not null then
    raise exception 'ORDER_ACCOUNT_CLOSED' using errcode = '55006';
  end if;

  perform app_private.recalc_order_totals(v_order.id);
  select o.* into v_order from public.orders o where o.id = v_order.id;

  v_balance := v_order.total_cents - v_order.paid_cents;

  if v_balance > 0 and not coalesce(p_force, false) then
    raise exception 'BALANCE_PENDING: pedido com saldo pendente de R$ %',
      to_char(v_balance::numeric / 100, 'FM999990.00') using errcode = '22023';
  end if;
  if v_balance > 0 and v_reason is null then
    raise exception 'REASON_REQUIRED: fechamento com saldo pendente exige justificativa do administrador'
      using errcode = '22023';
  end if;

  update public.orders o
     set account_closed_at = now(),
         closed_by = v_profile.id
   where o.id = v_order.id
  returning * into v_order;

  perform app_private.log_audit(
    'delivery_account.close', 'orders', v_order.id::text, v_order.order_number, null,
    v_order.cash_session_id, v_order.total_cents, v_reason,
    jsonb_build_object(
      'total_cents', v_order.total_cents,
      'paid_cents', v_order.paid_cents,
      'balance_cents', v_balance,
      'forced', coalesce(p_force, false)
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'total_cents', v_order.total_cents,
    'paid_cents', v_order.paid_cents,
    'balance_cents', v_balance,
    'closed_with_balance', v_balance > 0,
    'closed_at', v_order.account_closed_at
  );
end
$$;

-- =============================================================================
-- J) CAIXA: abertura, movimentações e fechamento
-- =============================================================================
create or replace function public.start_cash_session(
  p_opening_amount_cents integer default 0,
  p_note text default null,
  p_client_uuid uuid default null
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_session public.cash_sessions;
begin
  v_profile := app_private.require_role('admin', 'manager');

  if coalesce(p_opening_amount_cents, 0) < 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;

  if p_client_uuid is not null then
    select cs.* into v_session from public.cash_sessions cs where cs.client_uuid = p_client_uuid;
    if found then
      return v_session;
    end if;
  end if;

  select cs.* into v_session from public.cash_sessions cs where cs.status = 'open' for update;
  if found then
    raise exception 'CASH_SESSION_ALREADY_OPEN: já existe um caixa aberto por % desde %',
      (select p.full_name from public.profiles p where p.id = v_session.opened_by),
      to_char(v_session.opened_at, 'DD/MM/YYYY HH24:MI')
      using errcode = '23505';
  end if;

  begin
    insert into public.cash_sessions (opened_by, opening_amount_cents, opening_note, client_uuid)
    values (v_profile.id, coalesce(p_opening_amount_cents, 0),
            nullif(btrim(coalesce(p_note, '')), ''), p_client_uuid)
    returning * into v_session;
  exception
    when unique_violation then
      if p_client_uuid is not null then
        select cs.* into v_session from public.cash_sessions cs where cs.client_uuid = p_client_uuid;
        if found then
          return v_session;
        end if;
      end if;
      raise exception 'CASH_SESSION_ALREADY_OPEN: já existe um caixa aberto' using errcode = '23505';
  end;

  perform app_private.log_audit(
    'cash_session.open', 'cash_sessions', v_session.id::text, null, null, v_session.id,
    coalesce(p_opening_amount_cents, 0), null, jsonb_build_object('responsible', v_profile.full_name)
  );

  return v_session;
end
$$;

create or replace function public.add_cash_movement(
  p_session_id   uuid,
  p_kind         text,
  p_category     text,
  p_amount_cents integer,
  p_description  text default null,
  p_reason       text default null,
  p_client_uuid  uuid default null
)
returns public.cash_movements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_session public.cash_sessions;
  v_movement public.cash_movements;
  v_expected integer;
begin
  v_profile := app_private.require_role('admin', 'manager');

  if p_kind not in ('in', 'out') then
    raise exception 'INVALID_KIND: use in ou out' using errcode = '22023';
  end if;
  if p_category not in ('change_fund', 'withdrawal', 'expense', 'adjustment', 'other') then
    raise exception 'INVALID_CATEGORY: categoria % não é lançável manualmente', p_category
      using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT: o valor deve ser maior que zero' using errcode = '22023';
  end if;
  if p_category <> 'adjustment' and p_category <> 'other' then
    if (p_category = 'change_fund' and p_kind <> 'in')
       or (p_category in ('withdrawal', 'expense') and p_kind <> 'out') then
      raise exception 'INVALID_CATEGORY_KIND: categoria % exige tipo %',
        p_category, case when p_category = 'change_fund' then 'in' else 'out' end
        using errcode = '22023';
    end if;
  end if;

  if p_client_uuid is not null then
    select m.* into v_movement from public.cash_movements m where m.client_uuid = p_client_uuid;
    if found then
      return v_movement;
    end if;
  end if;

  select cs.* into v_session from public.cash_sessions cs where cs.id = p_session_id for update;
  if not found then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = '22023';
  end if;
  if v_session.status <> 'open' then
    raise exception 'CASH_SESSION_CLOSED: caixa fechado; movimentações exigem ajuste administrativo'
      using errcode = '55006';
  end if;

  -- Saída não pode deixar a gaveta negativa.
  if p_kind = 'out' then
    select v_session.opening_amount_cents
           + coalesce(sum(case when m.kind = 'in' then m.amount_cents else -m.amount_cents end), 0)
    into v_expected
    from public.cash_movements m
    where m.cash_session_id = v_session.id;

    if p_amount_cents > v_expected then
      raise exception 'INSUFFICIENT_CASH: a gaveta tem R$ % e a saída solicitada é de R$ %',
        to_char(v_expected::numeric / 100, 'FM999990.00'),
        to_char(p_amount_cents::numeric / 100, 'FM999990.00')
        using errcode = '22023';
    end if;
  end if;

  insert into public.cash_movements (
    cash_session_id, kind, category, source, amount_cents, description, reason,
    created_by, client_uuid
  ) values (
    v_session.id, p_kind, p_category, 'manual', p_amount_cents,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_profile.id, p_client_uuid
  )
  returning * into v_movement;

  perform app_private.log_audit(
    'cash_movement.' || p_kind, 'cash_movements', v_movement.id::text, null, null,
    v_session.id, p_amount_cents, v_movement.reason,
    jsonb_build_object('category', p_category, 'description', v_movement.description)
  );

  return v_movement;
end
$$;

create or replace function public.close_cash_session(
  p_session_id        uuid,
  p_counted_cash_cents integer,
  p_note              text default null,
  p_variance_reason   text default null
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile  public.profiles;
  v_session  public.cash_sessions;
  v_settings public.business_settings;
  v_expected integer;
  v_diff     integer;
  v_reason   text;
begin
  v_profile := app_private.require_role('admin', 'manager');

  if p_counted_cash_cents is null or p_counted_cash_cents < 0 then
    raise exception 'INVALID_AMOUNT: informe o valor contado na gaveta' using errcode = '22023';
  end if;

  select cs.* into v_session from public.cash_sessions cs where cs.id = p_session_id for update;
  if not found then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = '22023';
  end if;
  if v_session.status <> 'open' then
    raise exception 'CASH_SESSION_CLOSED: este caixa já foi fechado' using errcode = '55006';
  end if;

  -- Caixa só fecha a própria sessão; administrador pode fechar qualquer uma.
  if v_profile.role <> 'admin' and v_session.opened_by <> v_profile.id then
    raise exception 'FORBIDDEN: somente o responsável pelo caixa (ou um administrador) pode fechá-lo'
      using errcode = '42501';
  end if;

  select * into v_settings from public.business_settings where id;

  -- O saldo esperado considera SOMENTE dinheiro físico:
  -- abertura + entradas - saídas. Pix/cartões nunca entram na gaveta.
  select v_session.opening_amount_cents
         + coalesce(sum(case when m.kind = 'in' then m.amount_cents else -m.amount_cents end), 0)
  into v_expected
  from public.cash_movements m
  where m.cash_session_id = v_session.id;

  v_diff := p_counted_cash_cents - v_expected;
  v_reason := nullif(btrim(coalesce(p_variance_reason, '')), '');

  if v_diff <> 0 and abs(v_diff) > v_settings.cash_variance_tolerance_cents and v_reason is null then
    raise exception 'VARIANCE_REASON_REQUIRED: há divergência de R$ %; informe a justificativa',
      to_char(abs(v_diff)::numeric / 100, 'FM999990.00') using errcode = '22023';
  end if;

  update public.cash_sessions cs
     set status              = 'closed',
         closed_by           = v_profile.id,
         closed_at           = now(),
         expected_cash_cents = v_expected,
         counted_cash_cents  = p_counted_cash_cents,
         difference_cents    = v_diff,
         closing_note        = nullif(btrim(coalesce(p_note, '')), ''),
         variance_reason     = v_reason
   where cs.id = v_session.id
  returning * into v_session;

  perform app_private.log_audit(
    'cash_session.close', 'cash_sessions', v_session.id::text, null, null, v_session.id,
    v_diff, v_reason,
    jsonb_build_object(
      'opening_cents', v_session.opening_amount_cents,
      'expected_cents', v_expected,
      'counted_cents', p_counted_cash_cents,
      'difference_cents', v_diff
    )
  );

  return v_session;
end
$$;
