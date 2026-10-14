-- =============================================================================
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
('Margherita'), ('Calabresa'), ('Calabresa com Catupiry'), ('Portuguesa'),
      ('Quatro Queijos'), ('Frango com Catupiry'), ('Frango com Cheddar'), ('Pepperoni'),
      ('Bacon Lovers'), ('Palmito'), ('Vegetariana'), ('Atum'), ('Camarão'), ('Nordestina'),
      ('Chocolate'), ('Chocolate com Morango'), ('Romeu e Julieta'), ('Banana com Canela'),
      ('Prestígio'), ('Água Mineral sem Gás 500ml'), ('Água Mineral com Gás 500ml'),
      ('Coca-Cola Lata 350ml'), ('Coca-Cola Zero Lata 350ml'), ('Coca-Cola 600ml'),
      ('Coca-Cola 1L'), ('Coca-Cola 2L'), ('Guaraná Antarctica Lata 350ml'),
      ('Guaraná Antarctica 2L'), ('Fanta Laranja Lata 350ml'), ('Sprite Lata 350ml'),
      ('Suco de Laranja 500ml'), ('Suco de Maracujá 500ml'), ('Suco de Acerola 500ml'),
      ('Suco de Abacaxi com Hortelã 500ml'), ('H2O Limão 500ml'), ('Energético 250ml'),
      ('Café Expresso'), ('Chá Gelado de Limão 300ml'), ('Cerveja Pilsen Lata 350ml'),
      ('Cerveja Pilsen Long Neck 355ml'), ('Cerveja Pilsen Garrafa 600ml'),
      ('Cerveja Puro Malte Long Neck'), ('Caipirinha de Limão'), ('Caipiroska de Morango'),
      ('Dose de Whisky 50ml'), ('Taça de Vinho Tinto'), ('Batata Frita Simples'),
      ('Batata Frita com Cheddar e Bacon'), ('Frango a Passarinho'), ('Calabresa Acebolada'),
      ('Polenta Frita'), ('Onion Rings'), ('Nuggets de Frango (10 un)'), ('Torresmo Crocante'),
      ('Bolinho de Queijo (8 un)'), ('Pudim de Leite Condensado'), ('Petit Gateau com Sorvete'),
      ('Mousse de Maracujá'), ('Açaí 300ml com Granola'), ('Sorvete 2 Bolas'),
      ('Torta de Limão'), ('X-Burguer'), ('X-Salada'), ('X-Bacon'), ('X-Egg'), ('X-Frango'),
      ('X-Calabresa'), ('X-Tudo'), ('Hambúrguer Artesanal 180g'), ('Misto Quente'),
      ('Cachorro-quente'), ('Sanduíche Natural de Frango');

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
     where lower(btrim(neighborhood)) in ('centro', 'fátima', 'jóquei', 'são cristóvão', 'morada do sol', 'parque piauí', 'promorar',
    'dirceu arcoverde');

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
     where lower(btrim(neighborhood)) in ('centro', 'fátima', 'jóquei', 'são cristóvão', 'morada do sol', 'parque piauí', 'promorar',
    'dirceu arcoverde');

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
