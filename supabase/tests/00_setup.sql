-- =============================================================================
-- 00_setup.sql — infraestrutura da suíte de testes do BANCO
-- =============================================================================
-- Este arquivo NÃO é uma migração: ele só prepara o ambiente de teste.
--   * schema `tests` com as funções de asserção;
--   * troca de identidade (simula o PostgREST definindo request.jwt.claims);
--   * funcionários de teste (admin, caixa, garçom, garçom 2, inativo);
--   * catálogo determinístico (preços conhecidos) para conferir contas;
--   * grupos de adicionais (borda e um grupo obrigatório).
--
-- Executado por tools/run-sql-tests.sh em um PostgreSQL local que emula o
-- Supabase (tools/local_pg_shim.sql).
-- =============================================================================

create schema if not exists tests;

-- -----------------------------------------------------------------------------
-- Asserções
-- -----------------------------------------------------------------------------
create or replace function tests.ok(p_condition boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'ASSERT FALHOU: %', p_label;
  end if;
  raise notice 'OK: %', p_label;
end
$$;

create or replace function tests.eq_int(p_actual bigint, p_expected bigint, p_label text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERT FALHOU: % (esperado %, obtido %)', p_label, p_expected, p_actual;
  end if;
  raise notice 'OK: %', p_label;
end
$$;

create or replace function tests.eq_text(p_actual text, p_expected text, p_label text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERT FALHOU: % (esperado %, obtido %)', p_label, p_expected, p_actual;
  end if;
  raise notice 'OK: %', p_label;
end
$$;

create or replace function tests.eq_bool(p_actual boolean, p_expected boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERT FALHOU: % (esperado %, obtido %)', p_label, p_expected, p_actual;
  end if;
  raise notice 'OK: %', p_label;
end
$$;

/**
 * Executa um SQL que DEVE falhar e confere se a mensagem contém o fragmento.
 * A exceção é capturada em subtransação: nada é gravado e o teste continua.
 */
create or replace function tests.expect_error(p_sql text, p_fragment text, p_label text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      if position(upper(p_fragment) in upper(sqlerrm)) > 0 then
        raise notice 'OK: % (bloqueado: %)', p_label, split_part(sqlerrm, E'\n', 1);
        return;
      end if;
      raise exception 'ASSERT FALHOU: % — erro inesperado: % (esperava conter "%")', p_label, sqlerrm, p_fragment;
  end;

  raise exception 'ASSERT FALHOU: % — a operação deveria ter sido recusada, mas foi aceita', p_label;
end
$$;

/**
 * Escrita que deve ser RECUSADA — seja pelo RLS ('new row violates row-level
 * security policy') ou pela falta de privilégio ('permission denied for table').
 * O importante é: o usuário não consegue gravar.
 */
create or replace function tests.expect_denied(p_sql text, p_label text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      if position('row-level security' in sqlerrm) > 0
         or position('permission denied' in sqlerrm) > 0
         or position('insufficient_privilege' in sqlerrm) > 0 then
        raise notice 'OK: % (bloqueado: %)', p_label, split_part(sqlerrm, E'\n', 1);
        return;
      end if;
      raise exception 'ASSERT FALHOU: % — erro inesperado: %', p_label, sqlerrm;
  end;

  raise exception 'ASSERT FALHOU: % — a operação deveria ter sido recusada, mas foi aceita', p_label;
end
$$;

/**
 * Executa uma escrita que deve ser BLOQUEADA pelo RLS.
 * Sem policy de UPDATE/DELETE o PostgreSQL não lança erro: apenas 0 linhas.
 */
create or replace function tests.assert_blocked_write(p_sql text, p_label text)
returns void
language plpgsql
as $$
declare
  v_rows bigint;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
  exception
    when insufficient_privilege then
      raise notice 'OK: % (permissão negada)', p_label;
      return;
    when others then
      if position('row-level security' in sqlerrm) > 0 or position('permission denied' in sqlerrm) > 0 then
        raise notice 'OK: % (bloqueado pelo RLS)', p_label;
        return;
      end if;
      raise;
  end;

  if v_rows <> 0 then
    raise exception 'ASSERT FALHOU: % — % linha(s) afetada(s), esperava 0', p_label, v_rows;
  end if;
  raise notice 'OK: % (nenhuma linha afetada)', p_label;
end
$$;

-- -----------------------------------------------------------------------------
-- Troca de identidade (equivale ao que o PostgREST faz com o JWT do usuário)
-- -----------------------------------------------------------------------------
create or replace function tests.login(p_login text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where email = p_login or email like p_login || '@%';
  if v_id is null then
    raise exception 'usuário de teste "%" não encontrado (rode 00_setup.sql)', p_login;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id::text, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', v_id::text, false);
  perform set_config('role', 'authenticated', false);
  return v_id;
end
$$;

create or replace function tests.login_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('role', 'anon', false);
end
$$;

/**
 * Volta a ser o papel da SESSÃO (postgres) e limpa os claims do JWT.
 * NÃO pode ser SECURITY DEFINER: o PostgreSQL proíbe SET ROLE dentro de funções
 * definer. Como função comum (executada como `authenticated`), RESET ROLE volta
 * para o papel de login da sessão — que é como o psql está rodando.
 */
create or replace function tests.logout()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
end
$$;

-- Os testes rodam alternando o role (anon/authenticated), então as funções de
-- asserção precisam estar acessíveis a esses papéis.
grant usage on schema tests to anon, authenticated, service_role;
do $$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'tests'
  loop
    execute format('grant execute on function %s to anon, authenticated, service_role', f.sig);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Funcionários de teste
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', 'ana.admin@pizzaria.local',
   '{"full_name":"Ana Admin","login":"ana.admin","role":"admin"}'::jsonb),
  ('00000000-0000-0000-0000-000000000002', 'carlos.caixa@pizzaria.local',
   '{"full_name":"Carlos Caixa","login":"carlos.caixa","role":"manager"}'::jsonb),
  ('00000000-0000-0000-0000-000000000003', 'gisele.garcom@pizzaria.local',
   '{"full_name":"Gisele Garçom","login":"gisele.garcom","role":"waiter"}'::jsonb),
  ('00000000-0000-0000-0000-000000000004', 'gabriel.garcom@pizzaria.local',
   '{"full_name":"Gabriel Garçom","login":"gabriel.garcom","role":"waiter"}'::jsonb),
  ('00000000-0000-0000-0000-000000000005', 'inacio.inativo@pizzaria.local',
   '{"full_name":"Inácio Inativo","login":"inacio.inativo","role":"waiter"}'::jsonb)
on conflict (id) do nothing;

-- O trigger cria os perfis INATIVOS; aqui ativamos os operacionais
-- (análogo ao botão "Ativar acesso" do administrador).
update public.profiles set is_active = true
 where login in ('ana.admin', 'carlos.caixa', 'gisele.garcom', 'gabriel.garcom');

update public.profiles set is_active = false where login = 'inacio.inativo';

-- -----------------------------------------------------------------------------
-- Catálogo determinístico
-- -----------------------------------------------------------------------------
do $$
declare
  v_cat      uuid;
  v_pizza_a  uuid;
  v_pizza_b  uuid;
  v_drink    uuid;
  v_off      uuid;
  v_borda    uuid;
  v_obrig    uuid;
  s_p uuid; s_g uuid; s_un uuid;
begin
  select id into v_cat from public.categories where name = 'Testes';
  if v_cat is null then
    insert into public.categories (name, description, sort_order)
    values ('Testes', 'Categoria usada apenas pela suíte automatizada', 999)
    returning id into v_cat;
  end if;

  select id into s_p  from public.product_sizes where code = 'P';
  select id into s_g  from public.product_sizes where code = 'G';
  select id into s_un from public.product_sizes where code = 'UN';

  insert into public.products (category_id, name, description, kind, sort_order)
  values (v_cat, 'Pizza Teste A', 'Fixture da suíte SQL', 'pizza', 10)
  on conflict do nothing;
  select id into v_pizza_a from public.products where name = 'Pizza Teste A';

  insert into public.products (category_id, name, description, kind, sort_order)
  values (v_cat, 'Pizza Teste B', 'Fixture da suíte SQL', 'pizza', 20)
  on conflict do nothing;
  select id into v_pizza_b from public.products where name = 'Pizza Teste B';

  insert into public.products (category_id, name, description, kind, sort_order)
  values (v_cat, 'Refrigerante Teste', 'Fixture da suíte SQL', 'simple', 30)
  on conflict do nothing;
  select id into v_drink from public.products where name = 'Refrigerante Teste';

  insert into public.products (category_id, name, description, kind, is_available, sort_order)
  values (v_cat, 'Indisponível Teste', 'Produto fora de linha para testar bloqueio', 'simple', false, 40)
  on conflict do nothing;
  select id into v_off from public.products where name = 'Indisponível Teste';

  -- preços: A P=3000 G=5000 · B P=2500 G=4000 · Refrigerante UN=700 · Indisponível UN=100
  insert into public.product_variants (product_id, size_id, price_cents)
  values (v_pizza_a, s_p, 3000), (v_pizza_a, s_g, 5000),
         (v_pizza_b, s_p, 2500), (v_pizza_b, s_g, 4000),
         (v_drink, s_un, 700), (v_off, s_un, 100)
  on conflict (product_id, size_id) do nothing;

  -- grupos de adicionais
  select id into v_borda from public.modifier_groups where name = 'Borda Teste';
  if v_borda is null then
    insert into public.modifier_groups (name, description, min_select, max_select, sort_order)
    values ('Borda Teste', 'Grupo opcional com limite máximo de 1', 0, 1, 900)
    returning id into v_borda;
  end if;

  select id into v_obrig from public.modifier_groups where name = 'Obrigatório Teste';
  if v_obrig is null then
    insert into public.modifier_groups (name, description, min_select, max_select, sort_order)
    values ('Obrigatório Teste', 'Grupo com escolha mínima obrigatória', 1, 2, 910)
    returning id into v_obrig;
  end if;

  insert into public.modifier_options (group_id, name, price_cents, sort_order)
  values (v_borda, 'Borda Catupiry Teste', 500, 10), (v_borda, 'Borda Cheddar Teste', 600, 20)
  on conflict do nothing;

  insert into public.modifier_options (group_id, name, price_cents, sort_order)
  values (v_obrig, 'Extra Queijo Teste', 300, 10), (v_obrig, 'Extra Bacon Teste', 400, 20)
  on conflict do nothing;

  -- a Pizza Teste A aceita borda e o grupo obrigatório
  insert into public.product_modifier_groups (product_id, group_id, sort_order)
  values (v_pizza_a, v_borda, 10), (v_pizza_a, v_obrig, 20)
  on conflict (product_id, group_id) do nothing;

  -- zona de entrega determinística
  insert into public.delivery_fee_zones (neighborhood, fee_cents, is_active)
  select 'Centro Teste', 800, true
  where not exists (select 1 from public.delivery_fee_zones where neighborhood = 'Centro Teste');
end
$$;

-- -----------------------------------------------------------------------------
-- Atalho de fixtures: ids determinísticos usados pelos arquivos 01..06
-- -----------------------------------------------------------------------------
create or replace view tests.fx as
select
  (select id from public.categories   where name = 'Testes')                        as cat_teste,
  (select id from public.products     where name = 'Pizza Teste A')                 as pizza_a,
  (select id from public.products     where name = 'Pizza Teste B')                 as pizza_b,
  (select id from public.products     where name = 'Refrigerante Teste')            as drink,
  (select id from public.products     where name = 'Indisponível Teste')            as unavailable,
  (select id from public.product_sizes where code = 'P')                            as size_p,
  (select id from public.product_sizes where code = 'G')                            as size_g,
  (select id from public.product_sizes where code = 'UN')                           as size_un,
  (select v.id from public.product_variants v
     join public.products p on p.id = v.product_id
    where p.name = 'Pizza Teste A' and v.size_id = (select id from public.product_sizes where code = 'G'))
                                                                                    as variant_a_g,
  (select v.id from public.product_variants v
     join public.products p on p.id = v.product_id
    where p.name = 'Pizza Teste B' and v.size_id = (select id from public.product_sizes where code = 'G'))
                                                                                    as variant_b_g,
  (select v.id from public.product_variants v
     join public.products p on p.id = v.product_id
    where p.name = 'Refrigerante Teste' and v.size_id = (select id from public.product_sizes where code = 'UN'))
                                                                                    as variant_drink_un,
  (select v.id from public.product_variants v
     join public.products p on p.id = v.product_id
    where p.name = 'Indisponível Teste' and v.size_id = (select id from public.product_sizes where code = 'UN'))
                                                                                    as variant_off_un,
  (select id from public.modifier_groups  where name = 'Borda Teste')               as grp_borda,
  (select id from public.modifier_groups  where name = 'Obrigatório Teste')         as grp_obrig,
  (select id from public.modifier_options where name = 'Borda Catupiry Teste')      as opt_catupiry,
  (select id from public.modifier_options where name = 'Borda Cheddar Teste')       as opt_cheddar,
  (select id from public.modifier_options where name = 'Extra Queijo Teste')        as opt_queijo,
  (select id from public.modifier_options where name = 'Extra Bacon Teste')         as opt_bacon,
  (select id from public.profiles where login = 'ana.admin')                        as p_admin,
  (select id from public.profiles where login = 'carlos.caixa')                     as p_caixa,
  (select id from public.profiles where login = 'gisele.garcom')                    as p_garcom,
  (select id from public.delivery_fee_zones where neighborhood = 'Centro Teste')    as zona_centro;

grant select on tests.fx to anon, authenticated, service_role;

reset role;
