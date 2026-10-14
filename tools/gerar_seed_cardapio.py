#!/usr/bin/env python3
"""
Gera os dois scripts SQL do cardápio de exemplo:

  supabase/seed/seed_cardapio_EXEMPLO.sql    -> cria categorias, tamanhos, itens, adicionais e bairros
  supabase/seed/remove_cardapio_EXEMPLO.sql  -> remove exatamente o que o seed criou

Os dois saem da MESMA lista de dados, então nunca ficam desencontrados.
Uso:  python3 tools/gerar_seed_cardapio.py
"""
import pathlib

# ------------------------------------------------------------------ dados
PIZZAS_SALGADAS = [
    # (nome, descrição, P, M, G, GG) — valores em centavos
    ("Margherita", "Molho de tomate, mussarela, tomate e manjericão fresco", 3500, 4500, 5500, 6500),
    ("Calabresa", "Calabresa fatiada, cebola e mussarela", 3200, 4200, 5200, 6200),
    ("Calabresa com Catupiry", "Calabresa fatiada com catupiry original", 3700, 4700, 5700, 6700),
    ("Portuguesa", "Presunto, ovo, cebola, azeitona e mussarela", 3600, 4600, 5600, 6600),
    ("Quatro Queijos", "Mussarela, provolone, parmesão e catupiry", 3900, 4900, 5900, 6900),
    ("Frango com Catupiry", "Frango desfiado temperado com catupiry", 3800, 4800, 5800, 6800),
    ("Frango com Cheddar", "Frango desfiado com cheddar cremoso", 3800, 4800, 5800, 6800),
    ("Pepperoni", "Pepperoni levemente picante e mussarela", 4000, 5000, 6000, 7000),
    ("Bacon Lovers", "Bacon crocante, cheddar e cebola roxa", 4100, 5100, 6100, 7100),
    ("Palmito", "Palmito em rodelas, mussarela e orégano", 3700, 4700, 5700, 6700),
    ("Vegetariana", "Abobrinha, berinjela, pimentão, cebola e tomate", 3400, 4400, 5400, 6400),
    ("Atum", "Atum, cebola e azeitona", 3800, 4800, 5800, 6800),
    ("Camarão", "Camarão refogado, catupiry e cebolinha", 4900, 5900, 6900, 7900),
    ("Nordestina", "Carne de sol, queijo coalho e cebola", 4300, 5300, 6300, 7300),
]

PIZZAS_DOCES = [
    ("Chocolate", "Chocolate ao leite derretido", 3200, 4200, 5200, 6200),
    ("Chocolate com Morango", "Chocolate ao leite e morango fresco", 3600, 4600, 5600, 6600),
    ("Romeu e Julieta", "Goiabada cremosa com queijo mussarela", 3200, 4200, 5200, 6200),
    ("Banana com Canela", "Banana, canela e leite condensado", 3000, 4000, 5000, 6000),
    ("Prestígio", "Chocolate, coco e leite condensado", 3500, 4500, 5500, 6500),
]

# (categoria, nome, descrição, tamanho, preço)
SIMPLES = [
    # ---------------- bebidas
    ("Bebidas", "Água Mineral sem Gás 500ml", "Garrafa 500ml", "UN", 300),
    ("Bebidas", "Água Mineral com Gás 500ml", "Garrafa 500ml", "UN", 350),
    ("Bebidas", "Coca-Cola Lata 350ml", "Refrigerante gelado", "LAT", 600),
    ("Bebidas", "Coca-Cola Zero Lata 350ml", "Sem açúcar", "LAT", 600),
    ("Bebidas", "Coca-Cola 600ml", "Garrafa 600ml", "GAR", 850),
    ("Bebidas", "Coca-Cola 1L", "Garrafa 1 litro", "GAR1", 1100),
    ("Bebidas", "Coca-Cola 2L", "Garrafa 2 litros", "GAR2", 1400),
    ("Bebidas", "Guaraná Antarctica Lata 350ml", "Refrigerante gelado", "LAT", 550),
    ("Bebidas", "Guaraná Antarctica 2L", "Garrafa 2 litros", "GAR2", 1250),
    ("Bebidas", "Fanta Laranja Lata 350ml", "Refrigerante gelado", "LAT", 550),
    ("Bebidas", "Sprite Lata 350ml", "Refrigerante gelado", "LAT", 550),
    ("Bebidas", "Suco de Laranja 500ml", "Feito na hora", "UN", 900),
    ("Bebidas", "Suco de Maracujá 500ml", "Feito na hora", "UN", 900),
    ("Bebidas", "Suco de Acerola 500ml", "Feito na hora", "UN", 850),
    ("Bebidas", "Suco de Abacaxi com Hortelã 500ml", "Feito na hora", "UN", 900),
    ("Bebidas", "H2O Limão 500ml", "Água saborizada", "UN", 750),
    ("Bebidas", "Energético 250ml", "Lata gelada", "UN", 1300),
    ("Bebidas", "Café Expresso", "Xícara pequena", "UN", 500),
    ("Bebidas", "Chá Gelado de Limão 300ml", "Copo 300ml", "UN", 650),
    # ---------------- bebidas alcoólicas
    ("Bebidas Alcoólicas", "Cerveja Pilsen Lata 350ml", "Gelada", "LAT", 750),
    ("Bebidas Alcoólicas", "Cerveja Pilsen Long Neck 355ml", "Gelada", "UN", 1100),
    ("Bebidas Alcoólicas", "Cerveja Pilsen Garrafa 600ml", "Gelada", "GAR", 1300),
    ("Bebidas Alcoólicas", "Cerveja Puro Malte Long Neck", "Gelada", "UN", 1400),
    ("Bebidas Alcoólicas", "Caipirinha de Limão", "Dose generosa, feita na hora", "UN", 1900),
    ("Bebidas Alcoólicas", "Caipiroska de Morango", "Feita na hora", "UN", 2100),
    ("Bebidas Alcoólicas", "Dose de Whisky 50ml", "Servida com gelo", "UN", 1600),
    ("Bebidas Alcoólicas", "Taça de Vinho Tinto", "Taça 150ml", "UN", 1800),
    # ---------------- porções
    ("Porções", "Batata Frita Simples", "Porção individual para dividir", "POR", 2200),
    ("Porções", "Batata Frita com Cheddar e Bacon", "Coberta com cheddar e bacon", "POR", 3400),
    ("Porções", "Frango a Passarinho", "Com alho frito e limão", "POR", 3900),
    ("Porções", "Calabresa Acebolada", "Com pão e vinagrete", "POR", 3500),
    ("Porções", "Polenta Frita", "Crocante por fora, cremosa por dentro", "POR", 2400),
    ("Porções", "Onion Rings", "Anéis de cebola empanados", "POR", 2700),
    ("Porções", "Nuggets de Frango (10 un)", "Com molho da casa", "POR", 2600),
    ("Porções", "Torresmo Crocante", "Feito na hora", "POR", 2900),
    ("Porções", "Bolinho de Queijo (8 un)", "Empanado e crocante", "POR", 2500),
    # ---------------- sobremesas
    ("Sobremesas", "Pudim de Leite Condensado", "Fatia generosa", "SOB", 1200),
    ("Sobremesas", "Petit Gateau com Sorvete", "Bolo quente com sorvete de creme", "SOB", 2400),
    ("Sobremesas", "Mousse de Maracujá", "Copo individual", "SOB", 1300),
    ("Sobremesas", "Açaí 300ml com Granola", "Copo 300ml", "SOB", 1600),
    ("Sobremesas", "Sorvete 2 Bolas", "Sabores variados", "SOB", 1200),
    ("Sobremesas", "Torta de Limão", "Fatia", "SOB", 1700),
]

# (nome, descrição, preço avulso, preço combo) — combo = fritas + refrigerante lata
LANCHES = [
    ("X-Burguer", "Pão, carne, queijo e molho da casa", 2200, 2900),
    ("X-Salada", "Alface, tomate, milho e maionese", 2400, 3100),
    ("X-Bacon", "Carne, bacon crocante e cheddar", 2800, 3500),
    ("X-Egg", "Carne, queijo, ovo e molho da casa", 2500, 3200),
    ("X-Frango", "Frango grelhado com catupiry", 2700, 3400),
    ("X-Calabresa", "Calabresa fatiada, queijo e cebola", 2700, 3400),
    ("X-Tudo", "Carne, bacon, ovo, presunto, milho e batata palha", 3300, 3900),
    ("Hambúrguer Artesanal 180g", "Blend bovino, cheddar e cebola caramelizada", 3200, 3800),
    ("Misto Quente", "Presunto e queijo na chapa", 1600, None),
    ("Cachorro-quente", "Salsicha, purê, milho, vinagrete e batata palha", 1800, 2400),
    ("Sanduíche Natural de Frango", "Pão integral, frango e salada", 1500, None),
]

# (grupo, opção, preço)
ADICIONAIS = {
    "Borda recheada": [
        ("Catupiry", 800), ("Cheddar", 800), ("Requeijão", 700),
        ("Cream Cheese", 900), ("Chocolate", 1000), ("Doce de Leite", 1000),
    ],
    "Adicionais extras": [
        ("Bacon", 700), ("Catupiry", 600), ("Queijo extra", 500), ("Calabresa", 600),
        ("Frango desfiado", 700), ("Cheddar", 500), ("Azeitona", 300), ("Cebola", 200),
        ("Ovo", 300), ("Milho", 300), ("Palmito", 800), ("Tomate", 250),
        ("Pepperoni", 800), ("Batata palha", 200),
    ],
    "Adicionais do lanche": [
        ("Bacon", 600), ("Cheddar extra", 400), ("Ovo", 300), ("Cebola caramelizada", 400),
        ("Molho especial", 250), ("Carne extra", 900), ("Catupiry", 500),
    ],
    "Molhos para porções": [
        ("Maionese da casa", 250), ("Ketchup", 150), ("Mostarda", 150),
        ("Barbecue", 350), ("Cheddar cremoso", 500),
    ],
}

BAIRROS = [
    ("Centro", 500), ("Fátima", 600), ("Jóquei", 700), ("São Cristóvão", 800),
    ("Morada do Sol", 900), ("Parque Piauí", 900), ("Promorar", 1000), ("Dirceu Arcoverde", 1200),
]

CATEGORIAS_NOVAS = [
    ("Lanches", "Hambúrgueres, sanduíches e cachorro-quente", 35),
    ("Porções", "Porções para dividir", 36),
    ("Bebidas Alcoólicas", "Cervejas e drinks", 37),
]

# nomes de produtos que o seed cria (usados na remoção)
NOMES_PRODUTOS = (
    [p[0] for p in PIZZAS_SALGADAS] + [p[0] for p in PIZZAS_DOCES]
    + [s[1] for s in SIMPLES] + [l[0] for l in LANCHES]
)

def linhas_valores(valores, indent="      "):
    """Uma linha por valor: ('Nome'), ('Nome'), ... — para INSERT ... VALUES (col)."""
    linhas, atual = [], ""
    for valor in valores:
        item = "('" + valor.replace("'", "''") + "'), "
        if len(atual) + len(item) > 92:
            linhas.append(atual.rstrip())
            atual = ""
        atual += item
    if atual:
        linhas.append(atual.rstrip().rstrip(","))
    return ("\n" + indent).join(linhas)


def lista_sql(valores, aspas=True, indent="    "):
    itens = [f"'{v}'" if aspas else str(v) for v in valores]
    linhas, atual = [], ""
    for item in itens:
        if len(atual) + len(item) + 2 > 96:
            linhas.append(atual.rstrip()); atual = ""
        atual += item + ", "
    if atual:
        linhas.append(atual.rstrip().rstrip(","))
    return ("\n" + indent).join(linhas)

# ------------------------------------------------------------------ seed
seed = f"""-- =============================================================================
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
{chr(10).join(f"  ('{c}', '{d}', {o})," for c, d, o in CATEGORIAS_NOVAS)[:-1]}
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
{chr(10).join(
    "  (" + ", ".join(f"'{g}'" for g in [grupo]) + ", " + f"'{nome}', {preco}, {i*10}),"
    for grupo, itens in ADICIONAIS.items() for i, (nome, preco) in enumerate(itens, start=1)
)[:-1]}) as o(grupo, nome, preco, ordem)
join public.modifier_groups g on lower(btrim(g.name)) = lower(btrim(o.grupo))
on conflict (group_id, lower(btrim(name))) do update set price_cents = excluded.price_cents;

-- ---------------------------------------------------------------- 4) produtos
create temp table tmp_pizzas (nome text, descricao text, ordem int, p int, m int, g int, gg int);
insert into tmp_pizzas values
{chr(10).join(f"  ('{n}', '{d}', {i*10}, {p}, {m}, {g}, {gg})," for i, (n, d, p, m, g, gg) in enumerate(PIZZAS_SALGADAS + PIZZAS_DOCES, start=1))[:-1]};

create temp table tmp_simples (categoria text, nome text, descricao text, tamanho text, preco int);
insert into tmp_simples values
{chr(10).join(f"  ('{c}', '{n}', '{d}', '{t}', {p})," for c, n, d, t, p in SIMPLES)[:-1]};

create temp table tmp_lanches (nome text, descricao text, ordem int, preco int, preco_combo int);
insert into tmp_lanches values
{chr(10).join(f"  ('{n}', '{d}', {i*10}, {p}, {c if c is not None else 'null'})," for i, (n, d, p, c) in enumerate(LANCHES, start=1))[:-1]};

-- pizzas (aceitam 1 ou 2 sabores; a categoria decide o grupo de adicionais)
insert into public.products (category_id, name, description, kind, sort_order)
select c.id, t.nome, t.descricao, 'pizza', t.ordem
from tmp_pizzas t
join public.categories c on lower(btrim(c.name)) in ('pizzas salgadas', 'pizzas doces')
where (lower(btrim(c.name)) = 'pizzas salgadas' and t.nome in ({lista_sql([p[0] for p in PIZZAS_SALGADAS])}))
   or (lower(btrim(c.name)) = 'pizzas doces'    and t.nome in ({lista_sql([p[0] for p in PIZZAS_DOCES])}))
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
{chr(10).join(f"  ('{b}', {f})," for b, f in BAIRROS)[:-1]}
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
"""

# ------------------------------------------------------------------ remoção
remocao = f"""-- =============================================================================
-- REMOÇÃO DO CARDÁPIO DE EXEMPLO
--
-- Apaga exatamente os itens criados por supabase/seed/seed_cardapio_EXEMPLO.sql
-- (lista de nomes idêntica à do seed) e os bairros de exemplo.
--
-- REGRA DE OURO: nada com histórico é apagado. Se algum desses itens já tiver
-- sido usado em pedidos, o script NÃO apaga — apenas desativa (is_active=false,
-- is_available=false), preservando os pedidos e os relatórios. Ele informa no
-- final o que fez.
--
-- Ao final, confira na tela Configurações a taxa de entrega padrão (o exemplo
-- define R$ 7,00 quando ela estava zerada) e ajuste para o valor real.
-- =============================================================================

do $$
declare
  v_usados    integer;
  v_apagados  integer;
  v_desativados integer;
begin
  create temp table tmp_nomes_exemplo (nome text) on commit drop;
  insert into tmp_nomes_exemplo (nome) values
{linhas_valores(NOMES_PRODUTOS)};

  -- quantos itens de exemplo já aparecem em pedidos?
  select count(distinct oi.product_id) into v_usados
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where lower(btrim(p.name)) in (select lower(btrim(nome)) from tmp_nomes_exemplo);

  if v_usados > 0 then
    update public.product_variants v
       set is_available = false
     where v.product_id in (select p.id from public.products p
                             where lower(btrim(p.name)) in (select lower(btrim(nome)) from tmp_nomes_exemplo));
    get diagnostics v_desativados = row_count;

    update public.products p
       set is_available = false, is_active = false
     where lower(btrim(p.name)) in (select lower(btrim(nome)) from tmp_nomes_exemplo);

    update public.delivery_fee_zones
       set is_active = false
     where lower(btrim(neighborhood)) in ({lista_sql([b[0].lower() for b in BAIRROS])});

    raise notice 'cardápio de exemplo: % item(ns) já tinham pedidos -> apenas desativados (% variações). Nada foi apagado.', v_usados, v_desativados;
  else
    delete from public.product_modifier_groups
     where product_id in (select p.id from public.products p
                           where lower(btrim(p.name)) in (select lower(btrim(nome)) from tmp_nomes_exemplo));

    delete from public.product_variants
     where product_id in (select p.id from public.products p
                           where lower(btrim(p.name)) in (select lower(btrim(nome)) from tmp_nomes_exemplo));

    delete from public.products
     where lower(btrim(name)) in (select lower(btrim(nome)) from tmp_nomes_exemplo);
    get diagnostics v_apagados = row_count;

    -- adicionais (só os do exemplo; grupos novos caem fora se ficarem vazios)
    delete from public.modifier_options
     where group_id in (select id from public.modifier_groups
                         where lower(btrim(name)) in ('borda recheada', 'adicionais extras',
                                                      'adicionais do lanche', 'molhos para porções'));
    delete from public.modifier_groups g
     where lower(btrim(g.name)) in ('adicionais do lanche', 'molhos para porções')
       and not exists (select 1 from public.product_modifier_groups x where x.group_id = g.id);

    delete from public.delivery_fee_zones
     where lower(btrim(neighborhood)) in ({lista_sql([b[0].lower() for b in BAIRROS])});

    -- categorias criadas pelo exemplo (só saem se estiverem vazias)
    delete from public.categories c
     where lower(btrim(c.name)) in ('lanches', 'porções', 'bebidas alcoólicas')
       and not exists (select 1 from public.products p where p.category_id = c.id);

    -- tamanho de combo (só sai se ninguém estiver usando)
    delete from public.product_sizes s
     where s.code = 'COMBO'
       and not exists (select 1 from public.product_variants v where v.size_id = s.id);

    raise notice 'cardápio de exemplo: % item(ns) apagado(s) (nenhum tinha pedidos).', v_apagados;
  end if;

  raise notice 'para conferir: select count(*) from public.products where is_active;';
end $$;
"""

base = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "seed"
(base / "seed_cardapio_EXEMPLO.sql").write_text(seed, encoding="utf-8")
(base / "remove_cardapio_EXEMPLO.sql").write_text(remocao, encoding="utf-8")
print(f"gerados: {len(NOMES_PRODUTOS)} produtos, "
      f"{sum(len(v) for v in ADICIONAIS.values())} adicionais, {len(BAIRROS)} bairros")
