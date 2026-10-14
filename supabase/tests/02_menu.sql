-- =============================================================================
-- 02_menu.sql — cardápio gerenciável, preços e regras de montagem do pedido
-- =============================================================================
-- Critérios (seção 17): "cardápio gerenciável sem mexer no banco"; "preços são
-- os do momento do pedido"; "pedido nunca é duplicado por clique repetido".
-- =============================================================================

-- ------------------------------------------------- 1) admin gerencia o cardápio
do $$
declare
  v_cat uuid;
  v_prod uuid;
  v_size uuid;
begin
  perform tests.login('ana.admin');

  insert into public.categories (name, description, sort_order)
  values ('Bebidas Teste 02', 'Criada pelo administrador no teste', 500)
  returning id into v_cat;
  perform tests.ok(v_cat is not null, 'administrador cria categoria');

  insert into public.products (category_id, name, kind, description, sort_order)
  values (v_cat, 'Suco Teste 02', 'simple', 'Suco de laranja', 10)
  returning id into v_prod;
  perform tests.ok(v_prod is not null, 'administrador cria produto');

  select id into v_size from public.product_sizes where code = 'GAR';
  insert into public.product_variants (product_id, size_id, price_cents)
  values (v_prod, v_size, 1200);
  perform tests.eq_int(
    (select price_cents from public.product_variants where product_id = v_prod and size_id = v_size),
    1200, 'administrador define o preço do produto');

  update public.products set is_available = false where id = v_prod;
  perform tests.eq_bool((select is_available from public.products where id = v_prod), false,
    'administrador marca produto como indisponível');

  -- produto com histórico é DESATIVADO, nunca apagado
  update public.products set is_active = false where id = v_prod;
  perform tests.ok((select not is_active from public.products where id = v_prod),
    'administrador desativa (não apaga) o produto');

  perform tests.logout();
end
$$;

-- ------------------------------------ 2) pedido com meio a meio, borda e extra
do $$
declare
  v_session uuid;
  v_order public.orders;
  v_item  public.order_items;
  v_fx record;
begin
  select * into v_fx from tests.fx;

  perform tests.login('carlos.caixa');

  v_session := (select id from public.open_table_session(
    (select id from public.restaurant_tables where number = 6), 4::smallint, 'Teste 02'));

  -- Pizza Teste A (G, 5000) meio a meio com Pizza Teste B (G, 4000)
  -- + Borda Catupiry (500) + Extra Queijo (300, grupo obrigatório)
  -- regra vigente: 'highest' → base 5000 · unitário 5800 · 2x = 11600
  v_order := public.create_order(
    jsonb_build_object(
      'service_mode', 'dine_in',
      'table_session_id', v_session,
      'notes', 'Pedido do teste 02',
      'items', jsonb_build_array(
        jsonb_build_object(
          'product_id', v_fx.pizza_a,
          'variant_id', v_fx.variant_a_g,
          'quantity', 2,
          'flavor_product_ids', jsonb_build_array(v_fx.pizza_a, v_fx.pizza_b),
          'modifier_option_ids', jsonb_build_array(v_fx.opt_catupiry, v_fx.opt_queijo),
          'notes', 'bem assada'
        )
      )
    ),
    '00000000-0000-0000-0000-0000000000a1'::uuid
  );

  select * into v_item from public.order_items where order_id = v_order.id;

  perform tests.eq_int(v_item.unit_base_price_cents, 5000,
    'meio a meio cobra o sabor mais caro (regra "highest")');
  perform tests.eq_text(v_item.pricing_rule, 'highest', 'regra de preço registrada no item');
  perform tests.eq_int(v_item.modifiers_unit_cents, 800, 'adicionais somados por unidade');
  perform tests.eq_int(v_item.unit_price_cents, 5800, 'preço unitário = base + adicionais');
  perform tests.eq_int(v_item.total_cents, 11600, 'total da linha considera a quantidade');
  perform tests.eq_text(v_item.notes, 'bem assada', 'observação do item preservada');

  perform tests.eq_int(
    (select count(*) from public.order_item_flavors where order_item_id = v_item.id), 2,
    'os dois sabores ficam registrados no item');

  perform tests.eq_int(
    (select count(*) from public.order_item_modifiers where order_item_id = v_item.id), 2,
    'os dois adicionais ficam registrados no item');

  perform tests.eq_int(v_order.subtotal_cents, 11600, 'subtotal do pedido');
  perform tests.eq_int(v_order.total_cents, 11600, 'total do pedido sem taxa de entrega');
  perform tests.eq_int(v_order.order_number, 1, 'primeiro pedido recebe o número 1');

  perform tests.logout();
end
$$;

-- ------------------------------------------- 3) clique repetido não duplica
do $$
declare
  v_fx record;
  v_session uuid;
begin
  select * into v_fx from tests.fx;
  select id into v_session from public.table_sessions where status = 'open'
    and table_id = (select id from public.restaurant_tables where number = 6);

  perform tests.login('carlos.caixa');

  -- Duas chamadas com o MESMO client_uuid (ex.: dedo duplo no tablet)
  perform public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 2))),
    '00000000-0000-0000-0000-0000000000a2'::uuid);

  perform public.create_order(
    jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.drink, 'variant_id', v_fx.variant_drink_un, 'quantity', 2))),
    '00000000-0000-0000-0000-0000000000a2'::uuid);

  perform tests.eq_int(
    (select count(*) from public.orders where client_uuid = '00000000-0000-0000-0000-0000000000a2'),
    1, 'clique repetido gera um único pedido (idempotência por client_uuid)');

  perform tests.eq_int(
    (select count(*) from public.orders where table_session_id = v_session), 2,
    'a conta da mesa tem dois pedidos distintos até aqui');

  perform tests.logout();
end
$$;

-- --------------------------------- 4) preço histórico: mudar o cardápio não altera
do $$
declare
  v_fx record;
  v_order public.orders;
  v_item public.order_items;
  v_total_antes integer;
begin
  select * into v_fx from tests.fx;
  select * into v_order from public.orders
   where client_uuid = '00000000-0000-0000-0000-0000000000a1';
  select * into v_item from public.order_items where order_id = v_order.id;

  perform tests.login('ana.admin');
  update public.product_variants set price_cents = 9900
   where product_id = v_fx.pizza_a and size_id = v_fx.size_g;
  perform tests.logout();

  select total_cents into v_total_antes from public.orders where id = v_order.id;
  perform tests.eq_int(
    (select unit_base_price_cents from public.order_items where id = v_item.id), 5000,
    'o item guarda o preço do momento do pedido');
  perform tests.eq_int(v_total_antes, 11600,
    'mudar o preço do cardápio não reajusta pedidos já lançados');

  -- O próximo pedido, sim, usa o preço novo
  perform tests.login('carlos.caixa');
  v_order := public.create_order(
    jsonb_build_object('service_mode', 'dine_in',
      'table_session_id', (select id from public.table_sessions where status = 'open'
                            and table_id = (select id from public.restaurant_tables where number = 6)),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
        'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
    '00000000-0000-0000-0000-0000000000a3'::uuid);
  perform tests.eq_int(
    (select unit_price_cents from public.order_items where order_id = v_order.id), 10200,
    'pedido novo usa o preço vigente (9900 + 300 do adicional)');
  perform tests.logout();

  -- volta o preço da fixture para as contas dos próximos arquivos
  perform tests.login('ana.admin');
  update public.product_variants set price_cents = 5000
   where product_id = v_fx.pizza_a and size_id = v_fx.size_g;
  perform tests.logout();
end
$$;

-- ------------------------------------------ 5) validações de montagem do item
do $$
declare
  v_fx record;
  v_session uuid;
  v_delivery jsonb;
begin
  select * into v_fx from tests.fx;
  select id into v_session from public.table_sessions where status = 'open'
    and table_id = (select id from public.restaurant_tables where number = 6);

  perform tests.login('carlos.caixa');

  -- sem itens
  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','dine_in','table_session_id',%L,'items','[]'::jsonb))$sql$, v_session),
    'ITEMS_REQUIRED', 'pedido sem itens é recusado');

  -- quantidade inválida
  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','dine_in','table_session_id',%L,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id',%L,'variant_id',%L,'quantity',0))))$sql$,
      v_session, v_fx.drink, v_fx.variant_drink_un),
    'INVALID_QUANTITY', 'quantidade zero é recusada');

  -- produto indisponível
  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','dine_in','table_session_id',%L,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id',%L,'variant_id',%L,'quantity',1))))$sql$,
      v_session, v_fx.unavailable, v_fx.variant_off_un),
    'PRODUCT_UNAVAILABLE', 'produto indisponível não entra em pedido');

  -- sabor não vendido no tamanho: o tamanho P do sabor B fica indisponível
  perform tests.logout();
  perform tests.login('ana.admin');
  update public.product_variants set is_available = false
   where product_id = v_fx.pizza_b and size_id = v_fx.size_p;
  perform tests.logout();
  perform tests.login('carlos.caixa');

  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','dine_in','table_session_id',%L,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id',%L,'variant_id',%L,'quantity',1,
        'flavor_product_ids', jsonb_build_array(%L,%L),
        'modifier_option_ids', jsonb_build_array(%L)))))$sql$,
      v_session, v_fx.pizza_a, (select id from public.product_variants
                                 where product_id = v_fx.pizza_a and size_id = v_fx.size_p),
      v_fx.pizza_a, v_fx.pizza_b, v_fx.opt_queijo),
    'FLAVOR_SIZE_UNAVAILABLE', 'sabor sem preço no tamanho escolhido é recusado');

  perform tests.logout();
  perform tests.login('ana.admin');
  update public.product_variants set is_available = true
   where product_id = v_fx.pizza_b and size_id = v_fx.size_p;
  perform tests.logout();
  perform tests.login('carlos.caixa');

  -- grupo de adicionais OBRIGATÓRIO sem escolha
  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','dine_in','table_session_id',%L,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id',%L,'variant_id',%L,'quantity',1))))$sql$,
      v_session, v_fx.pizza_a, v_fx.variant_a_g),
    'MODIFIER_REQUIRED', 'grupo obrigatório exige escolha');

  -- limite máximo de opções do grupo (Borda Teste aceita no máximo 1)
  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','dine_in','table_session_id',%L,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id',%L,'variant_id',%L,'quantity',1,
        'modifier_option_ids', jsonb_build_array(%L,%L,%L)))))$sql$,
      v_session, v_fx.pizza_a, v_fx.variant_a_g,
      v_fx.opt_catupiry, v_fx.opt_cheddar, v_fx.opt_queijo),
    'MODIFIER_LIMIT_EXCEEDED', 'limite máximo de adicionais por grupo é respeitado');

  -- adicional de um grupo que não pertence ao produto
  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','dine_in','table_session_id',%L,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id',%L,'variant_id',%L,'quantity',1,
        'modifier_option_ids', jsonb_build_array(%L)))))$sql$,
      v_session, v_fx.drink, v_fx.variant_drink_un, v_fx.opt_queijo),
    'MODIFIER_INVALID', 'adicional não vinculado ao produto é recusado');

  -- produto simples com sabor informado
  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','dine_in','table_session_id',%L,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id',%L,'variant_id',%L,'quantity',1,
        'flavor_product_ids', jsonb_build_array(%L)))))$sql$,
      v_session, v_fx.drink, v_fx.variant_drink_un, v_fx.pizza_b),
    'FLAVORS_NOT_ALLOWED', 'bebida não aceita divisão de sabores');

  -- pedido em mesa sem atendimento aberto
  perform tests.expect_error(
    format($sql$select public.create_order(jsonb_build_object(
      'service_mode','dine_in','table_session_id',%L,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id',%L,'variant_id',%L,'quantity',1))))$sql$,
      '00000000-0000-0000-0000-0000000000ff', v_fx.drink, v_fx.variant_drink_un),
    'TABLE_SESSION_NOT_FOUND', 'pedido exige atendimento aberto');

  perform tests.logout();

  -- -------- regra do meio a meio configurável pelo administrador --------
  perform tests.login('ana.admin');
  update public.business_settings set half_and_half_price_rule = 'average';
  perform tests.logout();

  perform tests.login('carlos.caixa');
  declare
    v_order public.orders;
  begin
    v_order := public.create_order(
      jsonb_build_object('service_mode', 'dine_in', 'table_session_id', v_session,
        'items', jsonb_build_array(jsonb_build_object(
          'product_id', v_fx.pizza_a, 'variant_id', v_fx.variant_a_g, 'quantity', 1,
          'flavor_product_ids', jsonb_build_array(v_fx.pizza_a, v_fx.pizza_b),
          'modifier_option_ids', jsonb_build_array(v_fx.opt_queijo)))),
      '00000000-0000-0000-0000-0000000000a4'::uuid);

    perform tests.eq_int(
      (select unit_base_price_cents from public.order_items where order_id = v_order.id), 4500,
      'regra "average" cobra a média dos sabores (5000 + 4000) / 2');
    perform tests.eq_text(
      (select pricing_rule from public.order_items where order_id = v_order.id), 'average',
      'regra usada fica registrada no item');
  end;
  perform tests.logout();

  perform tests.login('ana.admin');
  update public.business_settings set half_and_half_price_rule = 'highest';
  perform tests.logout();
end
$$;
