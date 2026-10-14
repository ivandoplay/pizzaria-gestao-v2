-- =============================================================================
-- SEED ESTRUTURAL (seguro para produção)
--
-- Cria apenas ESTRUTURA configurável — nada de vendas ou preços fictícios:
--   * tamanhos padrão de pizza e de bebidas;
--   * categorias padrão;
--   * grupos de adicionais VAZIOS (o administrador cadastra as opções e preços);
--   * mesas 1..12 (ajustáveis pelo administrador);
--   * horários de atendimento FECHADOS (o administrador abre os dias e horários).
--
-- Idempotente: pode ser executado mais de uma vez sem duplicar registros.
-- =============================================================================

-- ---------- categorias ----------
insert into public.categories (name, description, sort_order)
values
  ('Pizzas Salgadas', 'Pizzas de sabores salgados', 10),
  ('Pizzas Doces',    'Pizzas de sabores doces',    20),
  ('Bebidas',         'Bebidas em geral',           30),
  ('Sobremesas',      'Sobremesas',                 40)
on conflict (lower(btrim(name))) do nothing;

-- ---------- tamanhos de pizza ----------
insert into public.product_sizes (code, name, kind, slices, serves_from, serves_to, max_flavors, sort_order)
values
  ('P',  'Pequena', 'pizza', 4, 1, 2, 2, 10),
  ('M',  'Média',   'pizza', 6, 2, 3, 2, 20),
  ('G',  'Grande',  'pizza', 8, 3, 4, 2, 30),
  ('GG', 'Família', 'pizza', 12, 4, 6, 2, 40)
on conflict (code) do nothing;

-- ---------- tamanhos de itens simples ----------
insert into public.product_sizes (code, name, kind, max_flavors, sort_order)
values
  ('UN',  'Padrão',       'other', 1, 10),
  ('LAT', 'Lata 350ml',   'other', 1, 20),
  ('GAR', 'Garrafa 600ml','other', 1, 30),
  ('GAR1', 'Garrafa 1L',  'other', 1, 40),
  ('GAR2', 'Garrafa 2L',  'other', 1, 50),
  ('POR', 'Porção',       'other', 1, 60),
  ('SOB', 'Sobremesa',    'other', 1, 70)
on conflict (code) do nothing;

-- ---------- grupos de adicionais (sem opções: o admin cadastra com preços reais) ----------
insert into public.modifier_groups (name, description, min_select, max_select, sort_order)
values
  ('Borda recheada', 'Escolha a borda da pizza', 0, 1, 10),
  ('Adicionais extras', 'Ingredientes extras para a pizza', 0, 5, 20)
on conflict (lower(btrim(name))) do nothing;

-- ---------- mesas ----------
insert into public.restaurant_tables (number, name, seats)
select g, 'Mesa ' || g, 4
from generate_series(1, 12) g
on conflict (number) do nothing;

-- ---------- horários (fechados até o administrador configurar) ----------
update public.business_hours set is_open = false where opens_at is null;
