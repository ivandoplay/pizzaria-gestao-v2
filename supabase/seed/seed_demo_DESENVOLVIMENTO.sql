-- =============================================================================
-- SEED DE DEMONSTRAÇÃO — USAR SOMENTE EM DESENVOLVIMENTO/TESTE
--
-- ATENÇÃO (seção 5 do prompt mestre):
--   * Todo registro criado aqui é prefixado com "[DEMO]" e NUNCA deve ser
--     aplicado em produção.
--   * Estes produtos são fictícios; preços fictícios; NÃO misture com vendas reais.
--   * Este arquivo NÃO é uma migração: é uma carga manual opcional.
--
-- Pré-requisito: executar antes o seed estrutural (supabase/seed/seed_structure.sql).
-- =============================================================================

do $seed$
declare
  v_pizza_cat uuid;
  v_drink_cat uuid;
  v_dessert_cat uuid;
  v_pizza_ids uuid[];
  v_borda uuid;
  v_adicionais uuid;
begin
  select id into v_pizza_cat    from public.categories where name = 'Pizzas Salgadas';
  select id into v_drink_cat    from public.categories where name = 'Bebidas';
  select id into v_dessert_cat  from public.categories where name = 'Sobremesas';
  select id into v_borda        from public.modifier_groups where name = 'Borda recheada';
  select id into v_adicionais   from public.modifier_groups where name = 'Adicionais extras';

  -- ---------- sabores demo (pizzas) ----------
  v_pizza_ids := '{}';

  insert into public.products (category_id, name, description, kind, sort_order)
  values
    (v_pizza_cat, '[DEMO] Calabresa',  'Calabresa fatiada, cebola e orégano', 'pizza', 10),
    (v_pizza_cat, '[DEMO] Marguerita', 'Molho, mussarela, tomate e manjericão', 'pizza', 20),
    (v_pizza_cat, '[DEMO] Portuguesa', 'Presunto, ovos, cebola, azeitona e ervilha', 'pizza', 30),
    (v_pizza_cat, '[DEMO] Quatro Queijos', 'Mussarela, provolone, parmesão e catupiry', 'pizza', 40)
  on conflict do nothing;

  insert into public.product_variants (product_id, size_id, price_cents)
  select p.id, s.id, case s.code when 'P' then 2500 when 'M' then 3200 when 'G' then 4200 else 5200 end
  from public.products p
  join public.product_sizes s on s.kind = 'pizza'
  where p.name like '[DEMO]%'
  on conflict (product_id, size_id) do nothing;

  -- ---------- bebidas demo ----------
  insert into public.products (category_id, name, description, kind, sort_order)
  values
    (v_drink_cat, '[DEMO] Refrigerante Cola', 'Refrigerante sabor cola', 'simple', 10),
    (v_drink_cat, '[DEMO] Água Mineral', 'Água mineral sem gás', 'simple', 20),
    (v_drink_cat, '[DEMO] Suco de Laranja', 'Suco natural', 'simple', 30)
  on conflict do nothing;

  insert into public.product_variants (product_id, size_id, price_cents)
  select p.id, s.id, case
      when p.name like '%Água%' then 400
      when s.code = 'LAT' then 700
      when s.code = 'GAR' then 1000
      when s.code = 'GAR2' then 1600
      when s.code = 'UN' then 800
      else 900 end
  from public.products p
  join public.product_sizes s on s.code in ('UN', 'LAT', 'GAR', 'GAR2')
  where p.category_id = v_drink_cat and p.name like '[DEMO]%'
  on conflict (product_id, size_id) do nothing;

  -- ---------- sobremesa demo ----------
  insert into public.products (category_id, name, description, kind, sort_order)
  values (v_dessert_cat, '[DEMO] Petit Gâteau', 'Bolo quente com sorvete', 'simple', 10)
  on conflict do nothing;

  insert into public.product_variants (product_id, size_id, price_cents)
  select p.id, s.id, 1800
  from public.products p
  join public.product_sizes s on s.code = 'SOB'
  where p.category_id = v_dessert_cat and p.name like '[DEMO]%'
  on conflict (product_id, size_id) do nothing;

  -- ---------- adicionais demo ----------
  insert into public.modifier_options (group_id, name, price_cents, sort_order)
  values
    (v_borda, '[DEMO] Catupiry', 800, 10),
    (v_borda, '[DEMO] Cheddar',  800, 20),
    (v_borda, '[DEMO] Chocolate', 900, 30)
  on conflict do nothing;

  insert into public.modifier_options (group_id, name, price_cents, sort_order)
  values
    (v_adicionais, '[DEMO] Bacon', 700, 10),
    (v_adicionais, '[DEMO] Queijo extra', 600, 20),
    (v_adicionais, '[DEMO] Azeitona', 300, 30)
  on conflict do nothing;

  -- ---------- vincular adicionais aos sabores demo ----------
  insert into public.product_modifier_groups (product_id, group_id, sort_order)
  select p.id, g.id, 10
  from public.products p
  cross join (values (v_borda), (v_adicionais)) as g(id)
  where p.name like '[DEMO]%' and p.kind = 'pizza'
  on conflict (product_id, group_id) do nothing;
end
$seed$;
