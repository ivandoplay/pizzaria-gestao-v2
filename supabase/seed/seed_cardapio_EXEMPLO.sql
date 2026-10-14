-- =============================================================================
-- CARDÁPIO DE EXEMPLO — DEMONSTRAÇÃO (aplicado a pedido do administrador)
--
-- NÃO é o cardápio real da casa: nomes, descrições e preços são fictícios e
-- servem para testar o sistema (pedidos, meio a meio, adicionais, delivery).
--
-- Para remover tudo de uma vez: supabase/seed/remove_cardapio_EXEMPLO.sql
-- (a remoção respeita o histórico: se já houver vendas, apenas desativa).
--
-- Idempotente: pode rodar mais de uma vez. Em uma segunda execução ele atualiza
-- descrições e preços dos itens de exemplo, sem tocar em disponibilidade nem
-- reativar o que o administrador tiver desativado.
-- =============================================================================

-- ---------------------------------------------------------------- 1) categorias
insert into public.categories (name, description, sort_order)
values
  ('Lanches', 'Hambúrgueres, sanduíches e cachorro-quente', 35),
  ('Porções', 'Porções para dividir', 36),
  ('Bebidas Alcoólicas', 'Cervejas e drinks', 37)
on conflict (lower(btrim(name))) do nothing;

-- ---------------------------------------------------------------- 2) tamanhos
-- Tamanho novo usado pelos combos de lanche (os demais já vêm do seed estrutural).
insert into public.product_sizes (code, name, kind, max_flavors, sort_order)
values ('COMBO', 'Combo (fritas + refrigerante lata)', 'other', 1, 25)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- 3) adicionais
insert into public.modifier_groups (name, description, min_select, max_select, sort_order)
values
  ('Adicionais do lanche', 'Extras para o seu lanche', 0, 5, 30),
  ('Molhos para porções',  'Molhos que acompanham a porção', 0, 3, 40)
on conflict (lower(btrim(name))) do nothing;

insert into public.modifier_options (group_id, name, price_cents, sort_order)
select g.id, o.nome, o.preco, o.ordem
from (values
  ('Borda recheada', 'Catupiry', 800, 10),
  ('Borda recheada', 'Cheddar', 800, 20),
  ('Borda recheada', 'Requeijão', 700, 30),
  ('Borda recheada', 'Cream Cheese', 900, 40),
  ('Borda recheada', 'Chocolate', 1000, 50),
  ('Borda recheada', 'Doce de Leite', 1000, 60),
  ('Adicionais extras', 'Bacon', 700, 10),
  ('Adicionais extras', 'Catupiry', 600, 20),
  ('Adicionais extras', 'Queijo extra', 500, 30),
  ('Adicionais extras', 'Calabresa', 600, 40),
  ('Adicionais extras', 'Frango desfiado', 700, 50),
  ('Adicionais extras', 'Cheddar', 500, 60),
  ('Adicionais extras', 'Azeitona', 300, 70),
  ('Adicionais extras', 'Cebola', 200, 80),
  ('Adicionais extras', 'Ovo', 300, 90),
  ('Adicionais extras', 'Milho', 300, 100),
  ('Adicionais extras', 'Palmito', 800, 110),
  ('Adicionais extras', 'Tomate', 250, 120),
  ('Adicionais extras', 'Pepperoni', 800, 130),
  ('Adicionais extras', 'Batata palha', 200, 140),
  ('Adicionais do lanche', 'Bacon', 600, 10),
  ('Adicionais do lanche', 'Cheddar extra', 400, 20),
  ('Adicionais do lanche', 'Ovo', 300, 30),
  ('Adicionais do lanche', 'Cebola caramelizada', 400, 40),
  ('Adicionais do lanche', 'Molho especial', 250, 50),
  ('Adicionais do lanche', 'Carne extra', 900, 60),
  ('Adicionais do lanche', 'Catupiry', 500, 70),
  ('Molhos para porções', 'Maionese da casa', 250, 10),
  ('Molhos para porções', 'Ketchup', 150, 20),
  ('Molhos para porções', 'Mostarda', 150, 30),
  ('Molhos para porções', 'Barbecue', 350, 40),
  ('Molhos para porções', 'Cheddar cremoso', 500, 50)) as o(grupo, nome, preco, ordem)
join public.modifier_groups g on lower(btrim(g.name)) = lower(btrim(o.grupo))
on conflict (group_id, lower(btrim(name))) do update set price_cents = excluded.price_cents;

-- ---------------------------------------------------------------- 4) produtos
create temp table tmp_pizzas (nome text, descricao text, ordem int, p int, m int, g int, gg int);
insert into tmp_pizzas values
  ('Margherita', 'Molho de tomate, mussarela, tomate e manjericão fresco', 10, 3500, 4500, 5500, 6500),
  ('Calabresa', 'Calabresa fatiada, cebola e mussarela', 20, 3200, 4200, 5200, 6200),
  ('Calabresa com Catupiry', 'Calabresa fatiada com catupiry original', 30, 3700, 4700, 5700, 6700),
  ('Portuguesa', 'Presunto, ovo, cebola, azeitona e mussarela', 40, 3600, 4600, 5600, 6600),
  ('Quatro Queijos', 'Mussarela, provolone, parmesão e catupiry', 50, 3900, 4900, 5900, 6900),
  ('Frango com Catupiry', 'Frango desfiado temperado com catupiry', 60, 3800, 4800, 5800, 6800),
  ('Frango com Cheddar', 'Frango desfiado com cheddar cremoso', 70, 3800, 4800, 5800, 6800),
  ('Pepperoni', 'Pepperoni levemente picante e mussarela', 80, 4000, 5000, 6000, 7000),
  ('Bacon Lovers', 'Bacon crocante, cheddar e cebola roxa', 90, 4100, 5100, 6100, 7100),
  ('Palmito', 'Palmito em rodelas, mussarela e orégano', 100, 3700, 4700, 5700, 6700),
  ('Vegetariana', 'Abobrinha, berinjela, pimentão, cebola e tomate', 110, 3400, 4400, 5400, 6400),
  ('Atum', 'Atum, cebola e azeitona', 120, 3800, 4800, 5800, 6800),
  ('Camarão', 'Camarão refogado, catupiry e cebolinha', 130, 4900, 5900, 6900, 7900),
  ('Nordestina', 'Carne de sol, queijo coalho e cebola', 140, 4300, 5300, 6300, 7300),
  ('Chocolate', 'Chocolate ao leite derretido', 150, 3200, 4200, 5200, 6200),
  ('Chocolate com Morango', 'Chocolate ao leite e morango fresco', 160, 3600, 4600, 5600, 6600),
  ('Romeu e Julieta', 'Goiabada cremosa com queijo mussarela', 170, 3200, 4200, 5200, 6200),
  ('Banana com Canela', 'Banana, canela e leite condensado', 180, 3000, 4000, 5000, 6000),
  ('Prestígio', 'Chocolate, coco e leite condensado', 190, 3500, 4500, 5500, 6500);

create temp table tmp_simples (categoria text, nome text, descricao text, tamanho text, preco int);
insert into tmp_simples values
  ('Bebidas', 'Água Mineral sem Gás 500ml', 'Garrafa 500ml', 'UN', 300),
  ('Bebidas', 'Água Mineral com Gás 500ml', 'Garrafa 500ml', 'UN', 350),
  ('Bebidas', 'Coca-Cola Lata 350ml', 'Refrigerante gelado', 'LAT', 600),
  ('Bebidas', 'Coca-Cola Zero Lata 350ml', 'Sem açúcar', 'LAT', 600),
  ('Bebidas', 'Coca-Cola 600ml', 'Garrafa 600ml', 'GAR', 850),
  ('Bebidas', 'Coca-Cola 1L', 'Garrafa 1 litro', 'GAR1', 1100),
  ('Bebidas', 'Coca-Cola 2L', 'Garrafa 2 litros', 'GAR2', 1400),
  ('Bebidas', 'Guaraná Antarctica Lata 350ml', 'Refrigerante gelado', 'LAT', 550),
  ('Bebidas', 'Guaraná Antarctica 2L', 'Garrafa 2 litros', 'GAR2', 1250),
  ('Bebidas', 'Fanta Laranja Lata 350ml', 'Refrigerante gelado', 'LAT', 550),
  ('Bebidas', 'Sprite Lata 350ml', 'Refrigerante gelado', 'LAT', 550),
  ('Bebidas', 'Suco de Laranja 500ml', 'Feito na hora', 'UN', 900),
  ('Bebidas', 'Suco de Maracujá 500ml', 'Feito na hora', 'UN', 900),
  ('Bebidas', 'Suco de Acerola 500ml', 'Feito na hora', 'UN', 850),
  ('Bebidas', 'Suco de Abacaxi com Hortelã 500ml', 'Feito na hora', 'UN', 900),
  ('Bebidas', 'H2O Limão 500ml', 'Água saborizada', 'UN', 750),
  ('Bebidas', 'Energético 250ml', 'Lata gelada', 'UN', 1300),
  ('Bebidas', 'Café Expresso', 'Xícara pequena', 'UN', 500),
  ('Bebidas', 'Chá Gelado de Limão 300ml', 'Copo 300ml', 'UN', 650),
  ('Bebidas Alcoólicas', 'Cerveja Pilsen Lata 350ml', 'Gelada', 'LAT', 750),
  ('Bebidas Alcoólicas', 'Cerveja Pilsen Long Neck 355ml', 'Gelada', 'UN', 1100),
  ('Bebidas Alcoólicas', 'Cerveja Pilsen Garrafa 600ml', 'Gelada', 'GAR', 1300),
  ('Bebidas Alcoólicas', 'Cerveja Puro Malte Long Neck', 'Gelada', 'UN', 1400),
  ('Bebidas Alcoólicas', 'Caipirinha de Limão', 'Dose generosa, feita na hora', 'UN', 1900),
  ('Bebidas Alcoólicas', 'Caipiroska de Morango', 'Feita na hora', 'UN', 2100),
  ('Bebidas Alcoólicas', 'Dose de Whisky 50ml', 'Servida com gelo', 'UN', 1600),
  ('Bebidas Alcoólicas', 'Taça de Vinho Tinto', 'Taça 150ml', 'UN', 1800),
  ('Porções', 'Batata Frita Simples', 'Porção individual para dividir', 'POR', 2200),
  ('Porções', 'Batata Frita com Cheddar e Bacon', 'Coberta com cheddar e bacon', 'POR', 3400),
  ('Porções', 'Frango a Passarinho', 'Com alho frito e limão', 'POR', 3900),
  ('Porções', 'Calabresa Acebolada', 'Com pão e vinagrete', 'POR', 3500),
  ('Porções', 'Polenta Frita', 'Crocante por fora, cremosa por dentro', 'POR', 2400),
  ('Porções', 'Onion Rings', 'Anéis de cebola empanados', 'POR', 2700),
  ('Porções', 'Nuggets de Frango (10 un)', 'Com molho da casa', 'POR', 2600),
  ('Porções', 'Torresmo Crocante', 'Feito na hora', 'POR', 2900),
  ('Porções', 'Bolinho de Queijo (8 un)', 'Empanado e crocante', 'POR', 2500),
  ('Sobremesas', 'Pudim de Leite Condensado', 'Fatia generosa', 'SOB', 1200),
  ('Sobremesas', 'Petit Gateau com Sorvete', 'Bolo quente com sorvete de creme', 'SOB', 2400),
  ('Sobremesas', 'Mousse de Maracujá', 'Copo individual', 'SOB', 1300),
  ('Sobremesas', 'Açaí 300ml com Granola', 'Copo 300ml', 'SOB', 1600),
  ('Sobremesas', 'Sorvete 2 Bolas', 'Sabores variados', 'SOB', 1200),
  ('Sobremesas', 'Torta de Limão', 'Fatia', 'SOB', 1700);

create temp table tmp_lanches (nome text, descricao text, ordem int, preco int, preco_combo int);
insert into tmp_lanches values
  ('X-Burguer', 'Pão, carne, queijo e molho da casa', 10, 2200, 2900),
  ('X-Salada', 'Alface, tomate, milho e maionese', 20, 2400, 3100),
  ('X-Bacon', 'Carne, bacon crocante e cheddar', 30, 2800, 3500),
  ('X-Egg', 'Carne, queijo, ovo e molho da casa', 40, 2500, 3200),
  ('X-Frango', 'Frango grelhado com catupiry', 50, 2700, 3400),
  ('X-Calabresa', 'Calabresa fatiada, queijo e cebola', 60, 2700, 3400),
  ('X-Tudo', 'Carne, bacon, ovo, presunto, milho e batata palha', 70, 3300, 3900),
  ('Hambúrguer Artesanal 180g', 'Blend bovino, cheddar e cebola caramelizada', 80, 3200, 3800),
  ('Misto Quente', 'Presunto e queijo na chapa', 90, 1600, null),
  ('Cachorro-quente', 'Salsicha, purê, milho, vinagrete e batata palha', 100, 1800, 2400),
  ('Sanduíche Natural de Frango', 'Pão integral, frango e salada', 110, 1500, null);

-- pizzas (aceitam 1 ou 2 sabores; a categoria decide o grupo de adicionais)
insert into public.products (category_id, name, description, kind, sort_order)
select c.id, t.nome, t.descricao, 'pizza', t.ordem
from tmp_pizzas t
join public.categories c on lower(btrim(c.name)) in ('pizzas salgadas', 'pizzas doces')
where (lower(btrim(c.name)) = 'pizzas salgadas' and t.nome in ('Margherita', 'Calabresa', 'Calabresa com Catupiry', 'Portuguesa', 'Quatro Queijos',
    'Frango com Catupiry', 'Frango com Cheddar', 'Pepperoni', 'Bacon Lovers', 'Palmito',
    'Vegetariana', 'Atum', 'Camarão', 'Nordestina'))
   or (lower(btrim(c.name)) = 'pizzas doces'    and t.nome in ('Chocolate', 'Chocolate com Morango', 'Romeu e Julieta', 'Banana com Canela', 'Prestígio'))
on conflict (category_id, lower(btrim(name))) do update set description = excluded.description;

insert into public.product_variants (product_id, size_id, price_cents)
select p.id, s.id,
       case s.code when 'P' then t.p when 'M' then t.m when 'G' then t.g else t.gg end
from tmp_pizzas t
join public.products p on lower(btrim(p.name)) = lower(btrim(t.nome)) and p.kind = 'pizza'
join public.product_sizes s on s.code in ('P', 'M', 'G', 'GG')
on conflict (product_id, size_id) do update set price_cents = excluded.price_cents;

-- itens simples (bebidas, porções, sobremesas)
insert into public.products (category_id, name, description, kind, sort_order)
select distinct c.id, s.nome, s.descricao, 'simple', 100
from tmp_simples s
join public.categories c on lower(btrim(c.name)) = lower(btrim(s.categoria))
on conflict (category_id, lower(btrim(name))) do update set description = excluded.description;

insert into public.product_variants (product_id, size_id, price_cents)
select p.id, sz.id, s.preco
from tmp_simples s
join public.categories c on lower(btrim(c.name)) = lower(btrim(s.categoria))
join public.products p on p.category_id = c.id and lower(btrim(p.name)) = lower(btrim(s.nome))
join public.product_sizes sz on sz.code = s.tamanho
on conflict (product_id, size_id) do update set price_cents = excluded.price_cents;

-- lanches (avulso e combo)
insert into public.products (category_id, name, description, kind, sort_order)
select c.id, t.nome, t.descricao, 'simple', t.ordem
from tmp_lanches t
join public.categories c on lower(btrim(c.name)) = 'lanches'
on conflict (category_id, lower(btrim(name))) do update set description = excluded.description;

insert into public.product_variants (product_id, size_id, price_cents)
select p.id, sz.id, v.preco
from tmp_lanches t
join public.categories c on lower(btrim(c.name)) = 'lanches'
join public.products p on p.category_id = c.id and lower(btrim(p.name)) = lower(btrim(t.nome))
cross join lateral (values ('UN', t.preco), ('COMBO', t.preco_combo)) as v(codigo, preco)
join public.product_sizes sz on sz.code = v.codigo
where v.preco is not null
on conflict (product_id, size_id) do update set price_cents = excluded.price_cents;

-- --------------------------------------------- 5) quais adicionais cada item aceita
insert into public.product_modifier_groups (product_id, group_id, sort_order)
select p.id, g.id, g.sort_order
from public.products p
join public.modifier_groups g on lower(btrim(g.name)) in ('borda recheada', 'adicionais extras')
where p.kind = 'pizza'
on conflict do nothing;

insert into public.product_modifier_groups (product_id, group_id, sort_order)
select p.id, g.id, g.sort_order
from public.products p
join public.categories c on c.id = p.category_id
join public.modifier_groups g on lower(btrim(g.name)) = 'adicionais do lanche'
where lower(btrim(c.name)) = 'lanches'
on conflict do nothing;

insert into public.product_modifier_groups (product_id, group_id, sort_order)
select p.id, g.id, g.sort_order
from public.products p
join public.categories c on c.id = p.category_id
join public.modifier_groups g on lower(btrim(g.name)) = 'molhos para porções'
where lower(btrim(c.name)) = 'porções'
on conflict do nothing;

-- ---------------------------------------------------------------- 6) delivery
insert into public.delivery_fee_zones (neighborhood, fee_cents)
values
  ('Centro', 500),
  ('Fátima', 600),
  ('Jóquei', 700),
  ('São Cristóvão', 800),
  ('Morada do Sol', 900),
  ('Parque Piauí', 900),
  ('Promorar', 1000),
  ('Dirceu Arcoverde', 1200)
on conflict (lower(btrim(neighborhood))) do update set fee_cents = excluded.fee_cents, is_active = true;

-- taxa padrão para bairros sem zona cadastrada (só define se ainda estiver zerada)
update public.business_settings
   set default_delivery_fee_cents = 700
 where default_delivery_fee_cents = 0;

-- ---------------------------------------------------------------- 7) resumo
select jsonb_pretty(jsonb_build_object(
  'categorias',  (select count(*) from public.categories where is_active),
  'itens',       (select count(*) from public.products where is_active),
  'precos',      (select count(*) from public.product_variants where is_available),
  'adicionais',  (select count(*) from public.modifier_options where is_available),
  'bairros',     (select count(*) from public.delivery_fee_zones where is_active)
)) as cardapio_de_exemplo;
